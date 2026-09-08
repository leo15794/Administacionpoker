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
        <button className="btn" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar formulario" : "+ Aplicar cierre"}</button>
      </div>

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
              <th>Resultado</th><th>Rake</th><th>Rakeback</th><th>Cierre final</th><th>Regla</th><th></th>
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
                <td>
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
