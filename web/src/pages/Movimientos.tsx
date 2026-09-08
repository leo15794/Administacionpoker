import { useEffect, useState } from "react";
import { api } from "../api";

const TIPOS = [
  { value: "CARGA", label: "Carga (agente recibe fichas/crédito)" },
  { value: "DESCARGA", label: "Descarga (agente entrega fichas/crédito)" },
  { value: "COBRO", label: "Cobro (le cobramos al agente)" },
  { value: "PAGO", label: "Pago (le pagamos al agente)" },
  { value: "TRANSFERENCIA_ENTRE_CLUBES", label: "Transferencia entre clubes" },
  { value: "TICKET_PROMOCIONAL", label: "Ticket promocional" },
  { value: "AJUSTE", label: "Ajuste manual" },
];

function todayLocal() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export default function Movimientos() {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);

  const [type, setType] = useState("CARGA");
  const [agentId, setAgentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [clubDestinoId, setClubDestinoId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("SIN_TESORERIA");
  const [custodian, setCustodian] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayLocal());
  const [observation, setObservation] = useState("");

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId || !clubId || !amount) return setMsg({ ok: false, text: "Agente, club e importe son obligatorios." });
    if (type === "TRANSFERENCIA_ENTRE_CLUBES" && !clubDestinoId) return setMsg({ ok: false, text: "La transferencia necesita club de destino." });
    if (paymentMethod === "EFECTIVO" && !custodian.trim()) return setMsg({ ok: false, text: "Un movimiento en efectivo requiere custodio (BIT-051/052)." });

    setLoading(true);
    try {
      await api.crearMovimiento({
        type,
        agentId,
        clubId,
        clubDestinoId: type === "TRANSFERENCIA_ENTRE_CLUBES" ? clubDestinoId : undefined,
        amount: Number(amount),
        paymentMethod,
        custodian: paymentMethod === "EFECTIVO" ? custodian.trim() : undefined,
        occurredAt: new Date(occurredAt).toISOString(),
        observation: observation.trim() || undefined,
      });
      setMsg({ ok: true, text: "Movimiento registrado y aplicado al ledger." });
      setAmount("");
      setObservation("");
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cargar movimiento</h2>
          <div className="muted">Cada movimiento se aplica de forma atómica al ledger y actualiza saldos al instante.</div>
        </div>
      </div>

      <div className="panel">
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>Tipo de movimiento</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Agente</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Elegir...</option>
                {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Club {type === "TRANSFERENCIA_ENTRE_CLUBES" ? "(origen)" : ""}</label>
              <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
                <option value="">Elegir...</option>
                {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {type === "TRANSFERENCIA_ENTRE_CLUBES" && (
              <div className="field">
                <label>Club destino</label>
                <select value={clubDestinoId} onChange={(e) => setClubDestinoId(e.target.value)}>
                  <option value="">Elegir...</option>
                  {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label>Importe (USD)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" placeholder="0.00" />
            </div>
            <div className="field">
              <label>Medio de pago</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="SIN_TESORERIA">Sin tesorería (interno)</option>
                <option value="USDT">USDT</option>
                <option value="EFECTIVO">Efectivo</option>
                <option value="ZELLE">Zelle</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            {paymentMethod === "EFECTIVO" && (
              <div className="field">
                <label>Custodio del efectivo</label>
                <input value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="Quién tiene la plata físicamente" />
              </div>
            )}
            <div className="field">
              <label>Fecha y hora</label>
              <input value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} type="datetime-local" />
            </div>
          </div>
          <div className="field">
            <label>Observación (opcional)</label>
            <input value={observation} onChange={(e) => setObservation(e.target.value)} />
          </div>
          {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
          <button className="btn" disabled={loading}>{loading ? "Registrando..." : "Registrar movimiento"}</button>
        </form>
      </div>
    </div>
  );
}
