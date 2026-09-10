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

// Adelantos de rakeback: plata (fichas o USDT) adelantada a un agente A CUENTA de un rakeback
// que todavía no se generó — separado del saldo operativo, igual que Garantías (BIT-034), pero
// por agente+club (un mismo agente puede tener un adelanto vigente en un club puntual). Es el
// concepto "Adelanto de rakeback" que la planilla suma en Agentes nos deben y que hasta ahora
// no teníamos cargado en ningún lado del sistema.
export default function Adelantos() {
  const [adelantos, setAdelantos] = useState<any[] | null>(null);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [showAjuste, setShowAjuste] = useState<{ agentId?: string; clubId?: string } | null>(null);

  function refresh() {
    setError("");
    api.adelantos().then(setAdelantos).catch((e) => setError(e.message));
    api.adelantosHistorial().then(setHistorial).catch(() => {});
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }, []);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Adelantos: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!adelantos) return <div className="muted">Cargando...</div>;

  const totalAdelantado = adelantos.reduce((s, a) => s + Number(a.amount), 0);
  const totalConsumido = adelantos.reduce((s, a) => s + Number(a.consumed), 0);
  const totalPendiente = totalAdelantado - totalConsumido;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Adelantos de rakeback</h2>
          <div className="muted">Separados del saldo operativo, igual que Garantías — pero por agente+club. Cada alta, aumento, reducción, consumo o baja queda registrado en el historial.</div>
        </div>
        <button className="btn" onClick={() => setShowAjuste({})}>+ Nuevo / ajustar adelanto</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Total adelantado</div>
          <div className="value">{usd(totalAdelantado)}</div>
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
          <div className="label">Pares agente+club con adelanto activo</div>
          <div className="value">{adelantos.length}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Adelantos activos</h3>
        {adelantos.length === 0 ? (
          <div className="muted">Todavía no hay adelantos activos cargados.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Agente</th><th>Club</th><th>Adelantado</th><th>Consumido</th><th>Pendiente</th><th>Notas</th><th>Actualizado</th><th></th></tr>
            </thead>
            <tbody>
              {adelantos.map((a) => (
                <tr key={a.id}>
                  <td>{a.agent_name}</td>
                  <td>{a.club_name}</td>
                  <td>{usd(a.amount)}</td>
                  <td>{usd(a.consumed)}</td>
                  <td><span className="badge neutral">{usd(Number(a.amount) - Number(a.consumed))}</span></td>
                  <td className="muted" style={{ fontSize: 12 }} title={a.notes || undefined}>{a.notes || "—"}</td>
                  <td className="muted">{dateShort(a.updated_at)}</td>
                  <td>
                    <button className="btn secondary small" onClick={() => setShowAjuste({ agentId: a.agent_id, clubId: a.club_id })}>
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
          <div className="muted">Todavía no hay movimientos de adelantos.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Fecha</th><th>Agente</th><th>Club</th><th>Tipo</th><th>Monto</th><th>Adelanto resultante</th><th>Consumido resultante</th><th>Notas</th></tr>
            </thead>
            <tbody>
              {historial.map((m) => (
                <tr key={m.id}>
                  <td>{dateShort(m.occurred_at)}</td>
                  <td>{m.agent_name}</td>
                  <td>{m.club_name}</td>
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
        <Modal title="Ajustar adelanto" onClose={() => setShowAjuste(null)}>
          <AjusteForm
            agentes={agentes}
            clubes={clubes}
            adelantos={adelantos}
            preselect={showAjuste}
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
  clubes,
  adelantos,
  preselect,
  onDone,
}: {
  agentes: any[];
  clubes: any[];
  adelantos: any[];
  preselect: { agentId?: string; clubId?: string };
  onDone: () => void;
}) {
  const [agentId, setAgentId] = useState(preselect.agentId ?? "");
  const [clubId, setClubId] = useState(preselect.clubId ?? "");
  const tienePreseleccion = !!(preselect.agentId && preselect.clubId);
  const tieneAdelantoActivo = adelantos.some((a) => a.agent_id === agentId && a.club_id === clubId);
  const [type, setType] = useState<"ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA">(tienePreseleccion ? "AUMENTO" : "ALTA");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function actualizarPar(nextAgentId: string, nextClubId: string) {
    setAgentId(nextAgentId);
    setClubId(nextClubId);
    const yaTiene = adelantos.some((a) => a.agent_id === nextAgentId && a.club_id === nextClubId);
    setType(yaTiene ? "AUMENTO" : "ALTA");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId || !clubId) return setMsg({ ok: false, text: "Elegí agente y club." });
    const monto = Number(amount) || 0;
    if (type !== "BAJA" && monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.ajustarAdelanto({ agentId, clubId, type, amount: monto, notes: notes.trim() || undefined });
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
            onChange={(e) => actualizarPar(e.target.value, clubId)}
            disabled={tienePreseleccion}
          >
            <option value="">Elegir...</option>
            {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Club</label>
          <select
            value={clubId}
            onChange={(e) => actualizarPar(agentId, e.target.value)}
            disabled={tienePreseleccion}
          >
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo de movimiento</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="ALTA" disabled={tieneAdelantoActivo}>Alta (adelanto nuevo)</option>
            <option value="AUMENTO" disabled={!tieneAdelantoActivo}>Aumento</option>
            <option value="REDUCCION" disabled={!tieneAdelantoActivo}>Reducción</option>
            <option value="CONSUMO" disabled={!tieneAdelantoActivo}>Consumo (se compensó contra un cierre real)</option>
            <option value="BAJA" disabled={!tieneAdelantoActivo}>Baja (se cancela el adelanto)</option>
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
