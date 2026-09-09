import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";

export default function Cierres() {
  const [cierres, setCierres] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [bancados, setBancados] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    api.cierres().then(setCierres);
    api.bancados().then(setBancados);
  }

  async function revertirCierre(c: any) {
    const motivo = prompt(`Revertir cierre de ${c.agent_name} en ${c.club_name} (semana ${dateShort(c.week_start)} - ${dateShort(c.week_end)}).\n\n¿Por qué lo revertís? (queda en el historial, no se borra nada)`) ?? undefined;
    if (motivo === undefined) return;
    setBorrando(c.id);
    try {
      await api.revertirCierre(c.id, motivo || undefined);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir el cierre.");
    } finally {
      setBorrando(null);
    }
  }

  // BORRADO REAL — solo para limpiar datos de PRUEBA. Sobre plata real siempre "Revertir"
  // (arriba), nunca esto. Pide escribir "BORRAR" literal para no tocarlo por error de un clic.
  async function borrarDefinitivo(c: any) {
    const confirmacion = prompt(
      `Esto BORRA DEL TODO el cierre de ${c.agent_name} en ${c.club_name} (semana ${dateShort(c.week_start)} - ${dateShort(c.week_end)}) — no queda en ningún historial, a diferencia de "Revertir".\n\nUsalo SOLO para limpiar datos de prueba, nunca sobre plata real ya operada.\n\nEscribí BORRAR para confirmar:`
    );
    if (confirmacion !== "BORRAR") return;
    setBorrando(c.id);
    try {
      await api.eliminarCierreDefinitivo(c.id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo borrar el cierre.");
    } finally {
      setBorrando(null);
    }
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
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
          onApplied={() => {
            refresh();
          }}
        />
      )}

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Historial de cierres</h3>
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
                  resultado: c.result,
                  rake: c.rake_total,
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
              <th>Semana</th><th>Agente</th><th>Club</th><th>Sistema</th>
              <th>Resultado</th><th>Rake</th><th>Rakeback</th><th>Rodeo</th><th>Cierre final</th><th>Regla</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cierres.map((c) => (
              <tr key={c.id} style={c.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                <td>{dateShort(c.week_start)} - {dateShort(c.week_end)}</td>
                <td>{c.agent_name}</td>
                <td>{c.club_name}</td>
                <td>{c.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                <td>{usd(c.result)}</td>
                <td>{usd(c.rake_total)}</td>
                <td>{usd(c.rakeback)}</td>
                <td>
                  {/* Rodeo: solo existe en cierres importados de SupremaPoker (ver engine/rodeo.ts) —
                      para cualquier otro cierre queda en 0/null, se muestra "—" para no ensuciar la tabla. */}
                  {c.rodeo != null && Number(c.rodeo) !== 0 ? usd(c.rodeo) : <span className="muted">—</span>}
                </td>
                <td><span className={`badge ${Number(c.final_closing) >= 0 ? "pos" : "neg"}`}>{usd(c.final_closing)}</span></td>
                <td>
                  {c.status === "REVERTIDO" && <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>}
                  {c.rule_applied ? <span className="badge neutral">{c.rule_applied}</span> : (c.status !== "REVERTIDO" ? "—" : "")}
                  {c.rule_applied === "BANCADO" && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      Ganancia DigiPlayers: {usd(c.bancado_digiplayers_share)}
                      {Number(c.bancado_debt_after) > 0 && <> · Memoria: {usd(c.bancado_debt_before)} → {usd(c.bancado_debt_after)}</>}
                    </div>
                  )}
                </td>
                <td style={{ display: "flex", gap: 6 }}>
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
                  <button
                    className="btn secondary small"
                    disabled={borrando === c.id}
                    onClick={() => borrarDefinitivo(c)}
                    title="Borrado real — no queda en el historial. Solo para datos de prueba, nunca para plata real."
                    style={{ color: "var(--danger, #e5484d)" }}
                  >
                    {borrando === c.id ? "..." : "Borrar"}
                  </button>
                </td>
              </tr>
            ))}
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

function NuevoCierre({ agentes, clubes, onApplied }: { agentes: any[]; clubes: any[]; onApplied: () => void }) {
  const [agentId, setAgentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [system, setSystem] = useState<"PREPAGO" | "WIN_LOSE">("WIN_LOSE");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [result, setResult] = useState("");
  const [rakeTotal, setRakeTotal] = useState("0");
  const [rakebackPct, setRakebackPct] = useState("70");
  const [rebatePct, setRebatePct] = useState("0");
  const [observation, setObservation] = useState("");

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

  function elegirAgente(id: string) {
    setAgentId(id);
    invalidarPreview();
    const agente = agentes.find((a) => a.id === id);
    if (agente?.account_type === "BANCADO" && rebatePct === "0") {
      setRebatePct("50"); // default razonable: reparto 50/50 de la mesa, ajustable
    }
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
    return {
      agentId,
      clubId,
      weekStart,
      weekEnd,
      system,
      result: Number(result) || 0,
      rakeTotal: Number(rakeTotal) || 0,
      rakebackPct: (Number(rakebackPct) || 0) / 100,
      rebatePct: (Number(rebatePct) || 0) / 100,
      observation: observation.trim() || undefined,
    };
  }

  const claveActual = JSON.stringify(armarPayload());
  // Vista previa vigente = se calculó con exactamente los valores que hay cargados ahora.
  const previewVigente = previewKey === claveActual;

  async function calcularVistaPrevia() {
    if (!agentId || !clubId || !weekStart || !weekEnd) {
      setPreviewError("Agente, club y fechas de la semana son obligatorios.");
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
            <select value={clubId} onChange={(e) => { setClubId(e.target.value); invalidarPreview(); }}>
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
            <label>{esBancado ? "Resultado en la mesa (bancado ganó/perdió, USD)" : "Resultado (win/lose, USD)"}</label>
            <input value={result} onChange={(e) => { setResult(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
          <div className="field">
            <label>Rake total (USD)</label>
            <input value={rakeTotal} onChange={(e) => { setRakeTotal(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
          <div className="field">
            <label>{esBancado ? "% Rakeback (100% para el bancado)" : "% Rakeback"}</label>
            <input value={rakebackPct} onChange={(e) => { setRakebackPct(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
          <div className="field">
            <label>{esBancado ? "% de la mesa para el bancado (si ganó)" : "% Rebate"}</label>
            <input value={rebatePct} onChange={(e) => { setRebatePct(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
          </div>
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
  system: "PREPAGO" | "WIN_LOSE";
  rakebackPct: number;
  rebatePct: number;
  configSource: "deal" | "default_club";
  // "Rodeo" (solo SupremaPoker): lista cruda por jugador — el monto real que le toca al
  // agente sale recién del preview/apply (procesarRodeoAgenteTx aplica la memoria por jugador).
  rodeoJugadores: { playerExternalId: string; baseRodeo: number }[];
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
  const [file, setFile] = useState<File | null>(null);
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
  const [plataforma, setPlataforma] = useState<"SUPREMA" | "GG" | "XPOKER">("SUPREMA");

  useEffect(() => {
    // Misma lista de "todos los clubes activos" para cualquier plataforma (ver nota en
    // repo/imports.ts sobre por qué nunca se filtra por plataforma acá) — se vuelve a pedir al
    // cambiar de pestaña solo por si se creó un club nuevo mientras tanto.
    const fetchClubes = plataforma === "GG" ? api.clubesImportacionTeamBackGG() : api.clubesImportacionSuprema();
    fetchClubes.then(setClubesSuprema).catch(() => setClubesSuprema([]));
  }, [plataforma]);

  // Paso 1: solo lee el archivo y arma la lista de hojas con formato válido (con una sugerencia
  // de club si el nombre matchea algo ya configurado). Todavía no calcula nada por agente — eso
  // recién pasa cuando se confirma a qué club corresponde cada hoja (paso 2).
  async function analizar() {
    if (!file) { setAnalisisError("Elegí un archivo primero."); return; }
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
          ? await api.previsualizarImportacionTeamBackGG(file, weekEnd)
          : await api.previsualizarImportacion(file, weekEnd);
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
    if (!file) return;
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
          ? await api.previsualizarImportacionTeamBackGG(file, weekEnd, overrides, ignoradas)
          : await api.previsualizarImportacion(file, weekEnd, overrides, ignoradas);
      setConfirmado(true);
      setSinAgentePorClub(
        (r.clubes || [])
          .filter((c: any) => c.sinAgente?.length > 0)
          .map((c: any) => ({ clubId: c.clubId, clubName: c.clubName, items: c.sinAgente }))
      );
      setAgentesAutoCreados(r.agentesAutoCreados || []);
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
            resultado: a.resultado,
            rakeTotal: a.rakeTotal,
            system: a.system,
            rakebackPct: a.rakebackPct,
            rebatePct: a.rebatePct,
            configSource: a.configSource,
            rodeoJugadores: a.rodeoJugadores ?? [],
            included: true,
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
      alert(err.message || "No se pudo guardar la asignación.");
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
      alert(err.message || "No se pudo crear el agente.");
    } finally {
      setCreandoAgente(null);
    }
  }

  function toggleIncluded(key: string) {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, included: !f.included } : f)));
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
        });
        if (r.alreadyApplied) yaAplicados++; else ok++;
        setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: false, applyResult: r } : row)));
      } catch (err: any) {
        errores++;
        setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: false, applyError: err.message || "Error al aplicar." } : row)));
      }
    }
    setAplicandoTodo(false);
    setResumenAplicacion(
      `Listo: ${ok} cierre(s) aplicados, ${yaAplicados} ya existían (no se duplicaron), ${errores} con error.`
    );
    onDone();
  }

  const PLATAFORMAS: { key: "SUPREMA" | "GG" | "XPOKER"; label: string }[] = [
    { key: "SUPREMA", label: "SupremaPoker" },
    { key: "GG", label: "GG Poker" },
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

      {(plataforma === "SUPREMA" || plataforma === "GG") && (
      <>
      <div className="muted" style={{ marginBottom: 14 }}>
        El % de rakeback/rebate de cada agente sale SIEMPRE de la configuración ya cargada en Agentes/Clubes — el archivo
        nunca lo trae.
        {plataforma === "GG" && " En GG el cierre agrupa por Super Agent (el nivel más alto de la cadena Super Agent → Agent → Member) y el rebate se calcula sobre (Resultado + Rake) × % del club."}
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Archivo (.xlsx)</label>
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
        </div>
        <div className="field">
          <label>Semana desde</label>
          <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </div>
        <div className="field">
          <label>Semana hasta</label>
          <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
        </div>
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
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th></th><th>Club</th><th>Agente</th><th>Jugadores</th><th>Resultado</th><th>Rake</th>
                <th>% Rakeback</th><th>% Rebate</th><th>Config</th><th>Rodeo</th><th>Cierre final (vista previa)</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.key} style={!f.included ? { opacity: 0.5 } : undefined}>
                  <td><input type="checkbox" checked={f.included} onChange={() => toggleIncluded(f.key)} /></td>
                  <td>{f.clubName}</td>
                  <td>{f.agentName}</td>
                  <td>{f.jugadores}</td>
                  <td>{usd(f.resultado)}</td>
                  <td>{usd(f.rakeTotal)}</td>
                  <td>{(f.rakebackPct * 100).toFixed(1)}%</td>
                  <td>
                    {(f.rebatePct * 100).toFixed(1)}%
                    {(() => {
                      const rebate = f.applyResult?.calc?.rebate ?? f.previewResult?.calc?.rebate;
                      return rebate != null ? (
                        <span className="muted"> · {usd(rebate)}</span>
                      ) : null;
                    })()}
                  </td>
                  <td>
                    {f.configSource === "deal" ? <span className="badge pos">Deal agente</span> : <span className="badge neutral">Default club</span>}
                  </td>
                  <td>
                    {f.rodeoJugadores.length > 0 ? (
                      <span title="Solo SupremaPoker: se le suma al cierre la parte del agente ya neta de su memoria por jugador.">
                        {f.rodeoJugadores.length} jug.
                        {(f.applyResult?.calc?.rodeo ?? f.previewResult?.calc?.rodeo) != null && (
                          <> · {usd(f.applyResult?.calc?.rodeo ?? f.previewResult?.calc?.rodeo)}</>
                        )}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {f.applyResult?.alreadyApplied && <span className="badge neutral">Ya existía</span>}
                    {f.applyResult && !f.applyResult.alreadyApplied && <span className="badge pos">Aplicado: {usd(f.applyResult.calc?.finalClosing)}</span>}
                    {!f.applyResult && f.previewLoading && "..."}
                    {!f.applyResult && f.previewError && <span className="error">⚠ {f.previewError}</span>}
                    {!f.applyResult && !f.previewError && f.previewResult && (
                      <strong style={{ color: Number(f.previewResult.calc?.finalClosing) >= 0 ? "var(--green)" : "var(--red)" }}>
                        {usd(f.previewResult.calc?.finalClosing)}
                        {f.previewResult.calc?.ruleApplied && <> · {f.previewResult.calc.ruleApplied}</>}
                      </strong>
                    )}
                    {f.applyError && <div className="error">⚠ {f.applyError}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {todasPrevisualizadas && (
            <div className="muted" style={{ marginTop: 10 }}>
              Total a acreditar/cobrar en estos {incluidas.length} cierres: <strong>{usd(totalCierreFinal)}</strong>
            </div>
          )}

          {resumenAplicacion && <div className="success" style={{ marginTop: 10 }}>{resumenAplicacion}</div>}

          <button
            className="btn"
            style={{ marginTop: 12 }}
            disabled={!todasPrevisualizadas || aplicandoTodo}
            title={!todasPrevisualizadas ? "Calculá la vista previa de todos los cierres primero" : undefined}
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
