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
  CORRECCION: "Corrección",
};

// Adelantos de rakeback: plata (fichas o USDT) adelantada a un agente A CUENTA de un rakeback
// que todavía no se generó — separado del saldo operativo, igual que Garantías (BIT-034). Es
// por AGENTE, no por agente+club (corregido 11/09/2026: un agente sigue generando rake en
// varios clubes a la vez, el adelanto se compensa contra el rakeback que sea, sin importar de
// qué club salga — no tiene sentido "atarlo" a un solo club). "Club de origen" (12/09/2026) es
// aparte: un dato puramente informativo de en qué club se originó el adelanto (para rastrearlo
// contra la planilla), que NUNCA limita contra qué club se puede compensar después. Es el
// concepto "Adelanto de rakeback" que la planilla suma en Agentes nos deben y que hasta ahora
// no teníamos cargado en ningún lado del sistema.
export default function Adelantos() {
  const [adelantos, setAdelantos] = useState<any[] | null>(null);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [showAjuste, setShowAjuste] = useState<{ agentId?: string } | null>(null);
  const [showCorreccion, setShowCorreccion] = useState<any | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.adelantos().then(setAdelantos).catch((e) => setError(e.message));
    api.adelantosHistorial().then(setHistorial).catch(() => {});
  }

  // Borrado real (no "Baja"): saca el adelanto y todo su historial de movimientos, para cuando
  // nunca debió cargarse (duplicado, agente equivocado, etc.).
  async function eliminarAdelanto(a: any) {
    if (!confirm(`¿Eliminar el adelanto de ${a.agent_name}? Esto borra también su historial de movimientos — no se puede deshacer.`)) return;
    setBorrando(a.id);
    try {
      await api.eliminarAdelanto(a.id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar el adelanto.");
    } finally {
      setBorrando(null);
    }
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
          <div className="muted">Por agente (no por club) — un agente sigue generando rake en varios clubes a la vez, el adelanto se compensa contra cualquiera. Separado del saldo operativo. Cada alta, aumento, reducción, consumo o baja queda registrado en el historial.</div>
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
          <div className="label">Agentes con adelanto activo</div>
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
              <tr><th>Agente</th><th>Club origen</th><th>Adelantado</th><th>Consumido</th><th>Pendiente</th><th>Notas</th><th>Actualizado</th><th></th></tr>
            </thead>
            <tbody>
              {adelantos.map((a) => (
                <tr key={a.id}>
                  <td>{a.agent_name}</td>
                  <td className="muted">{a.club_origen_name || "—"}</td>
                  <td>{usd(a.amount)}</td>
                  <td>{usd(a.consumed)}</td>
                  <td><span className="badge neutral">{usd(Number(a.amount) - Number(a.consumed))}</span></td>
                  <td className="muted" style={{ fontSize: 12 }} title={a.notes || undefined}>{a.notes || "—"}</td>
                  <td className="muted">{dateShort(a.updated_at)}</td>
                  <td className="row-actions">
                    <button className="btn secondary small" onClick={() => setShowAjuste({ agentId: a.agent_id })}>
                      Ajustar
                    </button>
                    <button className="btn secondary small" onClick={() => setShowCorreccion(a)} title="Arreglar un error de carga (monto, consumido o club mal tipeados) sin que quede como un movimiento de negocio">
                      Corregir
                    </button>
                    <button
                      className="btn secondary small"
                      disabled={borrando === a.id}
                      onClick={() => eliminarAdelanto(a)}
                      title="Borrado real — no queda en el historial. Para un adelanto que nunca debió cargarse."
                      style={{ color: "var(--danger, #e5484d)" }}
                    >
                      {borrando === a.id ? "..." : "Eliminar"}
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
              <tr><th>Fecha</th><th>Agente</th><th>Tipo</th><th>Monto</th><th>Adelanto resultante</th><th>Consumido resultante</th><th>Notas</th></tr>
            </thead>
            <tbody>
              {historial.map((m) => (
                <tr key={m.id}>
                  <td>{dateShort(m.occurred_at)}</td>
                  <td>{m.agent_name}</td>
                  <td><span className="badge neutral">{TIPO_LABEL[m.type] ?? m.type}</span></td>
                  <td>{m.type === "BAJA" || m.type === "CORRECCION" ? "—" : usd(m.amount)}</td>
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
            preselectAgentId={showAjuste.agentId}
            onDone={() => {
              setShowAjuste(null);
              refresh();
            }}
          />
        </Modal>
      )}

      {showCorreccion && (
        <Modal title={`Corregir adelanto — ${showCorreccion.agent_name}`} onClose={() => setShowCorreccion(null)}>
          <CorreccionForm
            adelanto={showCorreccion}
            clubes={clubes}
            onDone={() => {
              setShowCorreccion(null);
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
  preselectAgentId,
  onDone,
}: {
  agentes: any[];
  clubes: any[];
  adelantos: any[];
  preselectAgentId?: string;
  onDone: () => void;
}) {
  const [agentId, setAgentId] = useState(preselectAgentId ?? "");
  const [type, setType] = useState<"ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA">(preselectAgentId ? "AUMENTO" : "ALTA");
  const [amount, setAmount] = useState("");
  const [clubOrigenId, setClubOrigenId] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const tieneAdelantoActivo = adelantos.some((a) => a.agent_id === agentId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId) return setMsg({ ok: false, text: "Elegí un agente." });
    const monto = Number(amount) || 0;
    if (type !== "BAJA" && monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.ajustarAdelanto({
        agentId,
        type,
        amount: monto,
        notes: notes.trim() || undefined,
        clubOrigenId: type === "ALTA" ? clubOrigenId || null : undefined,
      });
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
              const yaTiene = adelantos.some((a) => a.agent_id === nextId);
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
        {type === "ALTA" && (
          <div className="field">
            <label>Club de origen (opcional)</label>
            <select value={clubOrigenId} onChange={(e) => setClubOrigenId(e.target.value)}>
              <option value="">Sin especificar</option>
              {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>
              Solo de referencia (para rastrearlo contra la planilla) — el adelanto se compensa igual contra el rakeback de cualquier club.
            </span>
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

// Corrección de un error de carga (monto, consumido o club de origen mal tipeados). A propósito
// separada de AjusteForm/ajustarAdelanto: acá se pisa el valor directo (no se suma/resta), y
// El motivo es opcional — queda igual en el historial (tipo CORRECCION) para no perder
// trazabilidad, pero no se mezcla con los movimientos reales de negocio (AUMENTO, REDUCCION,
// etc.).
function CorreccionForm({ adelanto, clubes, onDone }: { adelanto: any; clubes: any[]; onDone: () => void }) {
  const [amount, setAmount] = useState(String(adelanto.amount));
  const [consumed, setConsumed] = useState(String(adelanto.consumed));
  const [clubOrigenId, setClubOrigenId] = useState(adelanto.club_origen_id ?? "");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const nuevoAmount = Number(amount);
    const nuevoConsumed = Number(consumed);
    if (!(nuevoAmount >= 0) || !(nuevoConsumed >= 0)) return setMsg({ ok: false, text: "Los montos no pueden ser negativos." });
    if (nuevoConsumed > nuevoAmount) return setMsg({ ok: false, text: "El consumido no puede ser mayor al monto total." });
    setLoading(true);
    try {
      await api.corregirAdelanto({
        advanceId: adelanto.id,
        amount: nuevoAmount,
        consumed: nuevoConsumed,
        clubOrigenId: clubOrigenId || null,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo corregir el adelanto." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Esto pisa el monto/consumido/club directamente — usalo solo para arreglar un error de carga, no para un movimiento real (para eso está "Ajustar").
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Monto total (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
        </div>
        <div className="field">
          <label>Consumido (USD)</label>
          <input value={consumed} onChange={(e) => setConsumed(e.target.value)} type="number" step="0.01" min="0" />
        </div>
        <div className="field">
          <label>Club de origen</label>
          <select value={clubOrigenId} onChange={(e) => setClubOrigenId(e.target.value)}>
            <option value="">Sin especificar</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Motivo de la corrección (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: se cargó 2.600 pero era 1.600, error de tipeo." />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Corregir"}</button>
    </form>
  );
}
