import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Loading from "../components/Loading";

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

  useEffect(() => {
    api.miProveedor().then(setData).catch((e) => setError(e.message));
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
