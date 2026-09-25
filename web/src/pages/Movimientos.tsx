import { useEffect, useState } from "react";
import { api } from "../api";
import { usd } from "../fmt";
import MovimientosHistorial from "../components/MovimientosHistorial";

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
  // (25/09/2026, pedido de Leo: "cuando liquidamos en cierres semanales hacemos una conversion
  // de fichas a USD, necesito esto tambien aca") -- mismo mecanismo que ya usa Cierres.tsx: un
  // club con unit === "FICHAS" (hoy: Tiny y X-Poker, ver Configuración → Clubes) reporta en
  // fichas, no en USD, y el valor de la ficha es un parámetro editable, no una constante -- por
  // eso se pide acá, precargado con clubes.current_rate pero siempre se puede pisar.
  const [valorFicha, setValorFicha] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState("SIN_TESORERIA");
  const [custodian, setCustodian] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayLocal());
  const [observation, setObservation] = useState("");

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }, []);

  const clubSeleccionado = clubes.find((c) => c.id === clubId);
  const esFichas = clubSeleccionado?.unit === "FICHAS";

  function elegirClub(id: string) {
    setClubId(id);
    const club = clubes.find((c) => c.id === id);
    // Precarga la tasa del club (ej. 1,20 para X-Poker) pero queda editable -- si esta carga
    // puntual cambió, se pisa acá sin tener que ir a Configuración → Clubes primero.
    if (club?.unit === "FICHAS") setValorFicha(String(club.current_rate ?? 1));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId || !clubId || !amount) return setMsg({ ok: false, text: "Agente, club e importe son obligatorios." });
    if (type === "TRANSFERENCIA_ENTRE_CLUBES" && !clubDestinoId) return setMsg({ ok: false, text: "La transferencia necesita club de destino." });
    if (paymentMethod === "EFECTIVO" && !custodian.trim()) return setMsg({ ok: false, text: "Un movimiento en efectivo requiere custodio (BIT-051/052)." });

    setLoading(true);
    try {
      // Clubes en fichas (Tiny, X-Poker): el importe cargado arriba son fichas crudas -- el
      // ledger siempre guarda USD, así que se convierte acá, una sola vez, con la tasa de este
      // envío puntual. Para cualquier otro club, tasa = 1 y no cambia nada.
      const tasa = esFichas ? Number(valorFicha) || 1 : 1;
      await api.crearMovimiento({
        type,
        agentId,
        clubId,
        clubDestinoId: type === "TRANSFERENCIA_ENTRE_CLUBES" ? clubDestinoId : undefined,
        amount: (Number(amount) || 0) * tasa,
        originalAmount: esFichas ? Number(amount) || 0 : undefined,
        originalUnit: esFichas ? "FICHAS" : undefined,
        paymentMethod,
        custodian: paymentMethod === "EFECTIVO" ? custodian.trim() : undefined,
        occurredAt: new Date(occurredAt).toISOString(),
        observation: observation.trim() || undefined,
      });
      setMsg({ ok: true, text: "Movimiento registrado y aplicado al ledger." });
      setAmount("");
      setObservation("");
      setRefreshKey((k) => k + 1);
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
              <select value={clubId} onChange={(e) => elegirClub(e.target.value)}>
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
              <label>{esFichas ? "Importe (fichas)" : "Importe (USD)"}</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" placeholder="0.00" />
            </div>
            {esFichas && (
              <div className="field">
                <label>Valor de la ficha (USD)</label>
                <input value={valorFicha} onChange={(e) => setValorFicha(e.target.value)} type="number" step="0.01" />
                <span className="muted" style={{ fontSize: 12 }}>
                  = {usd((Number(amount) || 0) * (Number(valorFicha) || 0))}
                </span>
              </div>
            )}
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

      <div className="panel" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Historial de movimientos cargados</h3>
        <div className="muted" style={{ marginBottom: 14 }}>
          Últimos movimientos registrados en el sistema (los más recientes primero), para verificar rápido lo que se fue cargando.
        </div>
        <MovimientosHistorial key={refreshKey} />
      </div>
    </div>
  );
}
