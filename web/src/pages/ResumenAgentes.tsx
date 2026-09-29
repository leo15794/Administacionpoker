import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";

// "Resumen por agente" (23/09/2026, pedido de Leo): réplica del "Estado de cuenta semanal" que
// ya arma a mano en Excel (PDF de referencia "Cierre El Latigo Loco") -- elegís semana + uno o
// varios agentes y baja un PDF con, para cada agente: resumen por club, detalle por jugador
// (solo para cierres aplicados desde que este sistema empezó a guardarlo -- ver
// repo/closings.ts), subagentes (jugadores con % de rakeback propio) y estado de cuenta. Es de
// SOLO LECTURA: no cambia nada del sistema, ver repo/agentesResumen.ts.
//
// (29/09/2026, pedido de Leo: "misma lógica que Liquidaciones" + "poder ver el preview antes de
// descargar") -- ahora hay un botón "+ Armar resumen" como punto de partida (nunca se arranca
// solo con tildar un agente), un Nombre a mano (no autocompleta con el del agente -- puede
// combinar varias identidades de un mismo agente real bajo un nombre elegido, igual que
// Liquidaciones), y antes de bajar el PDF se ve en pantalla exactamente lo mismo que va a
// terminar en el archivo ("Ver preview"), con un botón para volver a editar si algo no cierra.
// El "combinar" solo afecta la portada (resumen por club + estado de cuenta, que se suman entre
// todos los agentes elegidos, igual que hace Liquidaciones con sus totales) -- el detalle por
// jugador y los subagentes siguen apareciendo por separado, cada uno bajo el nombre real del
// agente al que pertenecen, para no perder de dónde sale cada número.
export default function ResumenAgentes() {
  const [agentes, setAgentes] = useState<any[] | null>(null);
  const [semanas, setSemanas] = useState<string[] | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [query, setQuery] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [nombreGrupo, setNombreGrupo] = useState("");
  // Sistema (30/09/2026, pedido de Leo: "elegir antes de armar el resumen si va a ser winlose o
  // prepago, así queda más prolijo") -- se manda al backend, que ya usa esto para decidir cómo
  // calcular "Cierre semanal" en el estado de cuenta (ver repo/agentesResumen.ts): en Prepago el
  // resultado de juego no es responsabilidad del agente, así que el cierre semanal es solo el
  // rakeback neto, no el total club entero como en Win/Lose.
  const [sistema, setSistema] = useState<"WIN_LOSE" | "PREPAGO">("WIN_LOSE");
  const [armando, setArmando] = useState(false);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.semanasConResumenAgente().then((s: string[]) => {
      setSemanas(s);
      if (s.length > 0) setWeekStart(s[0]);
    });
  }, []);

  function toggle(agentId: string) {
    setSeleccionados((s) => {
      const next = new Set(s);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function cancelarArmado() {
    setArmando(false);
    setSeleccionados(new Set());
    setNombreGrupo("");
    setSistema("WIN_LOSE");
    setQuery("");
    setPreview(null);
    setError("");
  }

  const filtrados = (agentes ?? []).filter(
    (a: any) => !query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function verPreview() {
    if (!nombreGrupo.trim()) return setError("Ponele un nombre a este resumen.");
    if (!weekStart) return setError("Elegí una semana.");
    if (seleccionados.size === 0) return setError("Elegí al menos un agente.");
    setCargandoPreview(true);
    setError("");
    try {
      const resultados = await Promise.all(
        Array.from(seleccionados).map((agentId) => api.resumenAgentePDF(agentId, weekStart, sistema).catch(() => null))
      );
      const datos = resultados.filter((r: any) => r);
      if (datos.length === 0) {
        setError("Ninguno de los agentes elegidos tiene un cierre aplicado en esa semana.");
        return;
      }
      setPreview(combinarResumen(datos, nombreGrupo.trim(), sistema));
    } catch (err: any) {
      setError(err.message || "No se pudo armar el preview.");
    } finally {
      setCargandoPreview(false);
    }
  }

  async function descargarPdf() {
    if (!preview) return;
    setGenerando(true);
    setError("");
    try {
      await generarResumenCombinadoPdf(preview);
    } catch (err: any) {
      setError(err.message || "No se pudo generar el PDF.");
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen por agente</h2>
          <div className="muted">
            Estado de cuenta semanal en PDF -- resumen por club, detalle por jugador (para cierres cargados desde
            ahora en adelante), subagentes y saldo. Se pueden combinar varias identidades de un mismo agente bajo un
            nombre a elección, igual que en Liquidaciones.
          </div>
        </div>
      </div>

      {!armando && !preview && (
        <div className="panel" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => setArmando(true)}>
            + Armar resumen
          </button>
        </div>
      )}

      {armando && !preview && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Nombre del resumen {seleccionados.size > 1 && "(varios agentes combinados)"}</label>
              <input value={nombreGrupo} onChange={(e) => setNombreGrupo(e.target.value)} placeholder="Ej: Prodigio" style={{ width: 220 }} autoFocus />
            </div>
            <button type="button" className="btn secondary small" onClick={cancelarArmado}>
              Cancelar
            </button>
          </div>

          <div className="field">
            <label>Sistema</label>
            <select value={sistema} onChange={(e) => setSistema(e.target.value as "WIN_LOSE" | "PREPAGO")}>
              <option value="WIN_LOSE">Win/Lose</option>
              <option value="PREPAGO">Prepago</option>
            </select>
          </div>

          <div className="field">
            <label>Semana</label>
            {!semanas ? (
              <span className="muted">Cargando...</span>
            ) : semanas.length === 0 ? (
              <span className="muted">Todavía no hay ningún cierre aplicado.</span>
            ) : (
              <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                {semanas.map((s) => (
                  <option key={s} value={s}>{dateShort(s)}</option>
                ))}
              </select>
            )}
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Agentes ({seleccionados.size} elegido{seleccionados.size === 1 ? "" : "s"})</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar agente..." />
          </div>

          {!agentes ? (
            <div className="muted" style={{ marginTop: 10 }}>Cargando...</div>
          ) : (
            <>
              {filtrados.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn secondary small" onClick={() => setSeleccionados((s) => new Set([...s, ...filtrados.map((a: any) => a.id)]))}>
                    Seleccionar todos
                  </button>
                  <button className="btn secondary small" onClick={() => setSeleccionados((s) => new Set([...s].filter((id) => !filtrados.some((a: any) => a.id === id))))}>
                    Deseleccionar todos
                  </button>
                </div>
              )}
              <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {filtrados.map((a: any) => (
                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={seleccionados.has(a.id)} onChange={() => toggle(a.id)} />
                    {a.name}
                  </label>
                ))}
                {filtrados.length === 0 && <div className="muted">Sin resultados.</div>}
              </div>
            </>
          )}

          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

          <button className="btn" style={{ marginTop: 14 }} disabled={cargandoPreview} onClick={verPreview}>
            {cargandoPreview ? "Armando preview..." : "Ver preview"}
          </button>
        </div>
      )}

      {preview && (
        <PreviewResumen
          preview={preview}
          generando={generando}
          error={error}
          onDescargar={descargarPdf}
          onVolver={() => setPreview(null)}
          onCancelar={cancelarArmado}
        />
      )}
    </div>
  );
}

// Junta el resumen por club y el estado de cuenta de todos los agentes elegidos en UNA sola
// portada (mismos totales que hoy suma Liquidaciones para combinar varias identidades de un
// mismo agente real) -- el detalle por jugador y los subagentes NO se combinan, quedan tal cual
// vinieron de cada agente (ver "porAgente" más abajo) para no perder a quién pertenece cada fila.
function combinarResumen(datos: any[], nombreGrupo: string, sistema: "WIN_LOSE" | "PREPAGO") {
  const clubesCombinado = datos.flatMap((r: any) => r.clubes);
  const sum = (fn: (r: any) => number) => datos.reduce((s: number, r: any) => s + fn(r), 0);
  const saldoAnterior = sum((r) => r.estadoCuenta.saldoAnterior);
  const cierreSemanal = sum((r) => r.estadoCuenta.cierreSemanal);
  const pagosPosteriores = sum((r) => r.estadoCuenta.pagosPosteriores);
  const saldoOperativoFinal = saldoAnterior + cierreSemanal + pagosPosteriores;
  // fichasAdelantadasPendientes (29/09/2026, pedido de Leo): ya está incluido en saldoAnterior
  // (ver ADELANTO_FICHAS en deltaParaBalance/repo/agentesResumen.ts) -- esto es solo para
  // mostrarlo aparte, así queda claro cuánto de ese saldo es por fichas adelantadas sin cobrar.
  const fichasAdelantadasPendientes = sum((r) => r.estadoCuenta.fichasAdelantadasPendientes);
  return {
    nombreGrupo,
    sistema,
    weekStart: datos[0].weekStart,
    weekEnd: datos[0].weekEnd,
    clubesCombinado,
    estadoCuentaCombinado: {
      saldoAnterior,
      cierreSemanal,
      pagosPosteriores,
      saldoOperativoFinal,
      nosDebe: saldoOperativoFinal < 0 ? -saldoOperativoFinal : 0,
      debemos: saldoOperativoFinal > 0 ? saldoOperativoFinal : 0,
      situacion: saldoOperativoFinal < 0 ? "AGENTE ENVÍA" : saldoOperativoFinal > 0 ? "NOSOTROS ENVIAMOS" : "AL DÍA",
      fichasAdelantadasPendientes,
    },
    porAgente: datos,
  };
}

// Vista en pantalla de exactamente lo que va a bajar en el PDF (portada combinada + detalle por
// club de cada agente + subagentes) -- para poder revisarlo antes de descargar el archivo.
function PreviewResumen({
  preview,
  generando,
  error,
  onDescargar,
  onVolver,
  onCancelar,
}: {
  preview: any;
  generando: boolean;
  error: string;
  onDescargar: () => void;
  onVolver: () => void;
  onCancelar: () => void;
}) {
  const mostrarRodeo = preview.clubesCombinado.some((c: any) => Number(c.rodeo) !== 0);
  const mostrarAjuste = preview.clubesCombinado.some((c: any) => Number(c.ajusteManual) !== 0);
  const sumClub = (fn: (c: any) => number) => preview.clubesCombinado.reduce((s: number, c: any) => s + fn(c), 0);
  const notasAjuste = preview.clubesCombinado.filter((c: any) => Number(c.ajusteManual) !== 0 && c.ajusteManualNota);
  const ec = preview.estadoCuentaCombinado;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <strong>{preview.nombreGrupo}</strong>
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            Cierre {dateShort(preview.weekStart)} - {dateShort(preview.weekEnd)} · {preview.sistema === "PREPAGO" ? "Prepago" : "Win/Lose"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn secondary small" onClick={onVolver}>
            Volver a editar
          </button>
          <button type="button" className="btn secondary small" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      </div>

      <h3 style={{ marginBottom: 8 }}>Resumen por club</h3>
      <table>
        <thead>
          <tr>
            <th>Club</th>
            <th>Resultado</th>
            <th>Rebate</th>
            <th>Rakeback bruto</th>
            <th>Rakeback neto</th>
            {mostrarRodeo && <th>Rodeo</th>}
            {mostrarAjuste && <th>Ajuste</th>}
            <th>Total club</th>
          </tr>
        </thead>
        <tbody>
          {preview.clubesCombinado.map((c: any, i: number) => (
            <tr key={i}>
              <td>{c.clubName}</td>
              <td>{usd(c.resultado)}</td>
              <td>{usd(c.rebate)}</td>
              <td>{usd(c.rakebackBruto)}</td>
              <td>{usd(c.rakebackNeto)}</td>
              {mostrarRodeo && <td>{usd(c.rodeo)}</td>}
              {mostrarAjuste && <td>{usd(c.ajusteManual)}</td>}
              <td>{usd(c.totalClub)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>TOTAL SEMANAL</strong></td>
            <td><strong>{usd(sumClub((c) => c.resultado))}</strong></td>
            <td><strong>{usd(sumClub((c) => c.rebate))}</strong></td>
            <td><strong>{usd(sumClub((c) => c.rakebackBruto))}</strong></td>
            <td><strong>{usd(sumClub((c) => c.rakebackNeto))}</strong></td>
            {mostrarRodeo && <td><strong>{usd(sumClub((c) => c.rodeo))}</strong></td>}
            {mostrarAjuste && <td><strong>{usd(sumClub((c) => c.ajusteManual))}</strong></td>}
            <td><strong>{usd(sumClub((c) => c.totalClub))}</strong></td>
          </tr>
        </tfoot>
      </table>

      {notasAjuste.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {notasAjuste.map((c: any, i: number) => (
            <div key={i}>Ajuste {c.clubName} ({usd(c.ajusteManual)}): {c.ajusteManualNota}</div>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Estado de cuenta</h3>
      <table style={{ maxWidth: 420 }}>
        <tbody>
          <tr><td>Saldo anterior</td><td>{usd(ec.saldoAnterior)}</td></tr>
          <tr><td>Cierre semanal</td><td>{usd(ec.cierreSemanal)}</td></tr>
          <tr><td>Pagos / movimientos de la semana</td><td>{usd(ec.pagosPosteriores)}</td></tr>
          <tr><td><strong>Saldo operativo final</strong></td><td><strong>{usd(ec.saldoOperativoFinal)}</strong></td></tr>
          {/* (29/09/2026, pedido de Leo: "necesito poder ver las fichas que se le cargaron y
              estan pendiente de cobrar") -- solo Prepago, que es la modalidad que usa esto (ver
              nota en repo/advances.ts). Ya está incluido en Saldo anterior, se muestra aparte
              solo como referencia de cuánto de eso es por esto. */}
          {preview.sistema === "PREPAGO" && Number(ec.fichasAdelantadasPendientes) > 0 && (
            <tr><td className="muted">Fichas adelantadas pendientes de cobro</td><td className="muted">{usd(ec.fichasAdelantadasPendientes)}</td></tr>
          )}
          <tr><td>Nos debe</td><td>{usd(ec.nosDebe)}</td></tr>
          <tr><td>Debemos / saldo a favor</td><td>{usd(ec.debemos)}</td></tr>
          <tr><td>Situación</td><td>{ec.situacion}</td></tr>
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Saldo anterior (solo cargas/descargas de fichas antes de esta semana) y movimientos de la semana reconstruidos
        del historial de movimientos; no incluye pagos financieros de rakeback pendiente.
      </div>

      {preview.porAgente.map((r: any) => (
        <div key={r.agentId}>
          {r.detallePorClub
            .filter((club: any) => club.jugadores.length > 0)
            .map((club: any) =>
              club.jugadores.map((j: any, i: number) => (
                <div key={`${club.clubId}-${i}`} style={{ marginTop: 20 }}>
                  <h3 style={{ marginBottom: 4 }}>Jugador / cuenta: {j.playerName}</h3>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    Club: {club.clubName}
                    {j.subagenteName && <> · Subagente: {j.subagenteName}</>}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Resultado</th>
                        <th>Rake</th>
                        <th>Rebate {pct(j.rebatePct)}</th>
                        <th>Rakeback {pct(j.rakebackPct)}</th>
                        <th>Rakeback neto</th>
                        <th>Cierre semanal</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>{usd(j.resultado)}</td>
                        <td>{usd(j.rake)}</td>
                        <td>{usd(j.rebate)}</td>
                        <td>{usd(j.rakebackBruto)}</td>
                        <td>{usd(j.rakebackNeto)}</td>
                        <td>{usd(j.cierre)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <table style={{ maxWidth: 460, marginTop: 8 }}>
                    <tbody>
                      <tr><td>Resultado de juego</td><td>{usd(j.resultado)}</td></tr>
                      <tr><td>Rebate = (resultado + rake) × {pct(j.rebatePct)}</td><td>{usd(j.rebate)}</td></tr>
                      <tr><td>Rakeback bruto = rake × {pct(j.rakebackPct)}</td><td>{usd(j.rakebackBruto)}</td></tr>
                      <tr><td>Rakeback neto = rakeback + rebate</td><td>{usd(j.rakebackNeto)}</td></tr>
                      <tr><td><strong>Cierre semanal = resultado + rakeback neto</strong></td><td><strong>{usd(j.cierre)}</strong></td></tr>
                    </tbody>
                  </table>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Cierre individual del período; no incluye saldo anterior ni pagos posteriores.
                  </div>
                </div>
              ))
            )}

          {r.subagentes.length > 0 && (
            <div>
              <h3 style={{ marginTop: 20, marginBottom: 8 }}>Liquidación de subagentes · {r.agentName}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Subagente</th>
                    <th>Club</th>
                    <th>Resultado</th>
                    <th>Rake</th>
                    <th>% RB principal</th>
                    <th>RB principal</th>
                    <th>% RB subagente</th>
                    <th>RB subagente</th>
                    <th>Margen principal</th>
                    <th>Cierre subagente</th>
                    <th>Impacto principal</th>
                  </tr>
                </thead>
                <tbody>
                  {r.subagentes.map((s: any, i: number) => (
                    <tr key={i}>
                      <td>{s.subagenteName}</td>
                      <td>{s.clubName}</td>
                      <td>{usd(s.resultado)}</td>
                      <td>{usd(s.rake)}</td>
                      <td>{pct(s.rakebackPctPrincipal)}</td>
                      <td>{usd(s.rakebackPrincipal)}</td>
                      <td>{pct(s.rakebackPctSubagente)}</td>
                      <td>{usd(s.rakebackSubagente)}</td>
                      <td>{usd(s.margenPrincipal)}</td>
                      <td>{usd(s.cierreSubagente)}</td>
                      <td>{usd(s.impactoPrincipal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                {r.subagentes.map((s: any, i: number) => (
                  <div key={i}>{s.subagenteName}: {s.jugadores.join(" + ")}.</div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      <button className="btn" style={{ marginTop: 20 }} disabled={generando} onClick={onDescargar}>
        {generando ? "Generando..." : "Descargar PDF"}
      </button>
    </div>
  );
}

// Arma el PDF a partir de lo mismo que ya se ve en el preview: una portada combinada (resumen
// por club + estado de cuenta bajo el nombre elegido), seguida de una página por club con
// detalle de jugadores (si hay) y una página de subagentes, por cada agente original -- todo en
// UN SOLO archivo.
async function generarResumenCombinadoPdf(preview: any) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const margen = 14;

  function encabezado(titulo: string) {
    doc.setFillColor(40, 50, 90);
    doc.rect(0, 0, 210, 14, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(titulo, 105, 9.5, { align: "center" });
    doc.setTextColor(0);
  }

  let y = 22;

  // --- Portada combinada: estado de cuenta semanal ---
  encabezado("ESTADO DE CUENTA SEMANAL");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Nombre", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(preview.nombreGrupo, margen + 26, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Período", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${dateShort(preview.weekStart)} al ${dateShort(preview.weekEnd)}`, margen + 26, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Sistema", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(preview.sistema === "PREPAGO" ? "Prepago" : "Win/Lose", margen + 26, y);
  y += 8;

  const mostrarRodeo = preview.clubesCombinado.some((c: any) => Number(c.rodeo) !== 0);
  const mostrarAjuste = preview.clubesCombinado.some((c: any) => Number(c.ajusteManual) !== 0);
  const headResumen = [
    "Club", "Resultado", "Rebate", "Rakeback bruto", "Rakeback neto",
    ...(mostrarRodeo ? ["Rodeo"] : []), ...(mostrarAjuste ? ["Ajuste"] : []), "Total club",
  ];
  const bodyResumen = preview.clubesCombinado.map((c: any) => [
    c.clubName, usd(c.resultado), usd(c.rebate), usd(c.rakebackBruto), usd(c.rakebackNeto),
    ...(mostrarRodeo ? [usd(c.rodeo)] : []), ...(mostrarAjuste ? [usd(c.ajusteManual)] : []), usd(c.totalClub),
  ]);
  const sumClub = (fn: (c: any) => number) => preview.clubesCombinado.reduce((s: number, c: any) => s + fn(c), 0);
  const footResumen = [
    "TOTAL SEMANAL", usd(sumClub((c: any) => c.resultado)), usd(sumClub((c: any) => c.rebate)),
    usd(sumClub((c: any) => c.rakebackBruto)), usd(sumClub((c: any) => c.rakebackNeto)),
    ...(mostrarRodeo ? [usd(sumClub((c: any) => c.rodeo))] : []),
    ...(mostrarAjuste ? [usd(sumClub((c: any) => c.ajusteManual))] : []),
    usd(sumClub((c: any) => c.totalClub)),
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [headResumen],
    body: bodyResumen,
    foot: [footResumen],
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [40, 50, 90] },
    footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  const notasAjuste = preview.clubesCombinado.filter((c: any) => Number(c.ajusteManual) !== 0 && c.ajusteManualNota);
  if (notasAjuste.length > 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(90);
    notasAjuste.forEach((c: any) => {
      doc.text(`Ajuste ${c.clubName} (${usd(c.ajusteManual)}): ${c.ajusteManualNota}`, margen, y);
      y += 4;
    });
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
  }
  y += 6;

  const ec = preview.estadoCuentaCombinado;
  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Estado de cuenta", "Importe"]],
    body: [
      ["Saldo anterior", usd(ec.saldoAnterior)],
      ["Cierre semanal", usd(ec.cierreSemanal)],
      ["Pagos / movimientos de la semana", usd(ec.pagosPosteriores)],
      ["Saldo operativo final", usd(ec.saldoOperativoFinal)],
      ...(preview.sistema === "PREPAGO" && Number(ec.fichasAdelantadasPendientes) > 0
        ? [["Fichas adelantadas pendientes de cobro", usd(ec.fichasAdelantadasPendientes)]]
        : []),
      ["Nos debe", usd(ec.nosDebe)],
      ["Debemos / saldo a favor", usd(ec.debemos)],
      ["Situación", ec.situacion],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 50, 90] },
    didParseCell: (data: any) => {
      if (data.row.section === "body" && data.row.index === 3) data.cell.styles.fontStyle = "bold";
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text("Saldo anterior (solo cargas/descargas de fichas antes de esta semana) y movimientos de la semana reconstruidos del historial; no incluye pagos financieros de rakeback pendiente.", margen, y);
  doc.setTextColor(0);

  // --- Una página "ESTADO DE CUENTA SEMANAL" por JUGADOR (no una tabla combinada por club) --
  // réplica exacta del PDF de referencia que pasó Leo ("Cierre El Latigo Loco"): cada jugador
  // tiene su propia página con la tabla de resultado/rake/rebate/rakeback y el desglose
  // "Detalle del cálculo" paso a paso -- más varias filas juntas en una tabla, esto es lo que
  // hacía el sistema viejo que se está igualando acá (30/09/2026).
  for (const r of preview.porAgente) {
    for (const club of r.detallePorClub) {
      for (const j of club.jugadores) {
        doc.addPage();
        encabezado("ESTADO DE CUENTA SEMANAL");
        y = 22;
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Jugador / cuenta", margen, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(j.playerName), margen + 38, y);
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Período", margen, y);
        doc.setFont("helvetica", "normal");
        doc.text(`${dateShort(r.weekStart)} al ${dateShort(r.weekEnd)}`, margen + 38, y);
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Club", margen, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(club.clubName), margen + 38, y);
        if (j.subagenteName) {
          y += 6;
          doc.setFont("helvetica", "bold");
          doc.text("Subagente", margen, y);
          doc.setFont("helvetica", "normal");
          doc.text(String(j.subagenteName), margen + 38, y);
        }
        y += 8;

        autoTable(doc, {
          startY: y,
          margin: { left: margen, right: margen },
          head: [["Resultado", "Rake", `Rebate ${pct(j.rebatePct)}`, `Rakeback ${pct(j.rakebackPct)}`, "Rakeback neto", "Cierre semanal"]],
          body: [[usd(j.resultado), usd(j.rake), usd(j.rebate), usd(j.rakebackBruto), usd(j.rakebackNeto), usd(j.cierre)]],
          styles: { fontSize: 9 },
          headStyles: { fillColor: [40, 50, 90] },
        });
        y = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: y,
          margin: { left: margen, right: margen },
          head: [["Detalle del cálculo", "Importe"]],
          body: [
            ["Resultado de juego", usd(j.resultado)],
            [`Rebate = (resultado + rake) × ${pct(j.rebatePct)}`, usd(j.rebate)],
            [`Rakeback bruto = rake × ${pct(j.rakebackPct)}`, usd(j.rakebackBruto)],
            ["Rakeback neto = rakeback + rebate", usd(j.rakebackNeto)],
            ["Cierre semanal = resultado + rakeback neto", usd(j.cierre)],
          ],
          styles: { fontSize: 9 },
          headStyles: { fillColor: [40, 50, 90] },
          didParseCell: (data: any) => {
            if (data.row.section === "body" && data.row.index === 4) data.cell.styles.fontStyle = "bold";
          },
        });
        y = (doc as any).lastAutoTable.finalY + 4;
        doc.setFontSize(7.5);
        doc.setTextColor(120);
        doc.text("Cierre individual del período; no incluye saldo anterior ni pagos posteriores.", margen, y);
        doc.setTextColor(0);
      }
    }

    if (r.subagentes.length > 0) {
      doc.addPage();
      encabezado(`LIQUIDACIÓN DE SUBAGENTES · ${r.agentName.toUpperCase()}`);
      y = 26;
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        head: [["Subagente", "Club", "Resultado", "Rake", "% RB principal", "RB principal", "% RB subagente", "RB subagente", "Margen principal", "Cierre subagente", "Impacto principal"]],
        body: r.subagentes.map((s: any) => [
          s.subagenteName, s.clubName, usd(s.resultado), usd(s.rake), pct(s.rakebackPctPrincipal), usd(s.rakebackPrincipal),
          pct(s.rakebackPctSubagente), usd(s.rakebackSubagente), usd(s.margenPrincipal), usd(s.cierreSubagente), usd(s.impactoPrincipal),
        ]),
        styles: { fontSize: 7.5 },
        headStyles: { fillColor: [40, 50, 90] },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      for (const s of r.subagentes) {
        doc.text(`${s.subagenteName}: ${s.jugadores.join(" + ")}.`, margen, y);
        y += 4;
      }
      doc.setTextColor(0);
    }
  }

  const nombreArchivo = `Cierre_${preview.nombreGrupo.replace(/[^a-z0-9]+/gi, "-")}_${preview.weekStart}_al_${preview.weekEnd}.pdf`;
  doc.save(nombreArchivo);
}
