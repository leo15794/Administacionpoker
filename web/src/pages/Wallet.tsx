import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import Modal from "../components/Modal";

function estaRevertido(m: any) {
  return (m.status ?? m.movimiento_status) === "REVERTIDO";
}

export default function Wallet() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [showAjuste, setShowAjuste] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.tesoreria({ ledger: "WALLET_MANOS" }).then(setData).catch((e) => setError(e.message));
  }

  async function revertir(m: any) {
    const detalle = m.source === "ajuste" ? m.observation : `${m.agent_name} (${m.type})`;
    const motivo = prompt(`Revertir movimiento:\n\n${detalle}\n${m.direction === "INGRESO" ? "+" : "-"}${m.amount}\n\n¿Por qué lo revertís? (queda en el historial, no se borra nada)`) ?? undefined;
    if (motivo === undefined) return;
    setBorrando(m.id);
    try {
      if (m.source === "ajuste") await api.revertirAjusteTesoreria(m.id, motivo || undefined);
      else await api.revertirMovimiento(m.id, motivo || undefined);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir el movimiento.");
    } finally {
      setBorrando(null);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Wallet: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="muted">Cargando...</div>;

  const wallet = data.porLedger.find((l: any) => l.ledger === "WALLET_MANOS");

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Wallet</h2>
          <div className="muted">
            Saldo de la wallet en USDT. Se arma solo con los movimientos de agentes en USDT más el historial real importado desde la planilla — para plata que entra o sale sin ser un movimiento de agente, registrala acá.
          </div>
        </div>
        <button className="btn" onClick={() => setShowAjuste(true)}>+ Registrar movimiento</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Saldo Wallet (neto)</div>
          <div className={`value ${!wallet || Number(wallet.neto) >= 0 ? "pos" : "neg"}`}>{usd(wallet?.neto ?? 0)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Movimientos registrados</div>
          <div className="value">{wallet?.movimientos ?? 0}</div>
        </div>
      </div>

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Historial de movimientos</h3>
          <button
            className="btn secondary small"
            onClick={() =>
              exportCsv(
                "wallet.csv",
                data.ultimosMovimientos.map((m: any) => ({
                  fecha: m.occurred_at,
                  direccion: m.direction,
                  monto: m.amount,
                  origen: m.source === "ajuste" ? "Ajuste / historial" : "Movimiento de agente",
                  detalle: m.source === "ajuste" ? m.observation : (m.agent_name ?? ""),
                  cargado_por: m.created_by ?? "",
                }))
              )
            }
          >
            Exportar CSV
          </button>
        </div>
        {data.ultimosMovimientos.length === 0 ? (
          <div className="muted">Sin movimientos todavía.</div>
        ) : (
          <table>
            <thead><tr><th>Fecha</th><th>Dirección</th><th>Monto</th><th>Detalle</th><th></th></tr></thead>
            <tbody>
              {data.ultimosMovimientos.map((m: any) => (
                <tr key={m.id} style={estaRevertido(m) ? { opacity: 0.55 } : undefined}>
                  <td>{dateShort(m.occurred_at)}</td>
                  <td className="muted">{m.direction === "INGRESO" ? "Ingreso" : "Egreso"}</td>
                  <td><span className={`badge ${m.direction === "INGRESO" ? "pos" : "neg"}`}>{usd(m.amount)}</span></td>
                  <td>
                    {estaRevertido(m) && <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>}
                    {m.source === "ajuste" ? (
                      <span title={m.created_by ? `Cargado por ${m.created_by}` : undefined}>
                        {String(m.created_by || "").startsWith("import:") ? (
                          <span className="badge neutral">Historial</span>
                        ) : (
                          <span className="badge neutral">Manual</span>
                        )}{" "}
                        {m.observation}
                      </span>
                    ) : (
                      m.agent_name
                    )}
                  </td>
                  <td>
                    {!estaRevertido(m) && (
                      <button
                        className="btn secondary small"
                        disabled={borrando === m.id}
                        onClick={() => revertir(m)}
                        title="Revertir este movimiento (genera uno opuesto, no borra nada)"
                      >
                        {borrando === m.id ? "..." : "Revertir"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAjuste && (
        <Modal title="Registrar movimiento de Wallet" onClose={() => setShowAjuste(false)}>
          <AjusteForm
            onDone={() => {
              setShowAjuste(false);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function AjusteForm({ onDone }: { onDone: () => void }) {
  const [direction, setDirection] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const monto = Number(amount);
    if (!monto || monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    if (reason.trim().length < 3) return setMsg({ ok: false, text: "Contá brevemente el motivo del movimiento." });
    setLoading(true);
    try {
      await api.ajustarTesoreria({
        ledger: "WALLET_MANOS",
        direction,
        amount: monto,
        reason: reason.trim(),
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Usá esto para plata que entra o sale de la wallet sin ser un cobro o pago de un agente (carga propia, retiro, diferencia de arqueo). Queda registrado acá mismo, en el historial de Wallet.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Dirección</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="INGRESO">Ingreso (entra dinero)</option>
            <option value="EGRESO">Egreso (sale dinero)</option>
          </select>
        </div>
        <div className="field">
          <label>Monto (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
        </div>
      </div>
      <div className="field">
        <label>Motivo</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: carga propia, retiro de socio, ajuste de arqueo..." />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar movimiento"}</button>
    </form>
  );
}
