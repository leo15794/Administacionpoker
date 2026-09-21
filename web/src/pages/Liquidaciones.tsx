import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

// Resumen de liquidación semanal, para mandarle el pago a una persona/grupo: una fila por
// agente+club con lo que generó en rakeback esa semana, un total, y (abajo) lo que
// efectivamente se le paga después de cruzar adelantos pendientes — mismo formato que la
// planilla vieja ("PRODIGIO · CIERRE 07/09-13/09"). Se puede combinar MÁS DE UN agente (de
// clubes distintos) en una sola liquidación, porque en la práctica una misma persona ("Prodigio")
// puede tener una identidad de agente distinta por cada club, igual que pasaba con Juan — acá
// es solo para el reporte/PDF, no rutea nada de plata como sí hace "Cuenta de socio".
// Todo en USD: weekly_closings ya guarda los montos convertidos con la tasa de esa semana, no
// el monto en moneda local original, así que cualquier aclaración de conversión se agrega a
// mano en la nota de abajo.
// Ventas y tickets promocionales (21/09/2026): se cargan por FILA (agente+club), no para toda
// la liquidación como el "Adicional manual" -- Leo necesita poder cargárselo a un solo agente
// de la tanda, no a todos. Viajan pegados a cada objeto de `filas` (que ya se guarda como JSON
// tal cual, sin columnas propias) para no tocar el schema.
function filaKey(f: any): string {
  return `${f.agentId}_${f.clubId}`;
}

interface PdfInput {
  nombreGrupo: string;
  weekStart: string;
  weekEnd: string;
  filas: any[];
  multiAgente: boolean;
  total: number;
  adelantosAplicados: number;
  adelantosManual: number;
  cargasAplicadas: number;
  ventasTickets: number;
  nota: string;
}

// Recibe SIEMPRE los totales ya resueltos (aplicado + tildado + manual) — nunca solo "lo
// tildado ahora mismo", porque si el cruce ya se aplicó (y el checkbox se reseteó al refrescar
// los pendientes), el PDF terminaba mostrando "Adelantos a descontar: 0" a pesar de que el
// cruce sí se había consumido de verdad (BIT: pasaba justo con el adelanto de rake de Prodigio).
async function generarPdf(input: PdfInput) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const margen = 14;
  let y = 18;
  const totalDescontar = input.adelantosAplicados + input.adelantosManual + input.cargasAplicadas + input.ventasTickets;
  const totalAPagar = input.total - totalDescontar;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`${input.nombreGrupo} · Cierre ${dateShort(input.weekStart)} - ${dateShort(input.weekEnd)}`, margen, y);
  y += 9;

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Club", "Ganancias/Pérdidas", "Rake", "Rakeback bruto", "Rebate", "Rakeback neto", "Ventas", "Tickets"]],
    body: input.filas.map((f: any) => [
      input.multiAgente ? `${f.clubName} (${f.agentName})` : f.clubName,
      usd(f.resultado),
      usd(f.rakeTotal),
      usd(f.rakebackBruto),
      usd(f.rebate),
      usd(f.rakebackNeto),
      usd(f.ventas || 0),
      usd(f.tickets || 0),
    ]),
    foot: [["TOTAL", "", "", "", "", usd(input.total),
      usd(input.filas.reduce((s: number, f: any) => s + (Number(f.ventas) || 0), 0)),
      usd(input.filas.reduce((s: number, f: any) => s + (Number(f.tickets) || 0), 0)),
    ]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 50, 90] },
    footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Después:", margen, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Rakeback / comisiones finales: ${usd(input.total)}`, margen, y);
  y += 6;
  doc.text(`Adelantos + cargas a descontar: -${usd(input.adelantosAplicados + input.adelantosManual + input.cargasAplicadas)}`, margen, y);
  y += 6;
  if (input.ventasTickets !== 0) {
    doc.text(`Ventas + tickets (por agente) a descontar: -${usd(input.ventasTickets)}`, margen, y);
    y += 6;
  }
  if (input.adelantosManual !== 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text(`(incluye ${usd(input.adelantosManual)} pendiente de registrar)`, margen, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y += 6;
  }
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Total a pagar a ${input.nombreGrupo}: ${usd(totalAPagar)}`, margen, y);
  y += 10;

  if (input.nota.trim()) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(90);
    const lineas = doc.splitTextToSize(input.nota.trim(), 180);
    doc.text(lineas, margen, y);
    doc.setTextColor(0);
  }

  const nombreArchivo = `liquidacion_${input.nombreGrupo.replace(/[^a-z0-9]+/gi, "-")}_${input.weekStart}.pdf`;
  doc.save(nombreArchivo);
}

export default function Liquidaciones() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [agentes, setAgentes] = useState<any[]>([]);
  const [filtro, setFiltro] = useState("");
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [nombreGrupo, setNombreGrupo] = useState("");
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [data, setData] = useState<any>(null);
  const [cruces, setCruces] = useState<Record<string, number>>({}); // advanceId -> monto a cruzar (tildado, todavía sin aplicar)
  const [aplicado, setAplicado] = useState<number>(0); // suma de lo YA aplicado (consumido de verdad) en esta liquidación
  // Cargas de tesorería pendientes (21/09/2026) -- mismo patrón que "cruces"/"aplicado" de
  // arriba, pero contra carga_pendientes_cruce en vez de rakeback_advances (ver repo/cargaCruces.ts).
  const [crucesCarga, setCrucesCarga] = useState<Record<string, number>>({}); // cargaId -> monto a cruzar
  const [aplicadoCarga, setAplicadoCarga] = useState<number>(0);
  const [adelantosManual, setAdelantosManual] = useState<number>(0);
  // Ventas / tickets promocionales por fila (agente+club) -- keyed por filaKey(f).
  const [ventasPorFila, setVentasPorFila] = useState<Record<string, number>>({});
  const [ticketsPorFila, setTicketsPorFila] = useState<Record<string, number>>({});
  const [borrandoCarga, setBorrandoCarga] = useState<string | null>(null);
  // Enviar/Recibir (21/09/2026): registra el pago/cobro real contra la wallet, reusando el
  // movimiento CARGA... no, PAGO/COBRO que ya existe en Movimientos -- acá elegimos con qué
  // agente+club de la liquidación se cruza (puede ser multi-agente) y el medio de pago, igual
  // que en "Cargar movimiento". Es una acción aparte de "Guardar en historial": se puede enviar
  // sin guardar y guardar sin enviar.
  const [movAbierto, setMovAbierto] = useState<"PAGO" | "COBRO" | null>(null);
  const [movAgenteClub, setMovAgenteClub] = useState("");
  const [movMonto, setMovMonto] = useState("");
  const [movMetodo, setMovMetodo] = useState("SIN_TESORERIA");
  const [movCustodio, setMovCustodio] = useState("");
  const [movObservacion, setMovObservacion] = useState("");
  const [registrandoMov, setRegistrandoMov] = useState(false);
  const [movMsg, setMovMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false); // ya se guardó ESTA liquidación tal cual está — evita duplicar
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [borrandoHist, setBorrandoHist] = useState<string | null>(null);

  useEffect(() => {
    api.agentes().then(setAgentes).catch(() => {});
    refrescarHistorial();
  }, []);

  function refrescarHistorial() {
    api.historialLiquidaciones().then(setHistorial).catch(() => {});
  }

  const agentesFiltrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return agentes;
    return agentes.filter((a) => a.name.toLowerCase().includes(f));
  }, [agentes, filtro]);

  function toggleAgente(id: string) {
    setSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSemanas([]);
    setWeekStart("");
    setData(null);
  }

  useEffect(() => {
    setSemanas([]);
    setWeekStart("");
    setData(null);
    if (seleccionados.length === 0) return;
    api.semanasLiquidacion(seleccionados).then(setSemanas).catch(() => {});
    // Nombre por default: si es un solo agente, su nombre; si son varios, en blanco para que lo
    // pongan a mano (ej. "Prodigio") — no hay forma de adivinar cómo se llama el grupo.
    if (seleccionados.length === 1) {
      const a = agentes.find((x) => x.id === seleccionados[0]);
      if (a) setNombreGrupo(a.name);
    }
  }, [seleccionados]);

  // preservarAplicado=true después de aplicar un cruce: solo refresca los datos (pendientes
  // actualizados) sin resetear lo que ya se descontó en esta liquidación ni la nota/adelanto
  // manual — si no, el PDF terminaba mostrando "Adelantos a descontar: 0" después de aplicar
  // el cruce, porque se perdía el registro de lo recién consumido.
  function refrescarLiquidacion(preservarAplicado = false) {
    if (seleccionados.length === 0 || !weekStart) return;
    setError("");
    setCargando(true);
    api
      .liquidacion(seleccionados, weekStart)
      .then((d) => {
        setData(d);
        setCruces({});
        setCrucesCarga({});
        setGuardado(false);
        setMovAbierto(null);
        setMovMsg(null);
        if (!preservarAplicado) {
          setAplicado(0);
          setAplicadoCarga(0);
          setAdelantosManual(0);
          setVentasPorFila({});
          setTicketsPorFila({});
          if (seleccionados.length === 1) setNota("");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    refrescarLiquidacion(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionados.join(","), weekStart]);

  const totalCruzado = Object.values(cruces).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalCruzadoCarga = Object.values(crucesCarga).reduce((s, v) => s + (Number(v) || 0), 0);
  // Lo que ya se descuenta de verdad: lo aplicado en rondas anteriores de esta misma
  // liquidación + lo que está tildado ahora mismo (todavía sin aplicar, adelantos y cargas) + el manual.
  const totalDescontarAdelantos = aplicado + totalCruzado + aplicadoCarga + totalCruzadoCarga + adelantosManual;
  const totalVentasFilas = data ? data.filas.reduce((s: number, f: any) => s + (Number(ventasPorFila[filaKey(f)]) || 0), 0) : 0;
  const totalTicketsFilas = data ? data.filas.reduce((s: number, f: any) => s + (Number(ticketsPorFila[filaKey(f)]) || 0), 0) : 0;
  const totalVentasTickets = totalVentasFilas + totalTicketsFilas;
  const totalDescontar = totalDescontarAdelantos + totalVentasTickets;
  const totalAPagar = data ? data.total - totalDescontar : 0;
  // Filas con ventas/tickets ya pegados encima -- lo que de verdad se guarda/imprime, para que
  // el PDF y el historial conserven cuánto se le cargó a cada agente puntual.
  const filasConAjustes = data
    ? data.filas.map((f: any) => ({ ...f, ventas: Number(ventasPorFila[filaKey(f)]) || 0, tickets: Number(ticketsPorFila[filaKey(f)]) || 0 }))
    : [];
  // Cuánto rakeback de esta semana queda todavía "libre" para cruzar (contra un adelanto O una
  // carga de tesorería — comparten el mismo "cupo", no tiene sentido consumirle a un agente más
  // de lo que este cierre efectivamente cubre entre las dos cosas juntas).
  const disponibleParaCruzar = Math.max(0, data ? data.total - aplicado - totalCruzado - aplicadoCarga - totalCruzadoCarga : 0);

  function abrirMov(tipo: "PAGO" | "COBRO") {
    setMovAbierto(tipo);
    setMovMsg(null);
    setMovMonto(Math.abs(totalAPagar).toFixed(2));
    if (data && data.filas.length > 0) {
      setMovAgenteClub(`${data.filas[0].agentId}|${data.filas[0].clubId}`);
    }
  }

  async function registrarMov() {
    if (!movAbierto || !movAgenteClub) return;
    const [agentId, clubId] = movAgenteClub.split("|");
    const monto = Number(movMonto);
    if (!(monto > 0)) return setMovMsg({ ok: false, text: "El importe tiene que ser mayor a 0." });
    if (movMetodo === "EFECTIVO" && !movCustodio.trim()) {
      return setMovMsg({ ok: false, text: "Un movimiento en efectivo requiere custodio (BIT-051/052)." });
    }
    setRegistrandoMov(true);
    setMovMsg(null);
    try {
      await api.crearMovimiento({
        type: movAbierto,
        agentId,
        clubId,
        amount: monto,
        paymentMethod: movMetodo,
        custodian: movMetodo === "EFECTIVO" ? movCustodio.trim() : undefined,
        occurredAt: new Date().toISOString(),
        observation: movObservacion.trim() || `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
      });
      setMovMsg({ ok: true, text: `${movAbierto === "PAGO" ? "Pago" : "Cobro"} registrado y aplicado al ledger.` });
      setMovObservacion("");
    } catch (err: any) {
      setMovMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setRegistrandoMov(false);
    }
  }

  async function aplicarCruces() {
    const ids = Object.keys(cruces).filter((id) => cruces[id] > 0);
    if (ids.length === 0) return;
    if (!(await confirmDialog(`Se va a descontar ${usd(totalCruzado)} de ${ids.length} adelanto(s) — esto los consume de verdad, no se puede deshacer desde acá (habría que corregirlo en Adelantos). ¿Confirmás?`))) return;
    setAplicando(true);
    try {
      for (const id of ids) {
        await api.ajustarAdelanto({
          advanceId: id,
          type: "CONSUMO",
          amount: cruces[id],
          notes: `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
      }
      setAplicado((prev) => prev + totalCruzado);
      refrescarLiquidacion(true);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo aplicar el cruce.");
    } finally {
      setAplicando(false);
    }
  }

  // Mismo mecanismo que aplicarCruces() de arriba, pero para cargas de tesorería pendientes
  // (ver repo/cargaCruces.ts) -- consumirCarga en vez de ajustarAdelanto CONSUMO.
  async function aplicarCrucesCarga() {
    const ids = Object.keys(crucesCarga).filter((id) => crucesCarga[id] > 0);
    if (ids.length === 0) return;
    if (!(await confirmDialog(`Se va a descontar ${usd(totalCruzadoCarga)} de ${ids.length} carga(s) de tesorería — esto las consume de verdad, no se puede deshacer desde acá. ¿Confirmás?`))) return;
    setAplicando(true);
    try {
      for (const id of ids) {
        await api.consumirCarga({
          cargaId: id,
          amount: crucesCarga[id],
          notes: `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
      }
      setAplicadoCarga((prev) => prev + totalCruzadoCarga);
      refrescarLiquidacion(true);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo aplicar el cruce.");
    } finally {
      setAplicando(false);
    }
  }

  // Borrado real de una carga pendiente (ej. cargada de prueba, o al agente/club equivocado) --
  // no queda en historial, a diferencia de consumirla. Mismo criterio que "Eliminar" en Adelantos.
  async function eliminarCargaPendiente(cg: any) {
    if (!(await confirmDialog(`¿Eliminar la carga pendiente de ${cg.agentName} (${cg.clubName}) por ${usd(cg.pendiente)}? Esto la borra del todo (no queda en historial) -- para una carga que nunca debió existir. No se puede deshacer.`))) return;
    setBorrandoCarga(cg.id);
    try {
      await api.eliminarCarga(cg.id);
      setCrucesCarga((prev) => {
        const next = { ...prev };
        delete next[cg.id];
        return next;
      });
      refrescarLiquidacion(true);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar la carga.");
    } finally {
      setBorrandoCarga(null);
    }
  }

  return (
    <div>
      <h2>Liquidaciones</h2>
      <p className="muted" style={{ marginTop: -6, marginBottom: 18 }}>
        Resumen de rakeback por club de una semana puntual, listo para mandarle el pago. Se pueden combinar varios
        agentes de clubes distintos en una sola liquidación (ej. una misma persona con una identidad por club).
      </p>

      <div className="panel">
        <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Agentes a combinar</label>
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar agente..."
          style={{ width: "100%", maxWidth: 320, marginBottom: 8 }}
        />
        <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8 }}>
          {agentesFiltrados.map((a) => (
            <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={seleccionados.includes(a.id)} onChange={() => toggleAgente(a.id)} />
              {a.name}
            </label>
          ))}
          {agentesFiltrados.length === 0 && <div className="muted">Sin resultados.</div>}
        </div>

        {seleccionados.length > 0 && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
            <div>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                Nombre del pago {seleccionados.length > 1 && "(varios agentes combinados)"}
              </label>
              <input value={nombreGrupo} onChange={(e) => setNombreGrupo(e.target.value)} placeholder="Ej: Prodigio" style={{ width: 220 }} />
            </div>
            <div>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Semana</label>
              <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)} disabled={semanas.length === 0}>
                <option value="">{semanas.length === 0 ? "Sin cierres para estos agentes" : "Elegir semana..."}</option>
                {semanas.map((s) => (
                  <option key={s.week_start} value={s.week_start}>
                    {dateShort(s.week_start)} - {dateShort(s.week_end)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
      {cargando && <div className="muted" style={{ marginTop: 14 }}>Cargando...</div>}

      {data && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="topbar" style={{ marginBottom: 14 }}>
            <div>
              <strong>{nombreGrupo || data.agentes.map((a: any) => a.name).join(" + ")}</strong>
              <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
                Cierre {dateShort(data.weekStart)} - {dateShort(data.weekEnd)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn secondary small"
                disabled={guardando}
                onClick={async () => {
                  setGuardando(true);
                  try {
                    await api.guardarLiquidacion({
                      nombreGrupo: nombreGrupo || "Liquidación",
                      agentIds: seleccionados,
                      weekStart: data.weekStart,
                      weekEnd: data.weekEnd,
                      filas: filasConAjustes,
                      total: data.total,
                      adelantosAplicados: aplicado + totalCruzado,
                      adelantosManual,
                      cargasAplicadas: aplicadoCarga + totalCruzadoCarga,
                      totalAPagar,
                      nota,
                    });
                    setGuardado(true);
                    refrescarHistorial();
                  } catch (err: any) {
                    await alertDialog(err.message || "No se pudo guardar la liquidación.");
                  } finally {
                    setGuardando(false);
                  }
                }}
                title="Deja esta liquidación guardada en el historial de abajo, tal cual está ahora"
              >
                {guardando ? "Guardando..." : guardado ? "✓ Guardada" : "Guardar en historial"}
              </button>
              <button
                className="btn secondary small"
                disabled={generandoPdf}
                onClick={async () => {
                  setGenerandoPdf(true);
                  try {
                    await generarPdf({
                      nombreGrupo: nombreGrupo || "Liquidación",
                      weekStart: data.weekStart,
                      weekEnd: data.weekEnd,
                      filas: filasConAjustes,
                      multiAgente: data.agentes.length > 1,
                      total: data.total,
                      adelantosAplicados: aplicado + totalCruzado,
                      adelantosManual,
                      cargasAplicadas: aplicadoCarga + totalCruzadoCarga,
                      ventasTickets: totalVentasTickets,
                      nota,
                    });
                  } catch (err: any) {
                    await alertDialog(err.message || "No se pudo generar el PDF.");
                  } finally {
                    setGenerandoPdf(false);
                  }
                }}
              >
                {generandoPdf ? "Generando..." : "Descargar PDF"}
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Club</th>
                {data.agentes.length > 1 && <th>Agente</th>}
                <th>Ganancias/Pérdidas</th>
                <th>Rake</th>
                <th>Rakeback bruto</th>
                <th>Rebate</th>
                <th>Rakeback neto</th>
                <th>Ventas</th>
                <th>Tickets</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.map((f: any) => {
                const key = filaKey(f);
                return (
                  <tr key={key}>
                    <td>{f.clubName}</td>
                    {data.agentes.length > 1 && <td className="muted">{f.agentName}</td>}
                    <td className={Number(f.resultado) >= 0 ? "pos" : "neg"}>{usd(f.resultado)}</td>
                    <td>{usd(f.rakeTotal)}</td>
                    <td>{usd(f.rakebackBruto)}</td>
                    <td>{usd(f.rebate)}</td>
                    <td><strong>{usd(f.rakebackNeto)}</strong></td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={ventasPorFila[key] ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          setGuardado(false);
                          const v = Number(e.target.value) || 0;
                          setVentasPorFila((prev) => ({ ...prev, [key]: v }));
                        }}
                        style={{ width: 90, textAlign: "right" }}
                        title={`Ventas cargadas solo a ${f.agentName} (${f.clubName}) -- se descuenta de su parte, no de toda la liquidación.`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={ticketsPorFila[key] ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          setGuardado(false);
                          const v = Number(e.target.value) || 0;
                          setTicketsPorFila((prev) => ({ ...prev, [key]: v }));
                        }}
                        style={{ width: 90, textAlign: "right" }}
                        title={`Tickets promocionales cargados solo a ${f.agentName} (${f.clubName}) -- se descuenta de su parte, no de toda la liquidación.`}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 700 }}>
                <td>TOTAL</td>
                {data.agentes.length > 1 && <td></td>}
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td>{usd(data.total)}</td>
                <td>{usd(totalVentasFilas)}</td>
                <td>{usd(totalTicketsFilas)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <h3 style={{ marginTop: 0 }}>Cruzar adelantos pendientes</h3>
            {data.adelantos.length > 0 && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Disponible para cruzar en esta liquidación: {usd(disponibleParaCruzar)} (no se propone cruzar más que esto por
                default, aunque el adelanto tenga más pendiente — se puede subir a mano si hace falta).
              </div>
            )}
            {data.adelantos.length === 0 ? (
              <div className="muted">Sin adelantos activos para estos agentes.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.adelantos.map((a: any) => (
                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={a.id in cruces}
                      onChange={(e) => {
                        setGuardado(false);
                        setCruces((prev) => {
                          const next = { ...prev };
                          if (e.target.checked) {
                            // Por default solo cruza hasta lo que esta liquidación realmente
                            // genera — si el adelanto pendiente es mayor al total a pagar de
                            // esta semana, NO se lo come entero: se puede subir a mano si de
                            // verdad se quiere consumir más de lo que cubre este cierre.
                            next[a.id] = Math.min(a.pendiente, disponibleParaCruzar);
                          } else {
                            delete next[a.id];
                          }
                          return next;
                        });
                      }}
                    />
                    <span style={{ minWidth: 260 }}>
                      {a.agentName}{a.clubOrigenName ? ` (${a.clubOrigenName})` : ""} — pendiente {usd(a.pendiente)}
                    </span>
                    {a.id in cruces && (
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={a.pendiente}
                        value={cruces[a.id]}
                        onChange={(e) => {
                          setGuardado(false);
                          setCruces((prev) => ({ ...prev, [a.id]: Math.min(Number(e.target.value) || 0, a.pendiente) }));
                        }}
                        style={{ width: 110, textAlign: "right" }}
                      />
                    )}
                  </label>
                ))}
                <div>
                  <button className="btn secondary small" disabled={totalCruzado <= 0 || aplicando} onClick={aplicarCruces} style={{ marginTop: 8 }}>
                    {aplicando ? "Aplicando..." : `Aplicar cruce (${usd(totalCruzado)})`}
                  </button>
                  <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                    Esto consume de verdad el adelanto (mismo efecto que "Consumo" en Adelantos).
                  </span>
                </div>
              </div>
            )}

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <h3 style={{ marginTop: 0 }}>Cruzar cargas de tesorería pendientes</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Fichas/USD que ya se le cargaron a este agente en este club (ver "Cargar Movimiento", tipo CARGA) y todavía
                no se descontaron de ninguna liquidación.
              </div>
              {data.cargas.length === 0 ? (
                <div className="muted">Sin cargas de tesorería pendientes para estos agentes/clubes.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.cargas.map((cg: any) => (
                    <div key={cg.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={cg.id in crucesCarga}
                          onChange={(e) => {
                            setGuardado(false);
                            setCrucesCarga((prev) => {
                              const next = { ...prev };
                              if (e.target.checked) {
                                next[cg.id] = cg.pendiente;
                              } else {
                                delete next[cg.id];
                              }
                              return next;
                            });
                          }}
                        />
                        <span style={{ minWidth: 260 }}>
                          {cg.agentName} ({cg.clubName}) — pendiente {usd(cg.pendiente)}
                        </span>
                        {cg.id in crucesCarga && (
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            max={cg.pendiente}
                            value={crucesCarga[cg.id]}
                            onChange={(e) => {
                              setGuardado(false);
                              setCrucesCarga((prev) => ({ ...prev, [cg.id]: Math.min(Number(e.target.value) || 0, cg.pendiente) }));
                            }}
                            style={{ width: 110, textAlign: "right" }}
                          />
                        )}
                      </label>
                      <button
                        type="button"
                        className="btn secondary small"
                        disabled={borrandoCarga === cg.id}
                        onClick={() => eliminarCargaPendiente(cg)}
                        title="Borrado real — no queda en el historial. Para una carga que nunca debió cargarse (ej. de prueba)."
                        style={{ color: "var(--danger, #e5484d)" }}
                      >
                        {borrandoCarga === cg.id ? "..." : "Eliminar"}
                      </button>
                    </div>
                  ))}
                  <div>
                    <button className="btn secondary small" disabled={totalCruzadoCarga <= 0 || aplicando} onClick={aplicarCrucesCarga} style={{ marginTop: 8 }}>
                      {aplicando ? "Aplicando..." : `Aplicar cruce (${usd(totalCruzadoCarga)})`}
                    </button>
                    <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                      Esto consume de verdad la carga (no se puede deshacer desde acá).
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                Adicional manual a descontar (ej. adelanto todavía no registrado en el sistema)
              </label>
              <input
                type="number"
                step="0.01"
                // value={adelantosManual} directo mostraba "0" fijo en el campo -- para escribir
                // un monto había que borrar ese 0 a mano primero (el "bug del 0"). Mostrando ""
                // cuando el valor es 0 (el default) se puede tipear directo.
                value={adelantosManual === 0 ? "" : adelantosManual}
                onChange={(e) => {
                  setAdelantosManual(Number(e.target.value) || 0);
                  setGuardado(false);
                }}
                style={{ width: 150 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420, marginTop: 16 }}>
              <div className="topbar" style={{ margin: 0 }}>
                <span className="muted">Rakeback / comisiones finales</span>
                <span>{usd(data.total)}</span>
              </div>
              <div className="topbar" style={{ margin: 0 }}>
                <span className="muted">Adelantos + cargas a descontar</span>
                <span>-{usd(totalDescontarAdelantos)}</span>
              </div>
              {totalVentasTickets !== 0 && (
                <div className="topbar" style={{ margin: 0 }}>
                  <span className="muted">Ventas + tickets (por agente) a descontar</span>
                  <span>-{usd(totalVentasTickets)}</span>
                </div>
              )}
              <div className="topbar" style={{ margin: 0, fontWeight: 700, fontSize: 16, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                <span>Total a pagar</span>
                <span className={totalAPagar >= 0 ? "pos" : "neg"}>{usd(totalAPagar)}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => abrirMov("PAGO")}>
                Enviar (pagarle al agente)
              </button>
              <button type="button" className="btn" onClick={() => abrirMov("COBRO")}>
                Recibir (el agente nos debe)
              </button>
            </div>

            {movAbierto && (
              <div className="panel" style={{ marginTop: 10, maxWidth: 460 }}>
                <h4 style={{ marginTop: 0 }}>
                  {movAbierto === "PAGO" ? "Registrar pago al agente" : "Registrar cobro al agente"}
                </h4>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Esto registra un movimiento real de {movAbierto === "PAGO" ? "PAGO" : "COBRO"} contra la
                  wallet (mismo efecto que cargarlo en "Cargar movimiento"). Es independiente de
                  "Guardar en historial": podés enviar/recibir sin guardar, o guardar sin enviar.
                </div>
                <div className="field">
                  <label>Agente + club</label>
                  <select value={movAgenteClub} onChange={(e) => setMovAgenteClub(e.target.value)}>
                    {data.filas.map((f: any) => (
                      <option key={`${f.agentId}|${f.clubId}`} value={`${f.agentId}|${f.clubId}`}>
                        {f.agentName} — {f.clubName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Importe (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={movMonto}
                    onChange={(e) => setMovMonto(e.target.value)}
                    style={{ width: 150 }}
                  />
                </div>
                <div className="field">
                  <label>Medio de pago</label>
                  <select value={movMetodo} onChange={(e) => setMovMetodo(e.target.value)}>
                    <option value="SIN_TESORERIA">Sin tesorería (interno)</option>
                    <option value="USDT">USDT</option>
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="ZELLE">Zelle</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </div>
                {movMetodo === "EFECTIVO" && (
                  <div className="field">
                    <label>Custodio del efectivo</label>
                    <input value={movCustodio} onChange={(e) => setMovCustodio(e.target.value)} placeholder="Quién tiene la plata físicamente" />
                  </div>
                )}
                <div className="field">
                  <label>Observación (opcional)</label>
                  <input
                    value={movObservacion}
                    onChange={(e) => setMovObservacion(e.target.value)}
                    placeholder={`Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim()}
                  />
                </div>
                {movMsg && <div className={movMsg.ok ? "success" : "error"}>{movMsg.text}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn" disabled={registrandoMov} onClick={registrarMov}>
                    {registrandoMov ? "Registrando..." : movAbierto === "PAGO" ? "Confirmar pago" : "Confirmar cobro"}
                  </button>
                  <button type="button" className="btn secondary" onClick={() => setMovAbierto(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                Nota (aclaraciones de conversión de moneda, etc. — se incluye en el PDF)
              </label>
              <textarea
                value={nota}
                onChange={(e) => {
                  setNota(e.target.value);
                  setGuardado(false);
                }}
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
                placeholder="Ej: rakeback bruto calculado con el rate de la semana; ver diferencia de TWD al momento del pago."
              />
            </div>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Historial de liquidaciones</h3>
        {!historial ? (
          <div className="muted">Cargando...</div>
        ) : historial.length === 0 ? (
          <div className="muted">Todavía no se guardó ninguna liquidación.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Nombre</th><th>Semana</th><th>Rakeback total</th>
                <th>Descontado</th><th>Total pagado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id}>
                  <td>{dateShort(h.created_at)}</td>
                  <td>{h.nombre_grupo}</td>
                  <td className="muted">{dateShort(h.week_start)} - {dateShort(h.week_end)}</td>
                  <td>{usd(h.total)}</td>
                  <td>-{usd(Number(h.adelantos_aplicados) + Number(h.adelantos_manual) + Number(h.cargas_aplicadas ?? 0) + (h.filas || []).reduce((s: number, f: any) => s + (Number(f.ventas) || 0) + (Number(f.tickets) || 0), 0))}</td>
                  <td><strong>{usd(h.total_a_pagar)}</strong></td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn secondary small"
                      onClick={() =>
                        generarPdf({
                          nombreGrupo: h.nombre_grupo,
                          weekStart: h.week_start,
                          weekEnd: h.week_end,
                          filas: h.filas,
                          multiAgente: h.agent_ids.length > 1,
                          total: Number(h.total),
                          adelantosAplicados: Number(h.adelantos_aplicados),
                          adelantosManual: Number(h.adelantos_manual),
                          cargasAplicadas: Number(h.cargas_aplicadas ?? 0),
                          ventasTickets: (h.filas || []).reduce((s: number, f: any) => s + (Number(f.ventas) || 0) + (Number(f.tickets) || 0), 0),
                          nota: h.nota || "",
                        }).catch((err: any) => alertDialog(err.message || "No se pudo generar el PDF."))
                      }
                    >
                      Descargar PDF
                    </button>
                    <button
                      className="btn danger small"
                      disabled={borrandoHist === h.id}
                      onClick={async () => {
                        if (!(await confirmDialog(`¿Eliminar del historial la liquidación de "${h.nombre_grupo}" (${dateShort(h.week_start)})? Esto NO afecta ningún adelanto ya cruzado ni ningún cierre — solo borra este registro/foto.`))) return;
                        setBorrandoHist(h.id);
                        try {
                          await api.eliminarLiquidacionGuardada(h.id);
                          refrescarHistorial();
                        } catch (err: any) {
                          await alertDialog(err.message || "No se pudo eliminar.");
                        } finally {
                          setBorrandoHist(null);
                        }
                      }}
                    >
                      {borrandoHist === h.id ? "..." : "Eliminar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
