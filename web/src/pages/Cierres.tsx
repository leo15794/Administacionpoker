import { useEffect, useState, useRef, Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import { useConfirmDialog } from "../components/ConfirmProvider";
import ActionsMenu from "../components/ActionsMenu";

// Monto en USD con color segun signo (verde positivo, rojo negativo) y sin salto de linea
// entre el "-" y el numero (Intl mete un espacio despues del simbolo de moneda que, en una
// columna angosta, el navegador puede usar como punto de corte).
function Monto({ value }: { value: number | string | null | undefined }) {
  if (value == null) return <span className="muted">-</span>;
  const n = Number(value);
  return <span className={`money ${n >= 0 ? "pos" : "neg"}`}>{usd(n)}</span>;
}

export default function Cierres() {
  const { alertDialog, promptDialog } = useConfirmDialog();
  // Deep-link desde otras pantallas (ej. Resumen financiero → "ver en Cierres" de una fila de
  // Ganancia cierres semanales): ?week=YYYY-MM-DD&club=<clubId> — expande esa semana aunque no
  // sea la más reciente, resalta sus filas (todas si no vino club, o solo las de ese club) y
  // hace scroll hasta ahí apenas cargan los cierres.
  const [searchParams] = useSearchParams();
  const weekObjetivo = searchParams.get("week");
  const clubObjetivo = searchParams.get("club");
  const [cierres, setCierres] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [bancados, setBancados] = useState<any[]>([]);
  const [adelantos, setAdelantos] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());

  function toggleExpandido(id: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Borrado en bloque — mientras se prueba el sistema (mismo BORRADO REAL de "Borrar" arriba,
  // aplicado a todos los cierres de una semana + club de un saque, en vez de uno por uno).
  const [semanaABorrar, setSemanaABorrar] = useState("");
  const [clubABorrar, setClubABorrar] = useState("");
  const [borrandoSemana, setBorrandoSemana] = useState(false);
  const semanasDisponibles = Array.from(new Set(cierres.map((c) => c.week_start))).sort().reverse();

  // Colapsar el cierre completo de una semana (todas sus filas), no solo el desglose de una
  // fila — para que la tabla no se vaya larguisimo para abajo cuando hay muchos agentes/clubes
  // cargados la misma semana. Por default se abre solo la semana mas reciente y el resto queda
  // colapsado; una vez que el usuario abre/cierra algo a mano, un refresh() no se lo pisa.
  const [semanasColapsadas, setSemanasColapsadas] = useState<Set<string>>(new Set());
  const colapsoInicial = useRef(false);
  useEffect(() => {
    if (colapsoInicial.current || cierres.length === 0) return;
    colapsoInicial.current = true;
    const semanas = Array.from(new Set(cierres.map((c) => c.week_start)));
    // La semana objetivo del deep-link queda siempre expandida, sea o no la más reciente.
    setSemanasColapsadas(new Set(semanas.slice(1).filter((s) => s !== weekObjetivo)));
  }, [cierres, weekObjetivo]);

  // Scroll + resaltado hasta la semana (y club, si vino) del deep-link — una sola vez, apenas
  // el DOM tiene esa fila renderizada (no antes: la semana recién se expandió arriba).
  const yaHizoScroll = useRef(false);
  useEffect(() => {
    if (!weekObjetivo || yaHizoScroll.current || cierres.length === 0) return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(`semana-${weekObjetivo}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        yaHizoScroll.current = true;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [cierres, weekObjetivo, semanasColapsadas]);

  function toggleSemanaColapsada(weekStart: string) {
    setSemanasColapsadas((prev) => {
      const next = new Set(prev);
      if (next.has(weekStart)) next.delete(weekStart);
      else next.add(weekStart);
      return next;
    });
  }

  // Cierres ya vienen ordenados por semana desc + nombre desde el backend — solo hace falta
  // agrupar filas consecutivas de la misma semana, no reordenar nada.
  const gruposPorSemana: { weekStart: string; weekEnd: string; filas: any[] }[] = [];
  for (const c of cierres) {
    const ultimo = gruposPorSemana[gruposPorSemana.length - 1];
    if (ultimo && ultimo.weekStart === c.week_start) ultimo.filas.push(c);
    else gruposPorSemana.push({ weekStart: c.week_start, weekEnd: c.week_end, filas: [c] });
  }

  async function borrarSemanaCompleta() {
    if (!semanaABorrar) return;
    const club = clubABorrar ? clubes.find((c) => c.id === clubABorrar) : null;
    const cantidad = cierres.filter(
      (c) => c.week_start === semanaABorrar && (!clubABorrar || c.club_id === clubABorrar)
    ).length;
    if (cantidad === 0) {
      await alertDialog("No hay cierres cargados con ese filtro.");
      return;
    }
    const confirmacion = await promptDialog(
      `Esto BORRA DEL TODO ${cantidad} cierre(s) de la semana ${dateShort(semanaABorrar)}${club ? ` en ${club.name}` : " (todos los clubes)"} — no queda en ningún historial, a diferencia de "Revertir".\n\nUsalo SOLO para limpiar datos de prueba, nunca sobre plata real ya operada.\n\nEscribí BORRAR para confirmar:`
    );
    if (confirmacion !== "BORRAR") return;
    setBorrandoSemana(true);
    try {
      const r = await api.eliminarCierresSemanaDefinitivo(semanaABorrar, clubABorrar || undefined);
      if (r.errores?.length > 0) {
        await alertDialog(`Se borraron ${r.borrados} de ${r.total} cierre(s). ${r.errores.length} no se pudieron borrar automáticamente (revisalos a mano):\n\n${r.errores.map((e: any) => e.message).join("\n")}`);
      }
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo borrar la semana.");
    } finally {
      setBorrandoSemana(false);
    }
  }

  function refresh() {
    api.cierres().then(setCierres);
    api.bancados().then(setBancados);
  }

  async function revertirCierre(c: any) {
    const motivo = await promptDialog(`Revertir cierre de ${c.agent_name} en ${c.club_name} (semana ${dateShort(c.week_start)} - ${dateShort(c.week_end)}).\n\n¿Por qué lo revertís? (queda en el historial, no se borra nada)`);
    if (motivo === null) return;
    setBorrando(c.id);
    try {
      await api.revertirCierre(c.id, motivo || undefined);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo revertir el cierre.");
    } finally {
      setBorrando(null);
    }
  }

  // BORRADO REAL — solo para limpiar datos de PRUEBA. Sobre plata real siempre "Revertir"
  // (arriba), nunca esto. Pide escribir "BORRAR" literal para no tocarlo por error de un clic.
  async function borrarDefinitivo(c: any) {
    const confirmacion = await promptDialog(
      `Esto BORRA DEL TODO el cierre de ${c.agent_name} en ${c.club_name} (semana ${dateShort(c.week_start)} - ${dateShort(c.week_end)}) — no queda en ningún historial, a diferencia de "Revertir".\n\nUsalo SOLO para limpiar datos de prueba, nunca sobre plata real ya operada.\n\nEscribí BORRAR para confirmar:`
    );
    if (confirmacion !== "BORRAR") return;
    setBorrando(c.id);
    try {
      await api.eliminarCierreDefinitivo(c.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo borrar el cierre.");
    } finally {
      setBorrando(null);
    }
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
    api.adelantos().then(setAdelantos).catch(() => {});
  }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cierres semanales</h2>
          <div className="muted">Clave idempotente (agente + club + semana) — un cierre nunca se aplica dos veces (BIT-001).</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn secondary" onClick={() => setShowImport((v) => !v)}>{showImport ? "Cerrar importador" : "Importar archivo"}</button>
          <button className="btn" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar formulario" : "+ Aplicar cierre"}</button>
        </div>
      </div>

      {showImport && (
        <ImportarCierre
          agentes={agentes}
          onDone={() => {
            refresh();
          }}
        />
      )}

      {showForm && (
        <NuevoCierre
          agentes={agentes}
          clubes={clubes}
          adelantos={adelantos}
          onApplied={() => {
            refresh();
            api.adelantos().then(setAdelantos).catch(() => {});
          }}
        />
      )}

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Historial de cierres</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={semanaABorrar} onChange={(e) => setSemanaABorrar(e.target.value)}>
              <option value="">Borrar semana...</option>
              {semanasDisponibles.map((w) => (
                <option key={w} value={w}>{dateShort(w)}</option>
              ))}
            </select>
            {semanaABorrar && (
              <select value={clubABorrar} onChange={(e) => setClubABorrar(e.target.value)}>
                <option value="">Todos los clubes</option>
                {clubes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {semanaABorrar && (
              <button
                className="btn secondary small"
                disabled={borrandoSemana}
                onClick={borrarSemanaCompleta}
                title="Borrado real de toda la semana (con el filtro de club, si elegiste uno) — solo para datos de prueba."
                style={{ color: "var(--danger, #e5484d)" }}
              >
                {borrandoSemana ? "Borrando..." : "Borrar todo"}
              </button>
            )}
          </div>
          <button
            className="btn secondary small"
            onClick={() =>
              exportCsv(
                "cierres_semanales.csv",
                cierres.map((c) => ({
                  semana_desde: c.week_start,
                  semana_hasta: c.week_end,
                  agente: c.agent_name,
                  club: c.club_name,
                  sistema: c.system,
                  jugadores: c.jugadores ?? "",
                  resultado: c.result,
                  rake: c.rake_total,
                  ring_game: c.ring_game ?? "",
                  mtt: c.mtt ?? "",
                  sng: c.sng ?? "",
                  rakeback: c.rakeback,
                  rodeo: c.rodeo,
                  cierre_final: c.final_closing,
                  regla: c.rule_applied ?? "",
                }))
              )
            }
          >
            Exportar CSV
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th></th><th>Agente</th><th>Club</th><th>Sistema</th>
              <th>Resultado</th><th>Rake</th><th>Rakeback</th><th>Cierre final</th><th>Extra</th><th></th>
            </tr>
          </thead>
          <tbody>
            {gruposPorSemana.map((g) => {
              const semanaColapsada = semanasColapsadas.has(g.weekStart);
              const cierreFinalSemana = g.filas.reduce((s, c) => s + Number(c.final_closing), 0);
              return (
                <Fragment key={g.weekStart}>
                  <tr
                    id={`semana-${g.weekStart}`}
                    className={`row-click${g.weekStart === weekObjetivo && !clubObjetivo ? " fila-destacada" : ""}`}
                    onClick={() => toggleSemanaColapsada(g.weekStart)}
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  >
                    <td colSpan={10}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span>{semanaColapsada ? "▸" : "▾"}</span>
                        <strong>{dateShort(g.weekStart)} - {dateShort(g.weekEnd)}</strong>
                        <span className="muted">({g.filas.length} cierre{g.filas.length === 1 ? "" : "s"})</span>
                        <span className="muted" style={{ marginLeft: "auto" }}>
                          Cierre final: <strong className={cierreFinalSemana >= 0 ? "pos" : "neg"}>{usd(cierreFinalSemana)}</strong>
                        </span>
                      </div>
                    </td>
                  </tr>
                  {!semanaColapsada &&
                    g.filas.map((c) => {
                      // Desglose Jugadores/Ring Game/MTT/SNG: solo existe en cierres de formato
                      // Suprema (Fenix/TeamBack Suprema) cargados despues de este cambio — el
                      // resto queda en NULL.
                      const tieneDesglose =
                        c.jugadores != null || c.ring_game != null || c.mtt != null || c.sng != null;
                      const abierto = expandido.has(c.id);
                      const esFilaObjetivo = g.weekStart === weekObjetivo && (!clubObjetivo || c.club_id === clubObjetivo);
                      return (
                        <Fragment key={c.id}>
                          <tr
                            className={esFilaObjetivo ? "fila-destacada" : undefined}
                            style={c.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}
                          >
                            <td>
                              {tieneDesglose && (
                                <button
                                  className="btn secondary small"
                                  onClick={() => toggleExpandido(c.id)}
                                  title={abierto ? "Ocultar desglose" : "Ver desglose (Jugadores / Ring Game / MTT / SNG)"}
                                  style={{ padding: "2px 8px" }}
                                >
                                  {abierto ? "▾" : "▸"}
                                </button>
                              )}
                            </td>
                            <td>{c.agent_name}</td>
                            <td>{c.club_name}</td>
                            <td className="muted">{c.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                            <td>{usd(c.result)}</td>
                            <td>{usd(c.rake_total)}</td>
                            <td>{usd(c.rakeback)}</td>
                            <td><span className={`badge ${Number(c.final_closing) >= 0 ? "pos" : "neg"}`}>{usd(c.final_closing)}</span></td>
                            <td>
                              {/* "Extra" junta Rodeo + Regla + Revertido en una sola columna, en blanco
                                  cuando no hay nada que mostrar (antes eran dos columnas separadas que
                                  mostraban "—" en casi todas las filas, puro ruido visual). */}
                              {c.status === "REVERTIDO" && <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>}
                              {c.rule_applied && <span className="badge neutral">{c.rule_applied}</span>}
                              {c.rodeo != null && Number(c.rodeo) !== 0 && (
                                <span className="muted" style={{ marginLeft: c.rule_applied ? 6 : 0 }}>
                                  Rodeo {usd(c.rodeo)}
                                </span>
                              )}
                              {c.rule_applied === "BANCADO" && (
                                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                                  Ganancia DigiPlayers: {usd(c.bancado_digiplayers_share)}
                                  {Number(c.bancado_debt_after) > 0 && <> · Memoria: {usd(c.bancado_debt_before)} → {usd(c.bancado_debt_after)}</>}
                                </div>
                              )}
                            </td>
                            <td className="row-actions">
                              {c.status !== "REVERTIDO" && (
                                <button
                                  className="btn secondary small"
                                  disabled={borrando === c.id}
                                  onClick={() => revertirCierre(c)}
                                  title="Revertir cierre (genera un ajuste opuesto, no borra nada)"
                                >
                                  {borrando === c.id ? "..." : "Revertir"}
                                </button>
                              )}
                              <ActionsMenu
                                items={[
                                  {
                                    label: borrando === c.id ? "Borrando..." : "Borrar (borrado real, sin rastro)",
                                    onClick: () => borrarDefinitivo(c),
                                    danger: true,
                                    disabled: borrando === c.id,
                                  },
                                ]}
                              />
                            </td>
                          </tr>
                          {abierto && tieneDesglose && (
                            <tr className="muted" style={{ background: "rgba(255,255,255,0.02)" }}>
                              <td colSpan={10}>
                                <div style={{ display: "flex", gap: 24, padding: "4px 0" }}>
                                  <span>Jugadores: <strong>{c.jugadores ?? "-"}</strong></span>
                                  <span>Ring Game: <strong>{c.ring_game != null ? usd(c.ring_game) : "-"}</strong></span>
                                  <span>MTT: <strong>{c.mtt != null ? usd(c.mtt) : "-"}</strong></span>
                                  <span>SNG: <strong>{c.sng != null ? usd(c.sng) : "-"}</strong></span>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {bancados.length > 0 && (
        <div className="panel">
          <h3>Memoria de bancados</h3>
          <div className="muted" style={{ marginBottom: 14 }}>
            Deuda eterna: cuando el rakeback de una semana no alcanza para cubrir la pérdida en mesa de un bancado, la diferencia
            queda acá y se descuenta de sus próximas semanas positivas antes de acreditarle nada.
          </div>
          <table>
            <thead><tr><th>Bancado</th><th>Club</th><th>Memoria pendiente</th><th>Saldo en ese club</th></tr></thead>
            <tbody>
              {bancados.map((b) => (
                <tr key={`${b.agent_id}_${b.club_id}`}>
                  <td>{b.agent_name}</td>
                  <td>{b.club_name}</td>
                  <td>
                    {Number(b.debt) > 0 ? <span className="badge neg">{usd(b.debt)}</span> : <span className="badge pos">Al día</span>}
                  </td>
                  <td>{usd(b.saldo_agente_club)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function mondayOf(dateStr: string) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function NuevoCierre({
  agentes,
  clubes,
  adelantos,
  onApplied,
}: {
  agentes: any[];
  clubes: any[];
  adelantos: any[];
  onApplied: () => void;
}) {
  const nav = useNavigate();
  const [agentId, setAgentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [system, setSystem] = useState<"PREPAGO" | "WIN_LOSE">("WIN_LOSE");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [result, setResult] = useState("");
  const [rakeTotal, setRakeTotal] = useState("0");
  const [rakebackPct, setRakebackPct] = useState("70");
  const [rebatePct, setRebatePct] = useState("0");
  // Rodeo (solo tiene sentido para SupremaPoker — Fenix/TeamBack Suprema) cargado a mano para
  // este cierre puntual: no pasa por la memoria automática por jugador (eso solo existe en la
  // importacion de archivo), es un monto directo que el usuario tipea y se suma al cierre tal
  // cual, igual que ya pasa con rakeTotal/rakebackPct en este mismo formulario.
  const [rodeoManual, setRodeoManual] = useState("0");
  // Ajuste manual ("tickets promocionales", 18/09/2026, pedido de Leo): monto libre en USD que
  // se carga a mano y se suma/resta directo al cierre final del agente — nunca sale de ningun
  // calculo automatico (ver engine/cierre.ts). La nota es obligatoria si el monto no es 0, para
  // que quede rastreable en el historial por que se cargo.
  const [ajusteManual, setAjusteManual] = useState("0");
  const [ajusteManualNota, setAjusteManualNota] = useState("");
  const [observation, setObservation] = useState("");
  // Clubes en fichas (hoy: X-Poker — ver Configuración → Clubes, campo "Unidad"): el reporte de
  // la plataforma viene en fichas, no en USD, y el valor de la ficha puede cambiar de una semana
  // a otra (hoy USD 1,20 según la planilla, pero es un parámetro, no una constante) — por eso se
  // pide acá, editable, en vez de hardcodearlo. Arranca con la tasa cargada en el club (current_rate)
  // pero SIEMPRE se puede pisar para esta carga puntual si cambió.
  const [valorFicha, setValorFicha] = useState("1");

  // La vista previa siempre viene del servidor (mismo motor, misma transacción con ROLLBACK)
  // para que nunca pueda mostrar un número distinto del que después se aplica de verdad.
  // previewKey identifica con qué valores de formulario se calculó — si el formulario cambia
  // después, la vista previa queda vieja y "Aplicar cierre" se bloquea hasta recalcular.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const agenteSeleccionado = agentes.find((a) => a.id === agentId);
  const esBancado = agenteSeleccionado?.account_type === "BANCADO";
  const clubSeleccionado = clubes.find((c) => c.id === clubId);
  const esFichas = clubSeleccionado?.unit === "FICHAS";
  // Aviso, no automatización: si el AGENTE (no el par agente+club — un agente sigue generando
  // rake en varios clubes a la vez, ver repo/advances.ts) tiene uno o más adelantos de rakeback
  // activos — puede tener varios a la vez, en clubes distintos — se le muestran todos al que
  // carga el cierre para que decida a mano si corresponde ir a Adelantos y registrar un Consumo
  // en alguno; el cierre se calcula y paga igual, completo, sin descontar nada solo.
  const adelantosDelAgente = adelantos.filter((a) => a.agent_id === agentId);
  const adelantoPendienteTotal = adelantosDelAgente.reduce((s, a) => s + (Number(a.amount) - Number(a.consumed)), 0);

  function elegirAgente(id: string) {
    setAgentId(id);
    invalidarPreview();
    const agente = agentes.find((a) => a.id === id);
    if (agente?.account_type === "BANCADO" && rebatePct === "0") {
      setRebatePct("50"); // default razonable: reparto 50/50 de la mesa, ajustable
    }
  }

  function elegirClub(id: string) {
    setClubId(id);
    invalidarPreview();
    const club = clubes.find((c) => c.id === id);
    // Precarga la tasa del club (ej. 1,20 para X-Poker) pero queda editable — si esta semana
    // cambió, se pisa acá sin tener que ir a Configuración → Clubes primero.
    if (club?.unit === "FICHAS") setValorFicha(String(club.current_rate ?? 1));
  }

  // Se llama en cada cambio de campo: solo invalida la CLAVE de la vista previa (deja de estar
  // "vigente"), pero no borra el resultado anterior — así se puede seguir mostrando el badge
  // "cambiaste algo, recalculá" en vez de que la vista previa desaparezca sin explicación.
  function invalidarPreview() {
    setPreviewKey(null);
    setPreviewError(null);
  }

  // Reset completo: para cuando se recalcula desde cero o se aplicó el cierre.
  function limpiarPreview() {
    setPreviewKey(null);
    setPreviewResult(null);
    setPreviewError(null);
  }

  function armarPayload() {
    // Clubes en fichas (X-Poker): "result"/"rakeTotal" del formulario son fichas crudas del
    // reporte — el motor de cierre siempre espera USD, así que se convierten acá, una sola vez,
    // con la tasa que se cargó arriba (editable por si cambió esta semana). Para cualquier otro
    // club, tasa = 1 y no cambia nada.
    const tasa = esFichas ? Number(valorFicha) || 1 : 1;
    return {
      agentId,
      clubId,
      weekStart,
      weekEnd,
      system,
      result: (Number(result) || 0) * tasa,
      rakeTotal: (Number(rakeTotal) || 0) * tasa,
      rakebackPct: (Number(rakebackPct) || 0) / 100,
      rebatePct: (Number(rebatePct) || 0) / 100,
      rodeoManual: Number(rodeoManual) || 0,
      ajusteManual: Number(ajusteManual) || 0,
      ajusteManualNota: ajusteManualNota.trim() || undefined,
      observation: observation.trim() || undefined,
      rateSnapshot: esFichas ? tasa : undefined,
    };
  }

  // Si hay ajuste manual cargado, la nota es obligatoria (para que quede rastreable en el
  // historial) — bloquea tanto la vista previa como el aplicar, igual que los demas requisitos.
  const ajusteManualSinNota = (Number(ajusteManual) || 0) !== 0 && !ajusteManualNota.trim();

  const claveActual = JSON.stringify(armarPayload());
  // Vista previa vigente = se calculó con exactamente los valores que hay cargados ahora.
  const previewVigente = previewKey === claveActual;

  async function calcularVistaPrevia() {
    if (!agentId || !clubId || !weekStart || !weekEnd) {
      setPreviewError("Agente, club y fechas de la semana son obligatorios.");
      return;
    }
    if (ajusteManualSinNota) {
      setPreviewError("Cargaste un ajuste manual: la nota (motivo) es obligatoria.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);
    const clave = claveActual;
    try {
      const r = await api.previsualizarCierre(armarPayload());
      if (r.alreadyApplied) {
        setPreviewError("Ya existe un cierre aplicado para ese agente+club+semana. No se puede volver a aplicar (BIT-001).");
      } else {
        setPreviewResult(r);
        setPreviewKey(clave);
      }
    } catch (err: any) {
      setPreviewError(err.message || "No se pudo calcular la vista previa — esto mismo bloquearía el cierre si lo intentaras aplicar.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!previewVigente || !previewResult) {
      setMsg({ ok: false, text: "Calculá la vista previa primero (o volvé a calcularla si cambiaste algún campo) antes de aplicar." });
      return;
    }
    setLoading(true);
    try {
      const r = await api.aplicarCierre(armarPayload());
      if (r.alreadyApplied) {
        setMsg({ ok: false, text: "Ya existe un cierre aplicado para ese agente+club+semana. No se duplicó nada (BIT-001)." });
      } else if (r.bancado) {
        setMsg({
          ok: true,
          text: `Cierre aplicado. Acreditado al bancado: ${usd(r.calc?.finalClosing ?? 0)}. Ganancia DigiPlayers (fichas en el club): ${usd(r.calc?.digiplayersShare ?? 0)}. Memoria: ${usd(r.calc?.deudaAnterior ?? 0)} → ${usd(r.calc?.deudaNueva ?? 0)}.`,
        });
        setResult("");
        setObservation("");
        limpiarPreview();
        onApplied();
      } else {
        setMsg({ ok: true, text: `Cierre aplicado. Cierre final: ${usd(r.calc?.finalClosing ?? 0)}` });
        setResult("");
        setObservation("");
        limpiarPreview();
        onApplied();
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el cierre." });
      limpiarPreview(); // si el servidor lo rechazó igual, la vista previa ya no vale — recalcular
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h3>Aplicar cierre semanal</h3>
      <div className="muted" style={{ marginBottom: 14 }}>
        {esBancado
          ? "Cuenta tipo Bancado: la mesa se reparte 50/50 (ajustable) y el rakeback es 100% del bancado — si viene con memoria pendiente, se descuenta antes de acreditarle nada."
          : "Se calcula con el mismo motor que valida las reglas especiales (ej. Manzur 75% rake) y se aplica como movimiento al ledger."}
        {" "}Primero calculá la vista previa (corre el cálculo real contra la base, sin guardar nada) — recién ahí se habilita aplicar.
      </div>

      {adelantosDelAgente.length > 0 && (
        <div className="warning" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>
            ⚠ {agenteSeleccionado?.name} tiene {adelantosDelAgente.length === 1 ? "un adelanto de rakeback activo" : `${adelantosDelAgente.length} adelantos de rakeback activos`} (en cualquier club): pendiente{" "}
            <strong>{usd(adelantoPendienteTotal)}</strong> en total
            {adelantosDelAgente.length > 1 && (
              <>
                {" "}({adelantosDelAgente.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ", "}
                    {usd(Number(a.amount) - Number(a.consumed))}{a.club_origen_name ? ` (${a.club_origen_name})` : ""}
                  </span>
                ))})
              </>
            )}
            . Este cierre se va a pagar completo — si corresponde descontar parte del rakeback de este cierre contra algún adelanto, hacelo a mano después en Adelantos.
          </span>
          <button type="button" className="btn secondary small" onClick={() => nav("/dashboard/adelantos")}>
            Ir a Adelantos
          </button>
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Agente</label>
            <select value={agentId} onChange={(e) => elegirAgente(e.target.value)}>
              <option value="">Elegir...</option>
              {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Club</label>
            <select value={clubId} onChange={(e) => elegirClub(e.target.value)}>
              <option value="">Elegir...</option>
              {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Sistema</label>
            <select value={system} onChange={(e) => { setSystem(e.target.value as any); invalidarPreview(); }}>
              <option value="WIN_LOSE">Win/Lose</option>
              <option value="PREPAGO">Prepago</option>
            </select>
          </div>
          <div className="field">
            <label>Semana desde</label>
            <input
              value={weekStart}
              onChange={(e) => {
                setWeekStart(e.target.value);
                invalidarPreview();
                if (e.target.value && !weekEnd) {
                  const monday = mondayOf(e.target.value);
                  const sunday = new Date(monday);
                  sunday.setDate(sunday.getDate() + 6);
                  setWeekEnd(sunday.toISOString().slice(0, 10));
                }
              }}
              type="date"
            />
          </div>
          <div className="field">
            <label>Semana hasta</label>
            <input value={weekEnd} onChange={(e) => { setWeekEnd(e.target.value); invalidarPreview(); }} type="date" />
          </div>
          <div className="field">
            <label>{esBancado ? "Resultado en la mesa (bancado ganó/perdió, USD)" : esFichas ? "Resultado (win/lose, fichas)" : "Resultado (win/lose, USD)"}</label>
            <input value={result} onChange={(e) => { setResult(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
          <div className="field">
            <label>{esFichas ? "Rake total (fichas)" : "Rake total (USD)"}</label>
            <input value={rakeTotal} onChange={(e) => { setRakeTotal(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
          {esFichas && (
            <div className="field">
              <label>Valor de la ficha (USD)</label>
              <input value={valorFicha} onChange={(e) => { setValorFicha(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
              <span className="muted" style={{ fontSize: 12 }}>
                {usd((Number(result) || 0) * (Number(valorFicha) || 0))} win/lose · {usd((Number(rakeTotal) || 0) * (Number(valorFicha) || 0))} rake
              </span>
            </div>
          )}
          <div className="field">
            <label>{esBancado ? "% Rakeback (100% para el bancado)" : "% Rakeback"}</label>
            <input value={rakebackPct} onChange={(e) => { setRakebackPct(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
          <div className="field">
            <label>{esBancado ? "% de la mesa para el bancado (si ganó)" : "% Rebate"}</label>
            <input value={rebatePct} onChange={(e) => { setRebatePct(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
          <div className="field">
            <label>Rodeo (opcional, USD)</label>
            <input value={rodeoManual} onChange={(e) => { setRodeoManual(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
            <span className="muted" style={{ fontSize: 12 }}>
              Solo si este club paga Rodeo (SupremaPoker) y este cierre no viene de una importación de archivo — se suma directo, sin memoria automática.
            </span>
          </div>
          <div className="field">
            <label>Ajuste manual (tickets promocionales, opcional, USD)</label>
            <input value={ajusteManual} onChange={(e) => { setAjusteManual(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
            <span className="muted" style={{ fontSize: 12 }}>
              Monto libre que se suma (o resta, si es negativo) directo al cierre final del agente — ej. tickets promocionales asignados a mano. Requiere nota.
            </span>
          </div>
          {Number(ajusteManual) !== 0 && (
            <div className="field">
              <label>Nota del ajuste manual (obligatoria)</label>
              <input value={ajusteManualNota} onChange={(e) => { setAjusteManualNota(e.target.value); invalidarPreview(); }} placeholder="Ej: ticket promocional torneo X" />
            </div>
          )}
        </div>
        <div className="field">
          <label>Observación (opcional)</label>
          <input value={observation} onChange={(e) => setObservation(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <button type="button" className="btn secondary" disabled={previewLoading} onClick={calcularVistaPrevia}>
            {previewLoading ? "Calculando..." : "Calcular vista previa"}
          </button>
          {previewVigente && <span className="badge pos">Vista previa lista — se puede aplicar</span>}
          {!previewVigente && previewResult && <span className="badge neutral">Cambiaste algo — recalculá la vista previa</span>}
        </div>

        {previewError && <div className="error" style={{ marginBottom: 12 }}>⚠ {previewError}</div>}

        {previewVigente && previewResult && !esBancado && (
          <div className="muted" style={{ marginBottom: 12 }}>
            Vista previa (real, calculada contra la base): rakeback {usd(previewResult.calc?.rakeback)} + rebate{" "}
            {usd(previewResult.calc?.rebate)} → cierre final{" "}
            <strong style={{ color: Number(previewResult.calc?.finalClosing) >= 0 ? "var(--green)" : "var(--red)" }}>
              {usd(previewResult.calc?.finalClosing)}
            </strong>
            {previewResult.calc?.ruleApplied && <> · regla especial aplicada: <span className="badge neutral">{previewResult.calc.ruleApplied}</span></>}
            {previewResult.supervisorAgentId && (
              <> · el rebate ({usd(previewResult.calc?.rebate)}) se desvía al rakeback centralizado del supervisor, no entra al saldo de este agente.</>
            )}
            {previewResult.routedToPartnerAccountName && (
              <> · <strong>este agente es una identidad de socio</strong>: no le forma balance propio — se acredita como {usd(-Number(previewResult.calc?.finalClosing))} en la cuenta de socio "{previewResult.routedToPartnerAccountName}" (Cuentas de socios).</>
            )}
          </div>
        )}
        {previewVigente && previewResult && esBancado && (
          <div className="muted" style={{ marginBottom: 12 }}>
            Vista previa (real, con la memoria pendiente ya aplicada): se acredita al bancado{" "}
            <strong style={{ color: Number(previewResult.calc?.finalClosing) >= 0 ? "var(--green)" : "var(--red)" }}>
              {usd(previewResult.calc?.finalClosing)}
            </strong>
            . Ganancia DigiPlayers (informativa): {usd(previewResult.calc?.digiplayersShare)}. Memoria:{" "}
            {usd(previewResult.calc?.deudaAnterior)} → {usd(previewResult.calc?.deudaNueva)}.
          </div>
        )}

        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading || !previewVigente || !previewResult} title={!previewVigente ? "Calculá la vista previa primero" : undefined}>
          {loading ? "Aplicando..." : "Aplicar cierre"}
        </button>
      </form>
    </div>
  );
}

type FilaImport = {
  key: string; // clubId|agentId
  clubId: string;
  clubName: string;
  agentId: string;
  agentName: string;
  jugadores: number;
  resultado: number;
  rakeTotal: number;
  ringGame?: number;
  mtt?: number;
  sngOtros?: number;
  // Solo Tiny GG (18/09/2026): informativo, se guarda junto al cierre pero no afecta el pago.
  bbjContribution?: number;
  system: "PREPAGO" | "WIN_LOSE";
  rakebackPct: number;
  rebatePct: number;
  configSource: "deal" | "sin_configurar";
  // "Rodeo" (solo SupremaPoker): lista cruda por jugador — el monto real que le toca al
  // agente sale recién del preview/apply (procesarRodeoAgenteTx aplica la memoria por jugador).
  rodeoJugadores: { playerExternalId: string; baseRodeo: number }[];
  // Detalle por jugador (23/09/2026, "Resumen por agente" en PDF) — se reenvía tal cual al
  // aplicar, para que el backend persista el desglose (repo/closings.ts).
  jugadoresDetalle: { playerExternalId: string; playerName: string; resultado: number; rake: number }[];
  // Ajuste manual ("tickets promocionales", 18/09/2026): monto libre en USD cargado a mano fila
  // por fila en esta misma grilla — se suma/resta directo al cierre final del agente (ver
  // engine/cierre.ts). ajusteManualNota es obligatoria si el monto no es 0.
  ajusteManual: string;
  ajusteManualNota: string;
  included: boolean;
  previewLoading: boolean;
  previewResult: any | null;
  previewError: string | null;
  applyLoading: boolean;
  applyResult: any | null;
  applyError: string | null;
};

// Importador de cierres (hoy: formato SupremaPoker, hojas Fénix/TeamBack — ver Clubes →
// Configurar → "Hoja de importación" para vincular cada club a su hoja). Nunca inventa el %
// de rakeback: siempre usa la configuración ya cargada en Agentes/Clubes. Reutiliza el mismo
// motor de vista previa/aplicar que el formulario manual, fila por fila, así nunca puede dar
// un número distinto al que se aplicaría cargando el cierre a mano.
function ImportarCierre({ agentes, onDone }: { agentes: any[]; onDone: () => void }) {
  const { alertDialog } = useConfirmDialog();
  const [file, setFile] = useState<File | null>(null);
  // Tiny GG: cada super agente baja su propio archivo — se suben varios juntos, a diferencia de
  // "file" (SUPREMA/GG) que es un solo .xlsx con varias hojas adentro.
  const [tinyFiles, setTinyFiles] = useState<File[]>([]);
  // Tiny GG: los números que trae el reporte de la plataforma NO están en USD (son una unidad
  // propia de Tiny/GG, plata china en la práctica) — hay que dividirlos por la tasa de ESA
  // semana para llegar a USD (confirmado por el usuario: reporte real 31/08-06/09/2026, tasa
  // 31,78). La tasa cambia semana a semana, así que se pide acá, editable, nunca hardcodeada —
  // se aplica una sola vez, al armar las filas de la previa (ver confirmarClubesYProcesar), y de
  // ahí en más todo el resto del flujo (previsualizar/aplicar) ya trabaja en USD como cualquier
  // otro club.
  const [tinyRate, setTinyRate] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [analizando, setAnalizando] = useState(false);
  const [analisisError, setAnalisisError] = useState<string | null>(null);
  const [hojasFormatoInvalido, setHojasFormatoInvalido] = useState<{ sheetName: string; motivo: string }[]>([]);
  // Una fila por cada hoja del archivo con formato válido — el club es SIEMPRE una elección
  // explícita del usuario, sin ningún auto-match ni precarga por nombre de hoja (se sacó: dos
  // clubes reales pueden compartir el mismo nombre de pestaña entre semanas, y guardar esa
  // asociación como default mezcló datos de un club con los de otro).
  const [hojasDetectadas, setHojasDetectadas] = useState<{ sheetName: string; clubIdSugerido: string | null }[]>([]);
  const [clubElegidoPorHoja, setClubElegidoPorHoja] = useState<Record<string, string>>({}); // sheetName -> clubId
  const [hojaIgnorada, setHojaIgnorada] = useState<Record<string, boolean>>({}); // sheetName -> se saltea esta semana
  const [confirmado, setConfirmado] = useState(false); // true = ya se eligió club para cada hoja y se procesó
  const [sinAgentePorClub, setSinAgentePorClub] = useState<{ clubId: string; clubName: string; items: any[] }[]>([]);
  // Superagentes que no existían en el catálogo y se crearon SOLOS en esta corrida porque el
  // archivo traía su nombre (ver repo/imports.ts::resolvePlayerAgent). Se muestra para que quede
  // claro que no fue "magia" — si algún nombre es en realidad un typo de un agente que ya
  // existía, se corrige a mano desde el Árbol de clubes (mover jugadores / eliminar el duplicado).
  const [agentesAutoCreados, setAgentesAutoCreados] = useState<{ agentId: string; agentName: string; agentIdRaw: string | null }[]>([]);
  // Jugadores marcados como "bancados" (pantalla Jugadores bancados) que aparecieron en el
  // archivo — se omiten del agregado del agente (ver repo/imports.ts) y se informan acá para
  // que el total que quedó afuera del cierre no desaparezca en silencio.
  const [bancadosPorClub, setBancadosPorClub] = useState<{ clubId: string; clubName: string; items: any[] }[]>([]);
  // Rebate Unión de Tiny (18/09/2026, pedido de Leo): lo que Tiny/la Unión nos reconoce a
  // NOSOTROS (nunca a los agentes) — un cálculo aparte del rebate por agente, a nivel de todo
  // el super agente. Solo se llena para plataforma TINY (ver repo/importsTinyGG.ts).
  const [tinyRebateUnionPorClub, setTinyRebateUnionPorClub] = useState<
    { clubId: string; clubName: string; items: any[] }[]
  >([]);
  // Version SIN dividir por la tasa (moneda propia de Tiny) -- es lo que se guarda al aplicar
  // (ver aplicarTodo), nunca la version de arriba que ya esta convertida a USD para mostrar.
  const [tinyRebateUnionRawPorClub, setTinyRebateUnionRawPorClub] = useState<
    { clubId: string; weekEnd: string; items: any[] }[]
  >([]);
  const [filas, setFilas] = useState<FilaImport[]>([]);
  const [asignando, setAsignando] = useState<Record<string, string>>({}); // playerId|clubId -> agentId elegido
  const [guardandoAsignacion, setGuardandoAsignacion] = useState<string | null>(null);
  const [previsualizandoTodo, setPrevisualizandoTodo] = useState(false);
  const [aplicandoTodo, setAplicandoTodo] = useState(false);
  const [resumenAplicacion, setResumenAplicacion] = useState<string | null>(null);
  // Clubes elegibles para el selector de esta hoja — TODOS los clubes activos, nunca filtrados
  // (la plataforma no bloquea nada, ver repo/imports.ts).
  const [clubesSuprema, setClubesSuprema] = useState<{ id: string; name: string }[]>([]);
  // Plataforma elegida arriba (pestañas) — SUPREMA y GG ya tienen parser propio; X-Poker
  // todavía muestra un aviso de "todavía no soportado" en vez del importador.
  const [plataforma, setPlataforma] = useState<"SUPREMA" | "GG" | "TINY" | "XPOKER">("SUPREMA");

  useEffect(() => {
    // Misma lista de "todos los clubes activos" para cualquier plataforma (ver nota en
    // repo/imports.ts sobre por qué nunca se filtra por plataforma acá) — se vuelve a pedir al
    // cambiar de pestaña solo por si se creó un club nuevo mientras tanto.
    const fetchClubes =
      plataforma === "GG"
        ? api.clubesImportacionTeamBackGG()
        : plataforma === "TINY"
        ? api.clubesImportacionTinyGG()
        : api.clubesImportacionSuprema();
    fetchClubes.then(setClubesSuprema).catch(() => setClubesSuprema([]));
  }, [plataforma]);

  // Paso 1: solo lee el archivo y arma la lista de hojas con formato válido (con una sugerencia
  // de club si el nombre matchea algo ya configurado). Todavía no calcula nada por agente — eso
  // recién pasa cuando se confirma a qué club corresponde cada hoja (paso 2).
  async function analizar() {
    if (plataforma === "TINY") {
      if (tinyFiles.length === 0) { setAnalisisError("Elegí uno o más archivos primero."); return; }
      if (!(Number(tinyRate) > 0)) { setAnalisisError("Cargá la tasa de esta semana (fichas por USD) antes de analizar."); return; }
    } else if (!file) {
      setAnalisisError("Elegí un archivo primero.");
      return;
    }
    if (!weekStart || !weekEnd) { setAnalisisError("Completá semana desde/hasta antes de analizar."); return; }
    setAnalizando(true);
    setAnalisisError(null);
    setResumenAplicacion(null);
    setConfirmado(false);
    setFilas([]);
    setSinAgentePorClub([]);
    setAgentesAutoCreados([]);
    setHojaIgnorada({});
    try {
      const r =
        plataforma === "GG"
          ? await api.previsualizarImportacionTeamBackGG(file!, weekEnd)
          : plataforma === "TINY"
          ? await api.previsualizarImportacionTinyGG(tinyFiles, weekEnd)
          : await api.previsualizarImportacion(file!, weekEnd);
      setHojasFormatoInvalido((r.hojasNoReconocidas || []).filter((h: any) => !h.resolvable));
      const sugerencias: Record<string, string> = {};
      const detectadas: { sheetName: string; clubIdSugerido: string | null }[] = [];
      for (const club of r.clubes || []) {
        detectadas.push({ sheetName: club.sheetName, clubIdSugerido: club.clubId });
        sugerencias[club.sheetName] = club.clubId;
      }
      for (const h of (r.hojasNoReconocidas || []).filter((h: any) => h.resolvable)) {
        detectadas.push({ sheetName: h.sheetName, clubIdSugerido: null });
      }
      setHojasDetectadas(detectadas);
      setClubElegidoPorHoja(sugerencias);
    } catch (err: any) {
      setAnalisisError(err.message || "No se pudo leer el archivo.");
    } finally {
      setAnalizando(false);
    }
  }

  // Paso 2: con el club ya elegido para cada hoja (sugerido o cambiado a mano), vuelve a mandar
  // el mismo archivo con esa elección explícita — el backend la usa siempre, sin importar si el
  // nombre de la hoja coincide o no con algo configurado.
  async function confirmarClubesYProcesar() {
    if (plataforma === "TINY" ? tinyFiles.length === 0 : !file) return;
    setAnalizando(true);
    setAnalisisError(null);
    try {
      const hojasAProcesar = hojasDetectadas.filter((h) => !hojaIgnorada[h.sheetName]);
      const overrides: Record<string, string> = {};
      for (const h of hojasAProcesar) {
        if (clubElegidoPorHoja[h.sheetName]) overrides[h.sheetName] = clubElegidoPorHoja[h.sheetName];
      }
      const ignoradas = hojasDetectadas.filter((h) => hojaIgnorada[h.sheetName]).map((h) => h.sheetName);
      const r =
        plataforma === "GG"
          ? await api.previsualizarImportacionTeamBackGG(file!, weekEnd, overrides, ignoradas)
          : plataforma === "TINY"
          ? await api.previsualizarImportacionTinyGG(tinyFiles, weekEnd, overrides, ignoradas)
          : await api.previsualizarImportacion(file!, weekEnd, overrides, ignoradas);
      setConfirmado(true);
      setSinAgentePorClub(
        (r.clubes || [])
          .filter((c: any) => c.sinAgente?.length > 0)
          .map((c: any) => ({ clubId: c.clubId, clubName: c.clubName, items: c.sinAgente }))
      );
      setBancadosPorClub(
        (r.clubes || [])
          .filter((c: any) => c.bancados?.length > 0)
          .map((c: any) => ({ clubId: c.clubId, clubName: c.clubName, items: c.bancados }))
      );
      setAgentesAutoCreados(r.agentesAutoCreados || []);
      // Tiny GG: acá es donde se convierte fichas -> USD, una sola vez, dividiendo por la tasa
      // de esta semana (ver estado tinyRate más arriba). Para cualquier otra plataforma, tasa=1
      // y no cambia nada.
      const tasa = plataforma === "TINY" ? Number(tinyRate) || 1 : 1;
      const nuevasFilas: FilaImport[] = [];
      for (const club of r.clubes || []) {
        for (const a of club.agentes) {
          nuevasFilas.push({
            key: `${club.clubId}|${a.agentId}`,
            clubId: club.clubId,
            clubName: club.clubName,
            agentId: a.agentId,
            agentName: a.agentName,
            jugadores: a.jugadores,
            resultado: Math.round((a.resultado / tasa) * 100) / 100,
            rakeTotal: Math.round((a.rakeTotal / tasa) * 100) / 100,
            ringGame: a.ringGame !== undefined ? Math.round((a.ringGame / tasa) * 100) / 100 : undefined,
            mtt: a.mtt !== undefined ? Math.round((a.mtt / tasa) * 100) / 100 : undefined,
            sngOtros: a.sngOtros !== undefined ? Math.round((a.sngOtros / tasa) * 100) / 100 : undefined,
            bbjContribution: a.bbjContribution,
            system: a.system,
            rakebackPct: a.rakebackPct,
            rebatePct: a.rebatePct,
            configSource: a.configSource,
            rodeoJugadores: a.rodeoJugadores ?? [],
            jugadoresDetalle: a.jugadoresDetalle ?? [],
            ajusteManual: "0",
            ajusteManualNota: "",
            // CAMBIO (18/09/2026): ya no existe el % default de club — si no hay deal cargado
            // para este agente+club, arranca DESTILDADA (no entra en el lote a aplicar) para que
            // no se cuele un cierre en 0%/0% sin que nadie lo haya configurado a propósito. Leo
            // la sigue viendo en la tabla (con el badge "Sin configurar") para ir a cargarle el
            // deal y volver a calcular si corresponde.
            included: a.configSource === "deal",
            previewLoading: false,
            previewResult: null,
            previewError: null,
            applyLoading: false,
            applyResult: null,
            applyError: null,
          });
        }
      }
      nuevasFilas.sort((a, b) => a.clubName.localeCompare(b.clubName) || a.agentName.localeCompare(b.agentName));
      setFilas(nuevasFilas);

      // Rebate Unión de Tiny: convierte a USD con la misma tasa que el resto de esta corrida y
      // le suma, por club, la Σ del rebate que ya le vamos a pagar a CADA agente (rebatePct ×
      // (resultado + rakeTotal), la misma fórmula que aplica calcularCierre) — así se puede ver
      // de una si lo que Tiny nos reconoce alcanza para cubrir lo que salimos a pagar nosotros.
      if (plataforma === "TINY") {
        setTinyRebateUnionRawPorClub(
          (r.clubes || [])
            .filter((c: any) => (c.tinyRebateUnion?.length ?? 0) > 0)
            .map((c: any) => ({ clubId: c.clubId, weekEnd, items: c.tinyRebateUnion }))
        );
        const rebateAgentesPorClub = new Map<string, number>();
        for (const f of nuevasFilas) {
          const rebateFila = (f.resultado + f.rakeTotal) * f.rebatePct;
          rebateAgentesPorClub.set(f.clubId, (rebateAgentesPorClub.get(f.clubId) ?? 0) + rebateFila);
        }
        setTinyRebateUnionPorClub(
          (r.clubes || [])
            .filter((c: any) => (c.tinyRebateUnion?.length ?? 0) > 0)
            .map((c: any) => ({
              clubId: c.clubId,
              clubName: c.clubName,
              items: c.tinyRebateUnion.map((u: any) => ({
                ...u,
                rgPreRakeExclJp: u.rgPreRakeExclJp != null ? u.rgPreRakeExclJp / tasa : null,
                rebateUnionCalculado: u.rebateUnionCalculado / tasa,
                rebateUnionTiny: u.rebateUnionTiny != null ? u.rebateUnionTiny / tasa : null,
                rakeTotalRingGame: u.rakeTotalRingGame != null ? u.rakeTotalRingGame / tasa : null,
                rakeShare: u.rakeShare != null ? u.rakeShare / tasa : null,
              })),
              rebateAgentesTotal: rebateAgentesPorClub.get(c.clubId) ?? 0,
              baseAgentesTotal: nuevasFilas
                .filter((f) => f.clubId === c.clubId)
                .reduce((s, f) => s + f.resultado + f.rakeTotal, 0),
            }))
        );
      } else {
        setTinyRebateUnionPorClub([]);
        setTinyRebateUnionRawPorClub([]);
      }
    } catch (err: any) {
      setAnalisisError(err.message || "No se pudo procesar el archivo.");
    } finally {
      setAnalizando(false);
    }
  }

  async function asignarJugador(clubId: string, playerId: string) {
    const claveSel = `${clubId}|${playerId}`;
    const agentId = asignando[claveSel];
    if (!agentId) return;
    setGuardandoAsignacion(claveSel);
    try {
      await api.asignarAgenteImportado({ playerExternalId: playerId, clubId, agentId, reason: "Asignado manualmente desde el importador de cierres." });
      await confirmarClubesYProcesar(); // recalcula todo con la asignación ya guardada
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo guardar la asignación.");
    } finally {
      setGuardandoAsignacion(null);
    }
  }

  // Crea el agente que faltaba (un superagente nuevo del archivo, todavía no en el catálogo) y
  // reprocesa el archivo entero — no hace falta asignar jugador por jugador: al quedar creado
  // con su external_id, resolvePlayerAgent lo matchea solo para TODOS los jugadores que le
  // correspondan, no solo el que disparó el alta.
  const [creandoAgente, setCreandoAgente] = useState<string | null>(null);
  async function crearAgenteYReprocesar(agentIdRaw: string | null, agentNameRaw: string) {
    const clave = agentIdRaw ?? agentNameRaw;
    setCreandoAgente(clave);
    try {
      await api.crearAgenteImportado({ name: agentNameRaw, agentIdRaw });
      await confirmarClubesYProcesar();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo crear el agente.");
    } finally {
      setCreandoAgente(null);
    }
  }

  function toggleIncluded(key: string) {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, included: !f.included } : f)));
  }

  // Cambiar el ajuste manual (o su nota) invalida la vista previa de esa fila -- si no, el
  // "Cierre final (vista previa)" se queda mostrando el numero viejo, calculado sin el ajuste,
  // hasta que alguien vuelva a tocar "Calcular vista previa de todos" sin darse cuenta de que
  // hace falta.
  function setAjusteManualFila(key: string, ajusteManual: string) {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ajusteManual, previewResult: null, previewError: null } : f)));
  }

  function setAjusteManualNotaFila(key: string, ajusteManualNota: string) {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ajusteManualNota, previewResult: null, previewError: null } : f)));
  }

  async function previsualizarTodo() {
    setPrevisualizandoTodo(true);
    setResumenAplicacion(null);
    setFilas((fs) => fs.map((f) => (f.included ? { ...f, previewLoading: true, previewError: null } : f)));
    const incluidas = filas.filter((f) => f.included);
    await Promise.all(
      incluidas.map(async (f) => {
        try {
          // Refresca el % vigente justo antes de calcular: si el deal se creó o editó DESPUÉS
          // de analizar el archivo (caso típico: subís el excel, ves que falta el %, lo cargás
          // en "Ver deals"/Árbol, y volvés acá a calcular), la fila traía el % viejo del momento
          // del análisis y nunca se actualizaba sola — quedaba en 0%/default para siempre hasta
          // resubir el excel entero. Ahora se vuelve a pedir la config vigente en cada cálculo.
          let { system, rakebackPct, rebatePct, configSource } = f;
          try {
            const cfg = await api.configVigente(f.agentId, f.clubId);
            system = cfg.system;
            rakebackPct = cfg.rakebackPct;
            rebatePct = cfg.rebatePct;
            configSource = cfg.source;
          } catch {
            // si falla el refresco, seguimos con lo que ya teníamos en la fila
          }
          const r = await api.previsualizarCierre({
            agentId: f.agentId,
            clubId: f.clubId,
            weekStart,
            weekEnd,
            system,
            result: f.resultado,
            rakeTotal: f.rakeTotal,
            rakebackPct,
            rebatePct,
            observation: `Importado de archivo (${weekStart} al ${weekEnd}).`,
            rodeoJugadores: f.rodeoJugadores.length > 0 ? f.rodeoJugadores : undefined,
            jugadoresDetalle: f.jugadoresDetalle.length > 0 ? f.jugadoresDetalle : undefined,
            rateSnapshot: plataforma === "TINY" ? Number(tinyRate) || undefined : undefined,
            jugadores: f.jugadores,
            ringGame: f.ringGame,
            mtt: f.mtt,
            sng: f.sngOtros,
            bbjContribution: f.bbjContribution,
            ajusteManual: Number(f.ajusteManual) || undefined,
            ajusteManualNota: f.ajusteManualNota.trim() || undefined,
          });
          setFilas((fs) =>
            fs.map((row) =>
              row.key === f.key
                ? {
                    ...row,
                    system,
                    rakebackPct,
                    rebatePct,
                    configSource,
                    previewLoading: false,
                    previewResult: r,
                    previewError: r.alreadyApplied ? "Ya existe un cierre aplicado para esta semana — no se va a duplicar." : null,
                  }
                : row
            )
          );
        } catch (err: any) {
          setFilas((fs) =>
            fs.map((row) => (row.key === f.key ? { ...row, previewLoading: false, previewError: err.message || "No se pudo calcular." } : row))
          );
        }
      })
    );
    setPrevisualizandoTodo(false);
  }

  const incluidas = filas.filter((f) => f.included);
  const todasPrevisualizadas = incluidas.length > 0 && incluidas.every((f) => f.previewResult && !f.previewError);
  // Nunca se aplica un lote con alguna fila sin deal cargado, aunque el usuario la haya
  // vuelto a tildar a mano — ver comentario de "included" más arriba.
  const hayIncluidasSinConfigurar = incluidas.some((f) => f.configSource !== "deal");
  const sinConfigurarCount = filas.filter((f) => f.configSource !== "deal").length;
  // Ajuste manual cargado sin nota: bloquea aplicar, igual que una fila sin deal — para que
  // quede rastreable en el historial por que se cargo cada ticket promocional.
  const hayIncluidasSinNotaAjuste = incluidas.some((f) => (Number(f.ajusteManual) || 0) !== 0 && !f.ajusteManualNota.trim());
  const totalCierreFinal = incluidas.reduce((sum, f) => sum + Number(f.previewResult?.calc?.finalClosing ?? 0), 0);

  async function aplicarTodo() {
    setAplicandoTodo(true);
    let ok = 0;
    let yaAplicados = 0;
    let errores = 0;
    for (const f of incluidas) {
      setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: true } : row)));
      try {
        const r = await api.aplicarCierre({
          agentId: f.agentId,
          clubId: f.clubId,
          weekStart,
          weekEnd,
          system: f.system,
          result: f.resultado,
          rakeTotal: f.rakeTotal,
          rakebackPct: f.rakebackPct,
          rebatePct: f.rebatePct,
          observation: `Importado de archivo (${weekStart} al ${weekEnd}).`,
          rodeoJugadores: f.rodeoJugadores.length > 0 ? f.rodeoJugadores : undefined,
          jugadoresDetalle: f.jugadoresDetalle.length > 0 ? f.jugadoresDetalle : undefined,
          rateSnapshot: plataforma === "TINY" ? Number(tinyRate) || undefined : undefined,
          jugadores: f.jugadores,
          ringGame: f.ringGame,
          mtt: f.mtt,
          sng: f.sngOtros,
          bbjContribution: f.bbjContribution,
          ajusteManual: Number(f.ajusteManual) || undefined,
          ajusteManualNota: f.ajusteManualNota.trim() || undefined,
        });
        if (r.alreadyApplied) yaAplicados++; else ok++;
        setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: false, applyResult: r } : row)));
      } catch (err: any) {
        errores++;
        setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: false, applyError: err.message || "Error al aplicar." } : row)));
      }
    }
    // Rebate Union de Tiny (18/09/2026): se guarda UNA VEZ por club, recien aca (nunca en la
    // vista previa) -- reusa los mismos datos que ya se calcularon al analizar el archivo, asi
    // no hay que volver a leer ningun excel. Solo para los clubes que de verdad tuvieron algun
    // cierre aplicado en este lote (si el usuario destildo todo un club, no se guarda nada de
    // el). Si esto falla no se revierte nada de lo ya aplicado -- se avisa aparte.
    if (plataforma === "TINY" && tinyRebateUnionRawPorClub.length > 0) {
      const clubesConAlgunaFilaAplicada = new Set(incluidas.map((f) => f.clubId));
      const erroresGuardado: string[] = [];
      for (const grupo of tinyRebateUnionRawPorClub) {
        if (!clubesConAlgunaFilaAplicada.has(grupo.clubId)) continue;
        try {
          await api.guardarTinyRebateUnion({
            clubId: grupo.clubId,
            weekStart,
            weekEnd: grupo.weekEnd,
            items: grupo.items,
          });
        } catch (err: any) {
          erroresGuardado.push(err.message || "error desconocido");
        }
      }
      if (erroresGuardado.length > 0) {
        setResumenAplicacion(
          `Listo: ${ok} cierre(s) aplicados, ${yaAplicados} ya existían, ${errores} con error. ` +
            `Ademas, no se pudo guardar el Rebate Union para el resumen del club: ${erroresGuardado.join("; ")}.`
        );
        onDone();
        setAplicandoTodo(false);
        return;
      }
    }
    setAplicandoTodo(false);
    setResumenAplicacion(
      `Listo: ${ok} cierre(s) aplicados, ${yaAplicados} ya existían (no se duplicaron), ${errores} con error.`
    );
    onDone();
  }

  const PLATAFORMAS: { key: "SUPREMA" | "GG" | "TINY" | "XPOKER"; label: string }[] = [
    { key: "SUPREMA", label: "SupremaPoker" },
    { key: "GG", label: "GG Poker" },
    { key: "TINY", label: "Tiny GG" },
    { key: "XPOKER", label: "X-Poker" },
  ];

  return (
    <div className="panel">
      <h3>Importar cierre desde archivo</h3>
      <div className="muted" style={{ marginBottom: 10 }}>
        Cada plataforma tiene su propio archivo y su propia liquidación — elegí primero la plataforma del archivo que vas
        a subir.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {PLATAFORMAS.map((p) => (
          <button
            key={p.key}
            className={plataforma === p.key ? "btn" : "btn secondary"}
            onClick={() => {
              setPlataforma(p.key);
              setFile(null);
              setTinyFiles([]);
              setFilas([]);
              setHojasDetectadas([]);
              setConfirmado(false);
              setAnalisisError(null);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {plataforma === "XPOKER" && (
        <div className="muted" style={{ marginBottom: 14 }}>
          Todavía no tenemos el importador de X-Poker armado — falta construir el parser para el formato de esa
          plataforma (y su liquidación, que también está pendiente). Mandame un archivo de ejemplo y un cierre de esa
          semana ya calculado a mano, y lo armamos igual que se hizo con Suprema y GG.
        </div>
      )}

      {(plataforma === "SUPREMA" || plataforma === "GG" || plataforma === "TINY") && (
      <>
      <div className="muted" style={{ marginBottom: 14 }}>
        El % de rakeback/rebate de cada agente sale SIEMPRE de la configuración ya cargada en Agentes/Clubes — el archivo
        nunca lo trae.
        {plataforma === "GG" && " En GG el cierre agrupa por Super Agent (el nivel más alto de la cadena Super Agent → Agent → Member) y el rebate se calcula sobre (Resultado + Rake) × % del club."}
        {plataforma === "TINY" &&
          " En Tiny cada super agente baja su PROPIO archivo (subí varios juntos si tenés más de uno) — el sistema toma a los sub-agentes reales de adentro de cada archivo (no al super agente) y les liquida con la misma fórmula de siempre (resultado + rake) × % rebate. Los números del reporte NO están en USD: hay que cargar la tasa de esta semana para convertirlos (ver campo abajo)."}
      </div>

      <div className="form-grid">
        <div className="field">
          <label>{plataforma === "TINY" ? "Archivos (.xlsx) — uno por super agente" : "Archivo (.xlsx)"}</label>
          {plataforma === "TINY" ? (
            <input
              type="file"
              accept=".xlsx"
              multiple
              onChange={(e) => {
                setTinyFiles(e.target.files ? Array.from(e.target.files) : []);
                setFilas([]);
                setHojasDetectadas([]);
                setConfirmado(false);
                setAnalisisError(null);
              }}
            />
          ) : (
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFilas([]);
                setHojasDetectadas([]);
                setConfirmado(false);
                setAnalisisError(null);
              }}
            />
          )}
          {plataforma === "TINY" && tinyFiles.length > 0 && (
            <div className="muted" style={{ marginTop: 4 }}>
              {tinyFiles.length} archivo(s): {tinyFiles.map((f) => f.name).join(", ")}
            </div>
          )}
        </div>
        <div className="field">
          <label>Semana desde</label>
          <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </div>
        <div className="field">
          <label>Semana hasta</label>
          <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
        </div>
        {plataforma === "TINY" && (
          <div className="field">
            <label>Tasa de esta semana (fichas por USD)</label>
            <input
              type="number"
              step="0.01"
              placeholder="Ej: 31.78"
              value={tinyRate}
              onChange={(e) => { setTinyRate(e.target.value); setFilas([]); setConfirmado(false); }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              El reporte de Tiny trae los números en su propia unidad, no en USD — se divide todo por esta tasa. Cambia cada semana, revisala antes de analizar.
            </span>
          </div>
        )}
      </div>
      <button className="btn secondary" disabled={analizando} onClick={analizar}>
        {analizando ? "Analizando..." : "Analizar archivo"}
      </button>

      {analisisError && <div className="error" style={{ marginTop: 12 }}>⚠ {analisisError}</div>}

      {hojasFormatoInvalido.length > 0 && (
        <div className="error" style={{ marginTop: 12 }}>
          {hojasFormatoInvalido.map((h) => (
            <div key={h.sheetName}>⚠ Hoja "{h.sheetName}": {h.motivo}</div>
          ))}
        </div>
      )}

      {hojasDetectadas.length > 0 && !confirmado && (
        <div style={{ marginTop: 12 }}>
          <h4>Elegí el club</h4>
          <div className="muted" style={{ marginBottom: 8 }}>
            El archivo trae {hojasDetectadas.length === 1 ? "1 grupo de datos" : `${hojasDetectadas.length} grupos de datos`} — elegí a qué club corresponde cada uno (o tildá "Ignorar" para no procesarlo esta semana).
          </div>
          <table>
            <thead><tr><th>{hojasDetectadas.length > 1 ? "Grupo" : ""}</th><th>Club</th><th>Ignorar</th></tr></thead>
            <tbody>
              {hojasDetectadas.map((h, idx) => {
                const ignorada = !!hojaIgnorada[h.sheetName];
                return (
                  <tr key={h.sheetName} style={ignorada ? { opacity: 0.5 } : undefined}>
                    <td>{hojasDetectadas.length > 1 ? idx + 1 : ""}</td>
                    <td>
                      <select
                        value={clubElegidoPorHoja[h.sheetName] ?? ""}
                        disabled={ignorada}
                        onChange={(e) => setClubElegidoPorHoja((s) => ({ ...s, [h.sheetName]: e.target.value }))}
                      >
                        <option value="">Elegir club...</option>
                        {clubesSuprema.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={ignorada}
                        onChange={(e) => setHojaIgnorada((s) => ({ ...s, [h.sheetName]: e.target.checked }))}
                        title="No procesar esta hoja esta semana"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {clubesSuprema.length === 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              No hay ningún club activo todavía — creá uno en Administración → Clubes antes de poder elegir club acá.
            </div>
          )}
          <button
            className="btn secondary"
            style={{ marginTop: 8 }}
            disabled={analizando || hojasDetectadas.some((h) => !hojaIgnorada[h.sheetName] && !clubElegidoPorHoja[h.sheetName])}
            onClick={confirmarClubesYProcesar}
          >
            {analizando ? "Procesando..." : "Confirmar clubes y procesar"}
          </button>
        </div>
      )}

      {agentesAutoCreados.length > 0 && (
        <div className="muted" style={{ marginTop: 16 }}>
          Se crearon automáticamente {agentesAutoCreados.length === 1 ? "1 agente nuevo" : `${agentesAutoCreados.length} agentes nuevos`} que
          venían en el archivo y no existían en el catálogo: {agentesAutoCreados.map((a) => a.agentName).join(", ")}.
          Si alguno es en realidad un agente que ya tenías con otro nombre (typo del archivo), corregilo
          desde el Árbol de clubes (mover los jugadores al agente correcto y eliminar el duplicado).
        </div>
      )}

      {sinAgentePorClub.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Jugadores sin agente asignado</h4>
          {sinAgentePorClub.map((grupo) => {
            // Agrupa por agente crudo del archivo (agentIdRaw||agentNameRaw) — varios jugadores
            // suelen compartir el mismo superagente todavía no creado; un solo clic lo crea y
            // reprocesa TODOS los que le correspondan, no solo el jugador que lo disparó.
            const faltantes = new Map<string, { agentIdRaw: string | null; agentNameRaw: string; count: number }>();
            for (const it of grupo.items) {
              if (!it.agentNameRaw) continue;
              const clave = it.agentIdRaw ?? it.agentNameRaw;
              const existente = faltantes.get(clave);
              if (existente) existente.count += 1;
              else faltantes.set(clave, { agentIdRaw: it.agentIdRaw, agentNameRaw: it.agentNameRaw, count: 1 });
            }
            return (
            <div key={grupo.clubId} style={{ marginBottom: 14 }}>
              <div className="muted">{grupo.clubName}</div>
              {faltantes.size > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
                  {[...faltantes.entries()].map(([clave, f]) => (
                    <button
                      key={clave}
                      className="btn secondary small"
                      disabled={creandoAgente === clave}
                      onClick={() => crearAgenteYReprocesar(f.agentIdRaw, f.agentNameRaw)}
                      title={`Crea el agente y asigna automáticamente a los ${f.count} jugador(es) que le corresponden`}
                    >
                      {creandoAgente === clave ? "Creando..." : `+ Crear agente "${f.agentNameRaw}" (${f.count})`}
                    </button>
                  ))}
                </div>
              )}
              <table>
                <thead><tr><th>Jugador</th><th>Agente en el archivo</th><th>Resultado</th><th>Rake</th><th>Asignar a</th><th></th></tr></thead>
                <tbody>
                  {grupo.items.map((it: any) => {
                    const claveSel = `${grupo.clubId}|${it.playerId}`;
                    return (
                      <tr key={it.playerId}>
                        <td>{it.playerName} <span className="muted">#{it.playerId}</span></td>
                        <td>{it.agentNameRaw ?? <span className="muted">(vacío)</span>}</td>
                        <td>{usd(it.resultado)}</td>
                        <td>{usd(it.rake)}</td>
                        <td>
                          <select value={asignando[claveSel] ?? ""} onChange={(e) => setAsignando((s) => ({ ...s, [claveSel]: e.target.value }))}>
                            <option value="">Elegir agente...</option>
                            {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <button
                            className="btn secondary small"
                            disabled={!asignando[claveSel] || guardandoAsignacion === claveSel}
                            onClick={() => asignarJugador(grupo.clubId, it.playerId)}
                          >
                            {guardandoAsignacion === claveSel ? "..." : "Asignar"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            );
          })}
        </div>
      )}

      {bancadosPorClub.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Jugadores bancados omitidos del cierre</h4>
          <div className="muted" style={{ marginBottom: 10 }}>
            Estos jugadores están marcados en "Jugadores bancados" — no entran al cierre agregado de su agente, se contabilizan
            aparte. El total de acá abajo NO está incluido en ningún cierre que vayas a aplicar.
          </div>
          {bancadosPorClub.map((grupo) => {
            const totalResultado = grupo.items.reduce((s: number, it: any) => s + Number(it.resultado), 0);
            const totalRake = grupo.items.reduce((s: number, it: any) => s + Number(it.rake), 0);
            return (
              <div key={grupo.clubId} style={{ marginBottom: 14 }}>
                <div className="muted">
                  {grupo.clubName} — {grupo.items.length} jugador{grupo.items.length === 1 ? "" : "es"} omitido{grupo.items.length === 1 ? "" : "s"}, resultado
                  total {usd(totalResultado)}, rake total {usd(totalRake)}
                </div>
                <table>
                  <thead><tr><th>Jugador</th><th>Agente</th><th>Resultado</th><th>Rake</th></tr></thead>
                  <tbody>
                    {grupo.items.map((it: any) => (
                      <tr key={it.playerId}>
                        <td>{it.playerName} <span className="muted">#{it.playerExternalId ?? it.playerId}</span></td>
                        <td>{it.agentName}</td>
                        <td>{usd(it.resultado)}</td>
                        <td>{usd(it.rake)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {tinyRebateUnionPorClub.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Rebate Union de Tiny (conciliacion)</h4>
          <div className="muted" style={{ marginBottom: 10 }}>
            Rebate Union: lo que Tiny/la Union nos reconoce a NOSOTROS por super agente, calculado sobre el RG Pre-rake
            P&amp;L (excl. JP) del archivo -- 10% si esa base es negativa, 0 si es positiva o cero. Es un calculo
            INDEPENDIENTE del rebate que nosotros les pagamos a cada agente (columna "Suma Rebate agentes"); nunca se
            reparte directo a los agentes. Diferencia = Rebate Union - Suma Rebate agentes: positiva es margen extra
            para nosotros, negativa es costo extra que absorbemos.
          </div>
          {tinyRebateUnionPorClub.map((grupo: any) => {
            const diferencia = grupo.items.reduce((s: number, it: any) => s + it.rebateUnionCalculado, 0) - grupo.rebateAgentesTotal;
            const baseUnionTotal = grupo.items.reduce((s: number, it: any) => s + (it.rgPreRakeExclJp ?? 0), 0);
            return (
              <div key={grupo.clubId} style={{ marginBottom: 14 }}>
                <div className="muted">{grupo.clubName}</div>
                <table>
                  <thead>
                    <tr>
                      <th>Super agente (archivo)</th>
                      <th>RG Pre-rake excl. JP</th>
                      <th>Rebate Union (nuestro)</th>
                      <th>Rebate Union (Tiny)</th>
                      <th>Rake share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.items.map((it: any, idx: number) => (
                      <tr key={idx}>
                        <td>{it.superAgentNickname ?? it.fileName}</td>
                        <td>{it.rgPreRakeExclJp != null ? usd(it.rgPreRakeExclJp) : "-"}</td>
                        <td>{usd(it.rebateUnionCalculado)}</td>
                        <td>
                          {it.rebateUnionTiny != null ? usd(it.rebateUnionTiny) : "-"}
                          {it.rebateUnionTiny != null && Math.abs(it.rebateUnionTiny - it.rebateUnionCalculado) > 0.5 && (
                            <span className="neg" style={{ marginLeft: 6 }}>difiere</span>
                          )}
                        </td>
                        <td>{it.rakeShare != null ? usd(it.rakeShare) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted" style={{ marginTop: 6 }}>
                  Suma Rebate agentes (lo que pagamos nosotros): <strong>{usd(grupo.rebateAgentesTotal)}</strong>
                  {" - "}
                  Diferencia (Rebate Union menos Suma Rebate agentes):{" "}
                  <strong className={diferencia >= 0 ? "pos" : "neg"}>{usd(diferencia)}</strong>
                  {" - "}
                  Base: RG Pre-rake excl. JP {usd(baseUnionTotal)} vs Suma(W/L+Rake) agentes {usd(grupo.baseAgentesTotal)}
                  {Math.abs(baseUnionTotal - grupo.baseAgentesTotal) > 0.5 && (
                    <span className="neg" style={{ marginLeft: 6 }}>bases distintas</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmado && filas.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0 }}>Cierres a aplicar ({incluidas.length} de {filas.length})</h4>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn secondary small" onClick={() => setConfirmado(false)}>Cambiar clubes</button>
              <button className="btn secondary" disabled={previsualizandoTodo} onClick={previsualizarTodo}>
                {previsualizandoTodo ? "Calculando..." : "Calcular vista previa de todos"}
              </button>
            </div>
          </div>
          <div className="table-scroll">
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th></th><th>Club</th><th>Agente</th><th>Jugadores</th><th>Resultado</th><th>Rake</th>
                <th>% Rakeback</th><th>% Rebate</th><th>Config</th><th>Rodeo</th><th>Ajuste manual (USD)</th><th>Nota ajuste</th><th>Cierre final (vista previa)</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.key} style={!f.included ? { opacity: 0.5 } : undefined}>
                  <td><input type="checkbox" checked={f.included} onChange={() => toggleIncluded(f.key)} /></td>
                  <td>{f.clubName}</td>
                  <td>{f.agentName}</td>
                  <td>{f.jugadores}</td>
                  <td><Monto value={f.resultado} /></td>
                  <td><Monto value={f.rakeTotal} /></td>
                  <td>
                    <div className="muted" style={{ fontSize: 12 }}>{(f.rakebackPct * 100).toFixed(1)}%</div>
                    {(() => {
                      const calc = f.applyResult?.calc ?? f.previewResult?.calc;
                      if (!calc || calc.rakeback == null) return null;
                      return <strong><Monto value={calc.rakeback} /></strong>;
                    })()}
                  </td>
                  <td>
                    {(f.rebatePct * 100).toFixed(1)}%
                    {(() => {
                      const calc = f.applyResult?.calc ?? f.previewResult?.calc;
                      if (!calc || calc.rebate == null) return null;
                      return (
                        <span className="muted">
                          {" "}
                          · <Monto value={calc.rebate} />
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    {f.configSource === "deal" ? (
                      <span className="badge pos">Deal agente</span>
                    ) : (
                      <span className="badge neg" title="No tiene un deal cargado para este club — no se puede aplicar así. Cargale el % en Administración (Asignar % a agente) y volvé a calcular la vista previa.">
                        Sin configurar
                      </span>
                    )}
                  </td>
                  <td>
                    {f.rodeoJugadores.length > 0 ? (
                      <span title="Solo SupremaPoker: se le suma al cierre la parte del agente ya neta de su memoria por jugador.">
                        {f.rodeoJugadores.length} jug.
                        {(f.applyResult?.calc?.rodeo ?? f.previewResult?.calc?.rodeo) != null && (
                          <> · <Monto value={f.applyResult?.calc?.rodeo ?? f.previewResult?.calc?.rodeo} /></>
                        )}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={f.ajusteManual}
                      disabled={!!f.applyResult}
                      onChange={(e) => setAjusteManualFila(f.key, e.target.value)}
                      style={{ width: 72 }}
                    />
                  </td>
                  <td>
                    {(Number(f.ajusteManual) || 0) !== 0 && (
                      <input
                        type="text"
                        placeholder="Motivo (obligatorio)"
                        value={f.ajusteManualNota}
                        disabled={!!f.applyResult}
                        onChange={(e) => setAjusteManualNotaFila(f.key, e.target.value)}
                        style={{ width: 110 }}
                      />
                    )}
                  </td>
                  <td>
                    {f.applyResult?.alreadyApplied && <span className="badge neutral">Ya existía</span>}
                    {f.applyResult && !f.applyResult.alreadyApplied && <span className="badge pos">Aplicado: <Monto value={f.applyResult.calc?.finalClosing} /></span>}
                    {!f.applyResult && f.previewLoading && "..."}
                    {!f.applyResult && f.previewError && <span className="error">⚠ {f.previewError}</span>}
                    {!f.applyResult && !f.previewError && f.previewResult && (
                      <strong>
                        <Monto value={f.previewResult.calc?.finalClosing} />
                        {f.previewResult.calc?.ruleApplied && <> · {f.previewResult.calc.ruleApplied}</>}
                      </strong>
                    )}
                    {f.applyError && <div className="error">⚠ {f.applyError}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {sinConfigurarCount > 0 && (
            <div className="error" style={{ marginTop: 10 }}>
              {sinConfigurarCount} fila{sinConfigurarCount === 1 ? "" : "s"} sin deal cargado (badge "Sin configurar") — quedaron
              destildadas y no entran en este lote. Cargales el % en Administración y volvé a calcular la vista previa para incluirlas.
            </div>
          )}

          {hayIncluidasSinNotaAjuste && (
            <div className="error" style={{ marginTop: 10 }}>
              Hay filas incluidas con un ajuste manual cargado pero sin nota — completá el motivo antes de aplicar.
            </div>
          )}

          {todasPrevisualizadas && (
            <div className="muted" style={{ marginTop: 10 }}>
              Total a acreditar/cobrar en estos {incluidas.length} cierres: <strong>{usd(totalCierreFinal)}</strong>
            </div>
          )}

          {resumenAplicacion && <div className="success" style={{ marginTop: 10 }}>{resumenAplicacion}</div>}

          <button
            className="btn"
            style={{ marginTop: 12 }}
            disabled={!todasPrevisualizadas || hayIncluidasSinConfigurar || hayIncluidasSinNotaAjuste || aplicandoTodo}
            title={
              hayIncluidasSinConfigurar
                ? "Hay filas incluidas sin deal cargado — cargales el % o destildalas antes de aplicar."
                : hayIncluidasSinNotaAjuste
                ? "Hay filas con un ajuste manual cargado pero sin nota — completá el motivo antes de aplicar."
                : !todasPrevisualizadas
                ? "Calculá la vista previa de todos los cierres primero"
                : undefined
            }
            onClick={aplicarTodo}
          >
            {aplicandoTodo ? "Aplicando..." : `Aplicar ${incluidas.length} cierre(s)`}
          </button>
        </div>
      )}
      </>
      )}
    </div>
  );
}
