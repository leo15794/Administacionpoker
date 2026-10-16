import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Loading from "../components/Loading";
import Modal from "../components/Modal";

const MEDIO_LABEL: Record<string, string> = {
  USDT: "USDT",
  EFECTIVO: "Efectivo",
  ZELLE: "Zelle",
  OTRO: "Otro",
};

// Portal de solo lectura del rol PROVEEDOR (16/10/2026, pedido de Leo: "agregarlos como
// usuarios y darles los permisos como hacemos con los supervisores") -- mismo dato que el admin
// ve en Administración -> Proveedores, filtrado a sí mismo (ver routes/portal.ts GET
// /mi-proveedor). Sin ninguna acción: ni cierres ni pagos se cargan desde acá, eso sigue siendo
// exclusivo del admin.
export default function MiProveedor() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  // Solicitudes de retiro/pago del propio proveedor (16/10/2026, pedido de Leo: "necesito todo
  // esto mismo para la sección de proveedores") -- mismo patrón que MiSupervision.tsx, panel
  // separado de "Pagos y cobros" a propósito, ver routes/portal.ts POST/GET
  // /mi-proveedor/solicitudes-retiro. El admin resuelve desde Administración -> Proveedores
  // (repo/proveedores.ts), eligiendo el club (el saldo del proveedor SÍ está separado por club).
  const [misSolicitudes, setMisSolicitudes] = useState<any[] | null>(null);
  const [showSolicitar, setShowSolicitar] = useState(false);

  function refrescarMisSolicitudes() {
    api.misSolicitudesRetiroProveedor().then(setMisSolicitudes);
  }

  useEffect(() => {
    api.miProveedor().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refrescarMisSolicitudes();
  }, []);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <Loading />;

  const saldoTotal = (data.saldos ?? []).reduce((s: number, x: any) => s + Number(x.amount), 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Hola, {data.proveedor.name}</h2>
          <div className="muted">Tu saldo, cierres semanales y pagos -- solo lectura.</div>
        </div>
        <button className="btn" onClick={() => setShowSolicitar(true)}>+ Solicitar retiro / pago</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Saldo total</div>
          <div className={`value ${saldoTotal >= 0 ? "pos" : "neg"}`}>{usd(saldoTotal)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Clubes con saldo</div>
          <div className="value">{(data.saldos ?? []).length}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Tus solicitudes de retiro</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Lo que vas pidiendo con "+ Solicitar retiro / pago" de arriba. Queda "Pendiente de envío"
          hasta que te mandemos los USDT -- en ese momento pasa a "Enviado" con el link de pago
          para que puedas ver el trackeo de la transacción.
        </div>
        {!misSolicitudes ? (
          <Loading />
        ) : misSolicitudes.length === 0 ? (
          <div className="muted">Todavía no pediste ningún retiro.</div>
        ) : (
          <table>
            <thead><tr><th>Fecha</th><th>Monto</th><th>Nota</th><th>Estado</th><th>Comprobante</th></tr></thead>
            <tbody>
              {misSolicitudes.map((s: any) => (
                <tr key={s.id} className={s.estado === "PENDIENTE" ? "fila-pendiente" : ""}>
                  <td className="muted">{dateShort(s.requested_at)}</td>
                  <td><span className="badge neutral">{usd(Number(s.amount))}</span></td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{s.nota || "—"}</td>
                  <td>
                    {s.estado === "PENDIENTE" && <span className="badge deal">Pendiente de envío</span>}
                    {s.estado === "ENVIADO" && <span className="badge pos">Enviado el {dateShort(s.resuelto_at)}</span>}
                    {s.estado === "RECHAZADO" && (
                      <span className="badge neg" title={s.resolucion_nota || undefined}>Rechazada</span>
                    )}
                  </td>
                  <td>
                    {s.payment_link ? (
                      <a className="link-pago" href={s.payment_link} target="_blank" rel="noreferrer">Ver pago ↗</a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showSolicitar && (
        <Modal title="Solicitar retiro / pago" onClose={() => setShowSolicitar(false)}>
          <SolicitarRetiroProveedorForm
            onDone={() => {
              setShowSolicitar(false);
              refrescarMisSolicitudes();
            }}
          />
        </Modal>
      )}

      <div className="panel">
        <h3>Saldo por club</h3>
        {(data.saldos ?? []).length === 0 ? (
          <div className="muted">Todavía no tenés saldo cargado en ningún club.</div>
        ) : (
          <table>
            <thead><tr><th>Club</th><th className="num">Saldo</th></tr></thead>
            <tbody>
              {data.saldos.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.club_name}</td>
                  <td className={`num ${Number(s.amount) >= 0 ? "pos" : "neg"}`}>{usd(Number(s.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Cierres semanales</h3>
        {(data.cierres ?? []).length === 0 ? (
          <div className="muted">Todavía no hay ningún cierre cargado.</div>
        ) : (
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Semana</th><th className="num">Cierre</th><th>Estado</th></tr></thead>
              <tbody>
                {data.cierres.map((c: any) => (
                  <tr key={c.id} className={c.status === "REVERTIDO" ? "muted" : ""}>
                    <td>{dateShort(c.week_start)} al {dateShort(c.week_end)}</td>
                    <td className={`num ${Number(c.cierre) >= 0 ? "pos" : "neg"}`}>{usd(Number(c.cierre))}</td>
                    <td>{c.status === "REVERTIDO" ? <span className="badge neutral">Revertido</span> : <span className="badge pos">Aplicado</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Pagos y cobros</h3>
        {(data.pagos ?? []).length === 0 ? (
          <div className="muted">Todavía no hay ningún pago o cobro registrado.</div>
        ) : (
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Fecha</th><th>Club</th><th>Tipo</th><th>Medio</th><th className="num">Monto</th><th>Estado</th></tr></thead>
              <tbody>
                {data.pagos.map((p: any) => (
                  <tr key={p.id} className={p.status === "REVERTIDO" ? "muted" : ""}>
                    <td className="muted">{dateShort(p.occurred_at)}</td>
                    <td>{p.club_name}</td>
                    <td><span className="badge neutral">{p.direction === "PAGO" ? "Pago" : "Cobro"}</span></td>
                    <td className="muted">{MEDIO_LABEL[p.medio] ?? p.medio}</td>
                    <td className="num">{usd(Number(p.amount))}</td>
                    <td>{p.status === "REVERTIDO" ? <span className="badge neutral">Revertido</span> : <span className="badge pos">Aplicado</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SolicitarRetiroProveedorForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const amountNum = Number(amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return setMsg({ ok: false, text: "El monto debe ser mayor a 0." });
    }
    setLoading(true);
    try {
      await api.solicitarRetiroProveedor({ amount: amountNum, nota: nota.trim() || null });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo enviar la solicitud." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Monto a retirar (USD)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ej: 500" />
      </div>
      <div className="field">
        <label>Nota para el admin (opcional)</label>
        <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        Le llega la notificación al admin apenas enviás esto. Vas a ver en esta pantalla cuándo lo
        revisan y, cuando te manden los USDT, el link de pago para trackearlo.
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" style={{ width: "100%" }} disabled={loading}>
        {loading ? "Enviando..." : "Enviar solicitud"}
      </button>
    </form>
  );
}
