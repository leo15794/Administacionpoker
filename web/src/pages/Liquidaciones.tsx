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
  // Deshacer último cruce (22/09/2026, pedido de Leo, "estamos probando"): guarda los ids de
  // movimiento del ÚLTIMO cruce de adelantos/cargas que se aplicó en esta liquidación, para
  // poder deshacerlo de un click sin ir a Adelantos ni tener que resetear toda la base. Solo
  // el último -- si se aplica otro cruce encima, el backend (eliminarMovimientoAdelanto /
  // eliminarMovimientoCarga) igual exige que sea el más reciente de cada adelanto/carga.
  const [ultimoCruceAdelantos, setUltimoCruceAdelantos] = useState<{ movIds: string[]; monto: number } | null>(null);
  const [ultimoCruceCargas, setUltimoCruceCargas] = useState<{ movIds: string[]; monto: number } | null>(null);
  const [deshaciendoCruce, setDeshaciendoCruce] = useState(false);
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
  // Pago en lote (22/09/2026, pedido de Leo): "Enviar" ahora puede tildar VARIAS filas a la vez
  // -- cada una con su propio importe (default: lo que le queda pendiente a ESA fila) y su
  // propio medio (fichas mueve el stock de ese club, USDT/Efectivo/Zelle no) -- y las manda
  // todas en un solo click. No es técnicamente "un asiento único" en el ledger (cada club es un
  // movimiento propio, fichas de un club no se pueden mezclar con las de otro), pero para el
  // usuario es una sola acción: si alguna fila falla, se avisa cuál sin frenar el resto. Keyed
  // por filaKey(f). "Recibir" (COBRO) sigue con movAgenteClub de abajo -- ahí nunca hubo
  // concepto de "por fila", el monto siempre fue el total de la liquidación.
  const [movFilas, setMovFilas] = useState<Record<string, { checked: boolean; monto: string; medio: string }>>({});
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
          setUltimoCruceAdelantos(null);
          setUltimoCruceCargas(null);
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

  function montoSugeridoParaFila(f: any) {
    // Si la fila tiene rakeback pendiente propio, ese es el monto correcto a sugerir (es lo que
    // ESE cierre generó de rakeback/rebate, no el total de toda la liquidación, que puede
    // combinar varios agentes/clubes). Si no tiene (cierre viejo, sin migrar), se cae al total
    // de la liquidación como hacía antes.
    if (f && f.rakebackPendienteId && f.rakebackPendienteDisponible !== null) {
      return Math.max(0, Number(f.rakebackPendienteDisponible)).toFixed(2);
    }
    return Math.abs(totalAPagar).toFixed(2);
  }

  function abrirMov(tipo: "PAGO" | "COBRO") {
    setMovAbierto(tipo);
    setMovMsg(null);
    if (tipo === "PAGO") {
      // Arranca con todas las filas que tienen algo pendiente tildadas (importe/medio sugerido
      // por fila) -- Leo destilda las que no quiere pagar ahora, o ajusta importe/medio de
      // cualquiera antes de confirmar.
      const filas: Record<string, { checked: boolean; monto: string; medio: string }> = {};
      (data?.filas ?? []).forEach((f: any) => {
        const monto = montoSugeridoParaFila(f);
        filas[filaKey(f)] = {
          checked: Number(monto) > 0,
          monto,
          medio: f.rakebackPendienteId ? "FICHAS" : "SIN_TESORERIA",
        };
      });
      setMovFilas(filas);
      return;
    }
    const primeraFila = data && data.filas.length > 0 ? data.filas[0] : null;
    setMovMonto(Math.abs(totalAPagar).toFixed(2));
    setMovMetodo("SIN_TESORERIA");
    if (primeraFila) {
      setMovAgenteClub(`${primeraFila.agentId}|${primeraFila.clubId}`);
    }
  }

  function actualizarMovFila(key: string, patch: Partial<{ checked: boolean; monto: string; medio: string }>) {
    setMovFilas((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function cambiarFilaMov(valor: string) {
    setMovAgenteClub(valor);
    if (movAbierto !== "PAGO") return;
    const [agentId, clubId] = valor.split("|");
    const fila = data?.filas.find((f: any) => f.agentId === agentId && f.clubId === clubId);
    setMovMonto(montoSugeridoParaFila(fila));
    setMovMetodo(fila?.rakebackPendienteId ? "FICHAS" : "SIN_TESORERIA");
  }

  async function registrarMov() {
    if (!movAbierto) return;

    if (movAbierto === "COBRO") {
      if (!movAgenteClub) return;
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
          type: "COBRO",
          agentId,
          clubId,
          amount: monto,
          paymentMethod: movMetodo,
          custodian: movMetodo === "EFECTIVO" ? movCustodio.trim() : undefined,
          occurredAt: new Date().toISOString(),
          observation: movObservacion.trim() || `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
        setMovMsg({ ok: true, text: "Cobro registrado y aplicado al ledger." });
        setMovObservacion("");
        if (seleccionados.length > 0 && weekStart) {
          const dataActualizada = await api.liquidacion(seleccionados, weekStart);
          setData(dataActualizada);
        }
      } catch (err: any) {
        setMovMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
      } finally {
        setRegistrandoMov(false);
      }
      return;
    }

    // PAGO en lote: todas las filas tildadas, cada una con su importe y medio propio. Si la
    // fila tiene su propia fila de rakeback pendiente (cierre nuevo, post-separación
    // stock/pendiente), paga DIRECTO contra esa fila -- Fichas mueve el stock (CARGA),
    // USDT/Efectivo/Zelle no (PAGO_RAKEBACK) -- en vez de un PAGO genérico que restaba del
    // stock sin saber que existía este pendiente (bug real que encontró Leo el 22/09/2026 con
    // triunfoepico). Los cierres viejos sin migrar (sin rakebackPendienteId) siguen con el
    // movimiento genérico de antes.
    const entradas = Object.entries(movFilas).filter(([, v]) => v.checked);
    if (entradas.length === 0) return setMovMsg({ ok: false, text: "Marcá al menos un agente." });
    for (const [, v] of entradas) {
      if (!(Number(v.monto) > 0)) return setMovMsg({ ok: false, text: "Todos los importes tildados tienen que ser mayores a 0." });
    }
    const necesitaCustodio = entradas.some(([, v]) => v.medio === "EFECTIVO");
    if (necesitaCustodio && !movCustodio.trim()) {
      return setMovMsg({ ok: false, text: "Un pago en efectivo requiere custodio (BIT-051/052)." });
    }

    setRegistrandoMov(true);
    setMovMsg(null);
    let exitos = 0;
    const errores: string[] = [];
    for (const [key, v] of entradas) {
      const fila = data?.filas.find((f: any) => filaKey(f) === key);
      if (!fila) continue;
      try {
        if (fila.rakebackPendienteId) {
          await api.pagarRakebackPendiente({
            pendienteId: fila.rakebackPendienteId,
            amount: Number(v.monto),
            medio: v.medio as "FICHAS" | "USDT" | "EFECTIVO" | "ZELLE",
            custodian: v.medio === "EFECTIVO" ? movCustodio.trim() : undefined,
            notes: movObservacion.trim() || `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
          });
        } else {
          await api.crearMovimiento({
            type: "PAGO",
            agentId: fila.agentId,
            clubId: fila.clubId,
            amount: Number(v.monto),
            paymentMethod: v.medio,
            custodian: v.medio === "EFECTIVO" ? movCustodio.trim() : undefined,
            occurredAt: new Date().toISOString(),
            observation: movObservacion.trim() || `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
          });
        }
        exitos++;
      } catch (err: any) {
        errores.push(`${fila.agentName} (${fila.clubName}): ${err.message || "error"}`);
      }
    }
    setMovMsg(
      errores.length === 0
        ? { ok: true, text: `${exitos} pago${exitos === 1 ? "" : "s"} registrado${exitos === 1 ? "" : "s"}.` }
        : {
            ok: false,
            text: `${exitos} pago${exitos === 1 ? "" : "s"} registrado${exitos === 1 ? "" : "s"}, ${errores.length} con error — ${errores.join(" · ")}`,
          }
    );
    setMovObservacion("");
    if (seleccionados.length > 0 && weekStart) {
      const dataActualizada = await api.liquidacion(seleccionados, weekStart);
      setData(dataActualizada);
    }
    setRegistrandoMov(false);
  }

  async function aplicarCruces() {
    const ids = Object.keys(cruces).filter((id) => cruces[id] > 0);
    if (ids.length === 0) return;
    if (!(await confirmDialog(`Se va a descontar ${usd(totalCruzado)} de ${ids.length} adelanto(s) — se puede deshacer con el botón "Deshacer último cruce" mientras no se aplique nada más encima de estos mismos adelantos. ¿Confirmás?`))) return;
    setAplicando(true);
    try {
      const movIds: string[] = [];
      for (const id of ids) {
        const r = await api.ajustarAdelanto({
          advanceId: id,
          type: "CONSUMO",
          amount: cruces[id],
          notes: `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
        if (r?.movementRowId) movIds.push(r.movementRowId);
      }
      setAplicado((prev) => prev + totalCruzado);
      setUltimoCruceAdelantos({ movIds, monto: totalCruzado });
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
    if (!(await confirmDialog(`Se va a descontar ${usd(totalCruzadoCarga)} de ${ids.length} carga(s) de tesorería — se puede deshacer con el botón "Deshacer último cruce" mientras no se aplique nada más encima de estas mismas cargas. ¿Confirmás?`))) return;
    setAplicando(true);
    try {
      const movIds: string[] = [];
      for (const id of ids) {
        const r = await api.consumirCarga({
          cargaId: id,
          amount: crucesCarga[id],
          notes: `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
        if (r?.movementRowId) movIds.push(r.movementRowId);
      }
      setAplicadoCarga((prev) => prev + totalCruzadoCarga);
      setUltimoCruceCargas({ movIds, monto: totalCruzadoCarga });
      refrescarLiquidacion(true);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo aplicar el cruce.");
    } finally {
      setAplicando(false);
    }
  }

  // Deshace el ÚLTIMO cruce aplicado (adelantos y/o cargas) en esta liquidación -- ver estado
  // ultimoCruceAdelantos/ultimoCruceCargas arriba. Sigue habiendo un límite real: si el mismo
  // adelanto/carga tuvo OTRO ajuste después (desde Adelantos, por ejemplo), el backend rechaza
  // ese movimiento puntual porque ya no es el más reciente -- ahí hay que ir a Adelantos/la
  // carga y deshacerlo en orden, del más nuevo hacia atrás.
  async function deshacerUltimoCruce() {
    if (!ultimoCruceAdelantos && !ultimoCruceCargas) return;
    const monto = (ultimoCruceAdelantos?.monto ?? 0) + (ultimoCruceCargas?.monto ?? 0);
    if (!(await confirmDialog(`¿Deshacer el último cruce aplicado (${usd(monto)})? El adelanto/carga vuelve a quedar pendiente como antes.`))) return;
    setDeshaciendoCruce(true);
    const errores: string[] = [];
    try {
      for (const id of ultimoCruceAdelantos?.movIds ?? []) {
        try {
          await api.eliminarMovimientoAdelanto(id);
        } catch (err: any) {
          errores.push(err.message || "No se pudo deshacer un cruce de adelanto.");
        }
      }
      for (const id of ultimoCruceCargas?.movIds ?? []) {
        try {
          await api.eliminarMovimientoCarga(id);
        } catch (err: any) {
          errores.push(err.message || "No se pudo deshacer un cruce de carga.");
        }
      }
      if (ultimoCruceAdelantos) setAplicado((prev) => Math.max(0, prev - ultimoCruceAdelantos.monto));
      if (ultimoCruceCargas) setAplicadoCarga((prev) => Math.max(0, prev - ultimoCruceCargas.monto));
      setUltimoCruceAdelantos(null);
      setUltimoCruceCargas(null);
      refrescarLiquidacion(true);
      if (errores.length > 0) await alertDialog(errores.join(" · "));
    } finally {
      setDeshaciendoCruce(false);
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
                <th>Rakeback pendiente</th>
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
                    <td className="muted" title={f.rakebackPendienteId ? "Lo que todavía no se pagó de esta fila -- pagalo con el botón \"Enviar\" de abajo." : "Cierre viejo (de antes de separar el stock del rakeback pendiente) -- no tiene fila propia acá."}>
                      {f.rakebackPendienteId ? usd(f.rakebackPendienteDisponible) : "—"}
                    </td>
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
                <td>{usd(data.filas.reduce((s: number, f: any) => s + (f.rakebackPendienteId ? Number(f.rakebackPendienteDisponible) : 0), 0))}</td>
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
                      Esto consume de verdad la carga (mismo efecto que "Consumo" en cargas de tesorería).
                    </span>
                  </div>
                </div>
              )}
              {(ultimoCruceAdelantos || ultimoCruceCargas) && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn secondary small" disabled={deshaciendoCruce} onClick={deshacerUltimoCruce}>
                    {deshaciendoCruce
                      ? "Deshaciendo..."
                      : `Deshacer último cruce (${usd((ultimoCruceAdelantos?.monto ?? 0) + (ultimoCruceCargas?.monto ?? 0))})`}
                  </button>
                  <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                    Vuelve el/los adelanto(s) o carga(s) a como estaban antes de aplicar el último cruce.
                  </span>
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

            {movAbierto === "PAGO" && (
              <div className="panel" style={{ marginTop: 10, maxWidth: 620 }}>
                <h4 style={{ marginTop: 0 }}>Registrar pago al agente</h4>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Tildá una o varias filas y mandalas juntas en un click — cada una con su propio importe y
                  medio (Fichas mueve el stock físico de ese club, USDT/Efectivo/Zelle es un pago financiero
                  que no lo toca). Es independiente de "Guardar en historial": podés enviar sin guardar, o
                  guardar sin enviar.
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => setMovFilas((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, checked: true }])))}
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => setMovFilas((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, checked: false }])))}
                  >
                    Ninguno
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Agente / club</th>
                      <th>Importe (USD)</th>
                      <th>Medio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.filas.map((f: any) => {
                      const key = filaKey(f);
                      const v = movFilas[key] ?? { checked: false, monto: "0", medio: "SIN_TESORERIA" };
                      return (
                        <tr key={key}>
                          <td>
                            <input
                              type="checkbox"
                              checked={v.checked}
                              onChange={(e) => actualizarMovFila(key, { checked: e.target.checked })}
                            />
                          </td>
                          <td>
                            {f.agentName} — {f.clubName}
                            {f.rakebackPendienteId && (
                              <div className="muted" style={{ fontSize: 11 }}>
                                Pendiente: {usd(f.rakebackPendienteDisponible)}
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              value={v.monto}
                              disabled={!v.checked}
                              onChange={(e) => actualizarMovFila(key, { monto: e.target.value })}
                              style={{ width: 110 }}
                            />
                          </td>
                          <td>
                            <select value={v.medio} disabled={!v.checked} onChange={(e) => actualizarMovFila(key, { medio: e.target.value })}>
                              {f.rakebackPendienteId ? (
                                <>
                                  <option value="FICHAS">Fichas (mueve el stock)</option>
                                  <option value="USDT">USDT</option>
                                  <option value="EFECTIVO">Efectivo</option>
                                  <option value="ZELLE">Zelle</option>
                                </>
                              ) : (
                                <>
                                  <option value="SIN_TESORERIA">Sin tesorería</option>
                                  <option value="USDT">USDT</option>
                                  <option value="EFECTIVO">Efectivo</option>
                                  <option value="ZELLE">Zelle</option>
                                  <option value="OTRO">Otro</option>
                                </>
                              )}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td></td>
                      <td><strong>Total tildado</strong></td>
                      <td colSpan={2}>
                        <strong>
                          {usd(Object.values(movFilas).reduce((s, v) => s + (v.checked ? Number(v.monto) || 0 : 0), 0))}
                        </strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
                {Object.values(movFilas).some((v) => v.checked && v.medio === "EFECTIVO") && (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Custodio del efectivo (aplica a todas las filas en efectivo)</label>
                    <input value={movCustodio} onChange={(e) => setMovCustodio(e.target.value)} placeholder="Quién tiene la plata físicamente" />
                  </div>
                )}
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Observación (opcional, se usa en todas las filas)</label>
                  <input
                    value={movObservacion}
                    onChange={(e) => setMovObservacion(e.target.value)}
                    placeholder={`Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim()}
                  />
                </div>
                {movMsg && <div className={movMsg.ok ? "success" : "error"}>{movMsg.text}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn" disabled={registrandoMov} onClick={registrarMov}>
                    {registrandoMov ? "Registrando..." : "Confirmar pago(s)"}
                  </button>
                  <button type="button" className="btn secondary" onClick={() => setMovAbierto(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {movAbierto === "COBRO" && (
              <div className="panel" style={{ marginTop: 10, maxWidth: 460 }}>
                <h4 style={{ marginTop: 0 }}>Registrar cobro al agente</h4>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Esto registra un movimiento real de COBRO contra la wallet (mismo efecto que cargarlo en
                  "Cargar movimiento"). Es independiente de "Guardar en historial": podés recibir sin
                  guardar, o guardar sin recibir.
                </div>
                <div className="field">
                  <label>Agente + club</label>
                  <select value={movAgenteClub} onChange={(e) => cambiarFilaMov(e.target.value)}>
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
                    {registrandoMov ? "Registrando..." : "Confirmar cobro"}
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
