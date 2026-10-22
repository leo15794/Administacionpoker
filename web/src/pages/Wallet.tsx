import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateTime } from "../fmt";
import Modal from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmProvider";
import Loading from "../components/Loading";
import Ayuda from "../components/Ayuda";
import WalletMovimientos from "../components/WalletMovimientos";

function estaRevertido(m: any) {
  return (m.status ?? m.movimiento_status) === "REVERTIDO";
}

function todayLocal() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export default function Wallet() {
  const { alertDialog, promptDialog } = useConfirmDialog();
  const [data, setData] = useState<any>(null);
  // Caja de efectivo (20/10/2026): se sacó la pantalla "Tesorería" porque nunca tuvo un solo movimiento de
  // efectivo (todo lo real es Wallet USDT). Si algún día se carga algo en efectivo, aparece acá abajo solo.
  const [caja, setCaja] = useState<any>(null);
  const [error, setError] = useState("");
  const [showAjuste, setShowAjuste] = useState(false);
  const [dirInicial, setDirInicial] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api
      .tesoreria({ ledger: "WALLET_MANOS" })
      .then((d) => {
        setData(d);
        const hayEfectivo = (d.porLedger ?? []).some((l: any) => l.ledger === "CAJA_EFECTIVO" && Number(l.movimientos) > 0);
        if (hayEfectivo) api.tesoreria({ ledger: "CAJA_EFECTIVO" }).then(setCaja).catch(() => setCaja(null));
        else setCaja(null);
      })
      .catch((e) => setError(e.message));
  }

  async function revertir(m: any) {
    const detalle = m.source === "ajuste" ? m.observation : `${m.agent_name} (${m.type})`;
    const motivo = await promptDialog(`Revertir movimiento:\n\n${detalle}\n${m.direction === "INGRESO" ? "+" : "-"}${m.amount}\n\n¿Por qué lo revertís? (queda en el historial, no se borra nada)`);
    if (motivo === null) return;
    setBorrando(m.id);
    try {
      if (m.source === "ajuste") await api.revertirAjusteTesoreria(m.id, motivo || undefined);
      else await api.revertirMovimiento(m.id, motivo || undefined);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo revertir el movimiento.");
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
  if (!data) return <Loading />;

  const wallet = data.porLedger.find((l: any) => l.ledger === "WALLET_MANOS");

  return (
    <div>
      <WalletMovimientos
        titulo={<h2>Wallet <Ayuda>Saldo de la wallet en USDT. Se arma solo con los movimientos de agentes en USDT más el historial real importado desde la planilla — para plata que entra o sale sin ser un movimiento de agente, registrala con "Registrar ingreso" o "Registrar egreso".</Ayuda></h2>}
        saldo={Number(wallet?.neto ?? 0)}
        movimientos={data.ultimosMovimientos}
        totalMovimientos={Number(wallet?.movimientos ?? 0)}
        borrando={borrando}
        onRevertir={revertir}
        onNuevo={(dir) => {
          setDirInicial(dir);
          setShowAjuste(true);
        }}
      />

      {caja && (
        <div className="panel">
          <h3>Caja efectivo <Ayuda>Hay movimientos en efectivo cargados (con su custodio). Saldo neto de la caja:{" "}
            <strong className={Number(caja.porLedger.find((l: any) => l.ledger === "CAJA_EFECTIVO")?.neto ?? 0) >= 0 ? "pos" : "neg"}>
              {usd(caja.porLedger.find((l: any) => l.ledger === "CAJA_EFECTIVO")?.neto ?? 0)}
            </strong></Ayuda></h3>
          <table>
            <thead><tr><th>Custodio</th><th className="num">Neto en su poder</th><th className="num">Movimientos</th></tr></thead>
            <tbody>
              {caja.porCustodio.map((c: any) => (
                <tr key={c.custodio}>
                  <td>{c.custodio}</td>
                  <td className="num"><span className={`badge ${Number(c.neto) >= 0 ? "pos" : "neg"}`}>{usd(c.neto)}</span></td>
                  <td className="num muted">{c.movimientos}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 style={{ margin: "16px 0 8px" }}>Últimos movimientos de la caja</h4>
          <table>
            <thead><tr><th>Fecha y hora</th><th>Dirección</th><th className="num">Monto</th><th>Custodio</th><th>Detalle</th><th></th></tr></thead>
            <tbody>
              {caja.ultimosMovimientos.map((m: any) => (
                <tr key={m.id} style={estaRevertido(m) ? { opacity: 0.55 } : undefined}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{dateTime(m.occurred_at)}</td>
                  <td className="muted">{m.direction === "INGRESO" ? "Ingreso" : "Egreso"}</td>
                  <td className="num"><span className={`badge ${m.direction === "INGRESO" ? "pos" : "neg"}`}>{usd(m.amount)}</span></td>
                  <td>{m.custodian || "—"}</td>
                  <td>
                    {estaRevertido(m) && <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>}
                    {m.source === "ajuste" ? m.observation : m.agent_name}
                  </td>
                  <td>
                    {!estaRevertido(m) && (
                      <button className="btn secondary small" disabled={borrando === m.id} onClick={() => revertir(m)} title="Revertir este movimiento (genera uno opuesto, no borra nada)">
                        {borrando === m.id ? "..." : "Revertir"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAjuste && (
        <Modal title="Registrar movimiento de Wallet" onClose={() => setShowAjuste(false)}>
          <AjusteForm
            direccionInicial={dirInicial}
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

function AjusteForm({ onDone, direccionInicial = "INGRESO" }: { onDone: () => void; direccionInicial?: "INGRESO" | "EGRESO" }) {
  const [direction, setDirection] = useState<"INGRESO" | "EGRESO">(direccionInicial);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  // Fecha y hora (13/10/2026, pedido de Leo: "no se carga todo en tiempo real") -- arranca en
  // el momento actual (como ya hace el mismo campo en Movimientos), pero queda editable para
  // cargar algo que pasó antes y recién ahora se está registrando.
  const [occurredAt, setOccurredAt] = useState(todayLocal());
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
        occurredAt: new Date(occurredAt).toISOString(),
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
        <div className="field">
          <label>Fecha y hora</label>
          <input value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} type="datetime-local" />
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
