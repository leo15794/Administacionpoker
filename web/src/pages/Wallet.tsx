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

// Cuentas de la Wallet (13/11/2026, pedido de Leo, mockup 93): USDT y Zelle, cada una con su saldo. Lo cargado con medio Zelle va a Zelle.
type Cuenta = "WALLET_MANOS" | "ZELLE";
const CUENTAS: { k: Cuenta; t: string; unidad: string }[] = [
  { k: "WALLET_MANOS", t: "USDT", unidad: "USDT" },
  { k: "ZELLE", t: "Zelle", unidad: "USD" },
];
const CLAVE_CUENTA = "dp_wallet_cuenta";

export default function Wallet() {
  const { alertDialog, promptDialog } = useConfirmDialog();
  const [cuenta, setCuenta] = useState<Cuenta>(() => {
    try { return localStorage.getItem(CLAVE_CUENTA) === "ZELLE" ? "ZELLE" : "WALLET_MANOS"; } catch { return "WALLET_MANOS"; }
  });
  const [showPase, setShowPase] = useState(false);
  const [data, setData] = useState<any>(null);
  // Caja de efectivo (20/10/2026): se sacó la pantalla "Tesorería" porque nunca tuvo un solo movimiento de
  // efectivo (todo lo real es Wallet USDT). Si algún día se carga algo en efectivo, aparece acá abajo solo.
  const [caja, setCaja] = useState<any>(null);
  const [error, setError] = useState("");
  const [showAjuste, setShowAjuste] = useState(false);
  const [dirInicial, setDirInicial] = useState<"INGRESO" | "EGRESO">("INGRESO");
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh(c: Cuenta = cuenta) {
    setError("");
    api
      .tesoreria({ ledger: c })
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
    try { localStorage.setItem(CLAVE_CUENTA, cuenta); } catch { /* sin almacenamiento */ }
    setData(null);
    refresh(cuenta);
  }, [cuenta]);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Wallet: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={() => refresh()}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!data) return <Loading />;

  const saldoDe = (k: Cuenta) => Number(data.porLedger.find((l: any) => l.ledger === k)?.neto ?? 0);
  const wallet = data.porLedger.find((l: any) => l.ledger === cuenta);
  const actual = CUENTAS.find((c) => c.k === cuenta)!;

  return (
    <div>
      <WalletMovimientos
        titulo={<h2>Wallet <Ayuda>Dos cuentas, cada una con su saldo: USDT (la wallet) y Zelle (USD). Los cobros y pagos con medio Zelle van a Zelle; el resto, a USDT.
          Para plata que entra o sale sin ser un movimiento de agente, usá "Registrar ingreso" o "Registrar egreso" en la cuenta que corresponda; para pasar plata de una a otra, "Mover entre USDT y Zelle".</Ayuda></h2>}
        unidad={actual.unidad}
        archivo={cuenta === "ZELLE" ? "wallet-zelle.csv" : "wallet.csv"}
        selectorCuentas={
          <div className="wz-cuentas" role="tablist" aria-label="Cuenta">
            {CUENTAS.map((c) => (
              <button key={c.k} type="button" role="tab" aria-selected={cuenta === c.k} className={`wz-cuenta ${c.k === "ZELLE" ? "z" : "u"} ${cuenta === c.k ? "on" : ""}`} onClick={() => setCuenta(c.k)}>
                <small><i />{c.t}{c.k === "ZELLE" ? " (USD)" : ""}</small>
                <b>{saldoDe(c.k).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
              </button>
            ))}
          </div>
        }
        botonesExtra={<button className="wm-b wz-mover" onClick={() => setShowPase(true)}>⇄ Mover entre USDT y Zelle</button>}
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

      {showPase && (
        <Modal title="Mover entre USDT y Zelle" onClose={() => setShowPase(false)}>
          <PaseForm
            desdeInicial={cuenta}
            saldos={{ WALLET_MANOS: saldoDe("WALLET_MANOS"), ZELLE: saldoDe("ZELLE") }}
            onDone={() => {
              setShowPase(false);
              refresh();
            }}
          />
        </Modal>
      )}

      {showAjuste && (
        <Modal title={`Registrar movimiento — ${actual.t}`} onClose={() => setShowAjuste(false)}>
          <AjusteForm
            ledger={cuenta}
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

function AjusteForm({ onDone, ledger, direccionInicial = "INGRESO" }: { onDone: () => void; ledger: Cuenta; direccionInicial?: "INGRESO" | "EGRESO" }) {
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
        ledger,
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
        Se registra en la cuenta {ledger === "ZELLE" ? "Zelle" : "USDT"}. Usá esto para plata que entra o sale sin ser un cobro o pago de un agente (carga propia, retiro, diferencia de arqueo). Queda registrado acá mismo, en el historial de Wallet.
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
          <label>Monto ({ledger === "ZELLE" ? "USD" : "USDT"})</label>
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

// Mover plata entre USDT y Zelle (13/11/2026, mockup 93): egreso en una cuenta e ingreso en la otra, juntos. Si lo que entra es distinto de lo
// que sale (cambio, comisión), la diferencia queda anotada. Revertir un lado revierte los dos.
function PaseForm({ desdeInicial, saldos, onDone }: { desdeInicial: Cuenta; saldos: Record<Cuenta, number>; onDone: () => void }) {
  const [desde, setDesde] = useState<Cuenta>(desdeInicial);
  const hacia: Cuenta = desde === "ZELLE" ? "WALLET_MANOS" : "ZELLE";
  const [sale, setSale] = useState("");
  const [entra, setEntra] = useState("");
  const [entraTocado, setEntraTocado] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayLocal());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const nombre = (c: Cuenta) => (c === "ZELLE" ? "Zelle" : "USDT");
  const nf = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const montoSale = Math.abs(Number(sale) || 0);
  const montoEntra = Math.abs(Number(entraTocado ? entra : sale) || 0);
  const dif = Math.round((montoSale - montoEntra) * 100) / 100;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!montoSale || !montoEntra) return setMsg({ ok: false, text: "Poné cuánto sale y cuánto entra." });
    setLoading(true);
    try {
      await api.paseTesoreria({ desde, hacia, montoSale, montoEntra, motivo: motivo.trim() || undefined, occurredAt: new Date(occurredAt).toISOString() });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo mover la plata." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Pasa plata de una cuenta a la otra. No es ingreso ni gasto: el total no cambia, salvo la diferencia del cambio.
      </div>
      <div className="wz-sentido">
        <div className="field">
          <label>Desde</label>
          <select value={desde} onChange={(e) => setDesde(e.target.value as Cuenta)}>
            <option value="WALLET_MANOS">USDT</option>
            <option value="ZELLE">Zelle</option>
          </select>
        </div>
        <button type="button" className="btn secondary" onClick={() => setDesde(hacia)} title="Invertir el sentido">⇄</button>
        <div className="field">
          <label>Hacia</label>
          <select value={hacia} onChange={(e) => setDesde(e.target.value === "ZELLE" ? "WALLET_MANOS" : "ZELLE")}>
            <option value="WALLET_MANOS">USDT</option>
            <option value="ZELLE">Zelle</option>
          </select>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Sale de {nombre(desde)}</label>
          <input value={sale} onChange={(e) => setSale(e.target.value)} type="number" step="0.01" min="0" autoFocus />
        </div>
        <div className="field">
          <label>Entra a {nombre(hacia)}</label>
          <input value={entraTocado ? entra : sale} onChange={(e) => { setEntraTocado(true); setEntra(e.target.value); }} type="number" step="0.01" min="0" />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Si es distinto, la diferencia queda anotada</div>
        </div>
        <div className="field">
          <label>Fecha y hora</label>
          <input value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} type="datetime-local" />
        </div>
        <div className="field">
          <label>Motivo (opcional)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: cambio a Zelle" />
        </div>
      </div>
      <div className="wz-efecto">
        <h4>Qué va a pasar</h4>
        <div><span>{nombre(desde)}</span><span><b>{nf(saldos[desde])}</b> → <b>{nf(saldos[desde] - montoSale)}</b></span></div>
        <div><span>{nombre(hacia)}</span><span><b>{nf(saldos[hacia])}</b> → <b>{nf(saldos[hacia] + montoEntra)}</b></span></div>
        {dif !== 0 && <div><span>Diferencia del cambio</span><span><b>{nf(dif)}</b></span></div>}
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Moviendo..." : "Mover"}</button>
    </form>
  );
}
