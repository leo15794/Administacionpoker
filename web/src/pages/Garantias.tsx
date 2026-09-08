import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";

const TIPO_LABEL: Record<string, string> = {
  ALTA: "Alta",
  AUMENTO: "Aumento",
  REDUCCION: "Reducción",
  CONSUMO: "Consumo",
  BAJA: "Baja",
};

export default function Garantias() {
  const [garantias, setGarantias] = useState<any[] | null>(null);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [showAjuste, setShowAjuste] = useState<{ agentId?: string } | null>(null);

  function refresh() {
    setError("");
    api.garantias().then(setGarantias).catch((e) => setError(e.message));
    api.garantiasHistorial().then(setHistorial).catch(() => {});
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes);
  }, []);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Garantías: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!garantias) return <div className="muted">Cargando...</div>;

  const totalGarantizado = garantias.reduce((s, g) => s + Number(g.amount), 0);
  const totalConsumido = garantias.reduce((s, g) => s + Number(g.consumed), 0);
  const totalPendiente = totalGarantizado - totalConsumido;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Garantías</h2>
          <div className="muted">Separadas del saldo operativo (BIT-034). Cada alta, aumento, reducción, consumo o baja queda registrado en el historial.</div>
        </div>
        <button className="btn" onClick={() => setShowAjuste({})}>+ Nueva / ajustar garantía</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Total garantizado</div>
          <div className="value">{usd(totalGarantizado)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Consumido</div>
          <div className="value">{usd(totalConsumido)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Pendiente</div>
          <div className="value">{usd(totalPendiente)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Agentes con garantía activa</div>
          <div className="value">{garantias.length}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Garantías activas</h3>
        {garantias.length === 0 ? (
          <div className="muted">Todavía no hay garantías activas cargadas.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Agente</th><th>Garantizado</th><th>Consumido</th><th>Pendiente</th><th>Notas</th><th>Actualizado</th><th></th></tr>
            </thead>
            <tbody>
              {garantias.map((g) => (
                <tr key={g.id}>
                  <td>{g.agent_name}</td>
                  <td>{usd(g.amount)}</td>
                  <td>{usd(g.consumed)}</td>
                  <td><span className="badge neutral">{usd(Number(g.amount) - Number(g.consumed))}</span></td>
                  <td className="muted" style={{ fontSize: 12 }} title={g.notes || undefined}>{g.notes || "—"}</td>
                  <td className="muted">{dateShort(g.updated_at)}</td>
                  <td>
                    <button className="btn secondary small" onClick={() => setShowAjuste({ agentId: g.agent_id })}>
                      Ajustar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Historial de movimientos</h3>
        {!historial ? (
          <div className="muted">Cargando...</div>
        ) : historial.length === 0 ? (
          <div className="muted">Todavía no hay movimientos de garantías.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Fecha</th><th>Agente</th><th>Tipo</th><th>Monto</th><th>Garantía resultante</th><th>Consumido resultante</th><th>Notas</th></tr>
            </thead>
            <tbody>
              {historial.map((m) => (
                <tr key={m.id}>
                  <td>{dateShort(m.occurred_at)}</td>
                  <td>{m.agent_name}</td>
                  <td><span className="badge neutral">{TIPO_LABEL[m.type] ?? m.type}</span></td>
                  <td>{m.type === "BAJA" ? "—" : usd(m.amount)}</td>
                  <td>{usd(m.resulting_amount)}</td>
                  <td>{usd(m.resulting_consumed)}</td>
                  <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAjuste && (
        <Modal title="Ajustar garantía" onClose={() => setShowAjuste(null)}>
          <AjusteForm
            agentes={agentes}
            garantias={garantias}
            preselectAgentId={showAjuste.agentId}
            onDone={() => {
              setShowAjuste(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function AjusteForm({
  agentes,
  garantias,
  preselectAgentId,
  onDone,
}: {
  agentes: any[];
  garantias: any[];
  preselectAgentId?: string;
  onDone: () => void;
}) {
  const [agentId, setAgentId] = useState(preselectAgentId ?? "");
  const [type, setType] = useState<"ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA">(preselectAgentId ? "AUMENTO" : "ALTA");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const tieneGarantiaActiva = garantias.some((g) => g.agent_id === agentId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId) return setMsg({ ok: false, text: "Elegí un agente." });
    const monto = Number(amount) || 0;
    if (type !== "BAJA" && monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.ajustarGarantia({ agentId, type, amount: monto, notes: notes.trim() || undefined });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Agente</label>
          <select
            value={agentId}
            onChange={(e) => {
              const nextId = e.target.value;
              setAgentId(nextId);
              const yaTiene = garantias.some((g) => g.agent_id === nextId);
              setType(yaTiene ? "AUMENTO" : "ALTA");
            }}
            disabled={!!preselectAgentId}
          >
            <option value="">Elegir...</option>
            {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo de movimiento</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="ALTA" disabled={tieneGarantiaActiva}>Alta (garantía nueva)</option>
            <option value="AUMENTO" disabled={!tieneGarantiaActiva}>Aumento</option>
            <option value="REDUCCION" disabled={!tieneGarantiaActiva}>Reducción</option>
            <option value="CONSUMO" disabled={!tieneGarantiaActiva}>Consumo (se usó parte de la garantía)</option>
            <option value="BAJA" disabled={!tieneGarantiaActiva}>Baja (se cancela la garantía)</option>
          </select>
        </div>
        {type !== "BAJA" && (
          <div className="field">
            <label>Monto (USD)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
          </div>
        )}
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo del ajuste, referencia, etc." />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Aplicar"}</button>
    </form>
  );
}
