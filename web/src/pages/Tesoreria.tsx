import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import Modal from "../components/Modal";

const LEDGER_LABEL: Record<string, string> = {
  WALLET_MANOS: "Wallet USDT",
  CAJA_EFECTIVO: "Caja efectivo",
};

function estaRevertido(m: any) {
  return (m.status ?? m.movimiento_status) === "REVERTIDO";
}

export default function Tesoreria() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [showAjuste, setShowAjuste] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.tesoreria().then(setData).catch((e) => setError(e.message));
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
        No se pudo cargar Tesorería: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="muted">Cargando...</div>;

  const wallet = data.porLedger.find((l: any) => l.ledger === "WALLET_MANOS");
  const caja = data.porLedger.find((l: any) => l.ledger === "CAJA_EFECTIVO");

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Tesorería</h2>
          <div className="muted">Se arma sola a partir de los movimientos cargados con medio de pago USDT o Efectivo. Para plata que entra o sale sin ser un movimiento de agente (aporte, retiro, diferencia de arqueo), usá el ajuste manual.</div>
        </div>
        <button className="btn" onClick={() => setShowAjuste(true)}>+ Ajuste manual</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Wallet USDT (neto)</div>
          <div className={`value ${!wallet || Number(wallet.neto) >= 0 ? "pos" : "neg"}`}>{usd(wallet?.neto ?? 0)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Caja efectivo (neto)</div>
          <div className={`value ${!caja || Number(caja.neto) >= 0 ? "pos" : "neg"}`}>{usd(caja?.neto ?? 0)}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Efectivo por custodio</h3>
        {data.porCustodio.length === 0 ? (
          <div className="muted">Todavía no hay movimientos en efectivo cargados.</div>
        ) : (
          <table>
            <thead><tr><th>Custodio</th><th>Neto en su poder</th><th>Movimientos</th></tr></thead>
            <tbody>
              {data.porCustodio.map((c: any) => (
                <tr key={c.custodio}>
                  <td>{c.custodio}</td>
                  <td><span className={`badge ${Number(c.neto) >= 0 ? "pos" : "neg"}`}>{usd(c.neto)}</span></td>
                  <td className="muted">{c.movimientos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Últimos movimientos de tesorería</h3>
          <button
            className="btn secondary small"
            onClick={() =>
              exportCsv(
                "tesoreria.csv",
                data.ultimosMovimientos.map((m: any) => ({
                  fecha: m.occurred_at,
                  ledger: LEDGER_LABEL[m.ledger] ?? m.ledger,
                  direccion: m.direction,
                  monto: m.amount,
                  custodio: m.custodian ?? "",
                  origen: m.source === "ajuste" ? "Ajuste manual" : "Movimiento de agente",
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
            <thead><tr><th>Fecha</th><th>Tesorería</th><th>Dirección</th><th>Monto</th><th>Custodio</th><th>Detalle</th><th></th></tr></thead>
            <tbody>
              {data.ultimosMovimientos.map((m: any) => (
                <tr key={m.id} style={estaRevertido(m) ? { opacity: 0.55 } : undefined}>
                  <td>{dateShort(m.occurred_at)}</td>
                  <td><span className="badge neutral">{LEDGER_LABEL[m.ledger] ?? m.ledger}</span></td>
                  <td className="muted">{m.direction === "INGRESO" ? "Ingreso" : "Egreso"}</td>
                  <td><span className={`badge ${m.direction === "INGRESO" ? "pos" : "neg"}`}>{usd(m.amount)}</span></td>
                  <td>{m.custodian || "—"}</td>
                  <td>
                    {estaRevertido(m) && <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>}
                    {m.source === "ajuste" ? (
                      <span title={m.created_by ? `Cargado por ${m.created_by}` : undefined}>
                        <span className="badge neutral">Ajuste manual</span> {m.observation}
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
        <Modal title="Ajuste manual de tesorería" onClose={() => setShowAjuste(false)}>
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
  const [ledger, setLedger] = useState<"WALLET_MANOS" | "CAJA_EFECTIVO">("WALLET_MANOS");
  const [direction, setDirection] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [amount, setAmount] = useState("");
  const [custodian, setCustodian] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const monto = Number(amount);
    if (!monto || monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    if (ledger === "CAJA_EFECTIVO" && !custodian.trim()) return setMsg({ ok: false, text: "El efectivo necesita un custodio." });
    if (reason.trim().length < 3) return setMsg({ ok: false, text: "Contá brevemente el motivo del ajuste." });
    setLoading(true);
    try {
      await api.ajustarTesoreria({
        ledger,
        direction,
        amount: monto,
        custodian: custodian.trim() || undefined,
        reason: reason.trim(),
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cargar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Usá esto solo para plata que entra o sale de la wallet/caja sin ser un cobro o pago de un agente (aporte propio, retiro, diferencia de arqueo). Queda registrado como ajuste manual, separado de los movimientos automáticos.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Tesorería</label>
          <select value={ledger} onChange={(e) => setLedger(e.target.value as any)}>
            <option value="WALLET_MANOS">Wallet USDT</option>
            <option value="CAJA_EFECTIVO">Caja efectivo</option>
          </select>
        </div>
        <div className="field">
          <label>Dirección</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="INGRESO">Ingreso (agregar dinero)</option>
            <option value="EGRESO">Egreso (retirar dinero)</option>
          </select>
        </div>
        <div className="field">
          <label>Monto (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
        </div>
        {ledger === "CAJA_EFECTIVO" && (
          <div className="field">
            <label>Custodio</label>
            <input value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="Quién tiene el efectivo" />
          </div>
        )}
      </div>
      <div className="field">
        <label>Motivo</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: aporte propio, retiro de socio, ajuste de arqueo..." />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar ajuste"}</button>
    </form>
  );
}
