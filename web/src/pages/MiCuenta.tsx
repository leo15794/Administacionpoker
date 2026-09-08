import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";

export default function MiCuenta() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.miCuenta().then(setData);
  }, []);

  if (!data) return <div className="muted">Cargando...</div>;

  const totalNeto = data.saldos.reduce((s: number, b: any) => s + Number(b.amount), 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Hola, {data.agente.name}</h2>
          <div className="muted">Sistema: {data.agente.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"}{data.agente.supervisor ? ` · Supervisor: ${data.agente.supervisor}` : ""}</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Saldo neto total</div>
          <div className={`value ${totalNeto >= 0 ? "pos" : "neg"}`}>{usd(totalNeto)}</div>
        </div>
        {data.garantia && (
          <div className="kpi-card">
            <div className="label">Garantía vigente</div>
            <div className="value">{usd(data.garantia.amount)}</div>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Mi saldo por club</h3>
        <table>
          <thead><tr><th>Club</th><th>Saldo</th></tr></thead>
          <tbody>
            {data.saldos.map((b: any) => (
              <tr key={b.id}>
                <td>{b.club_name}</td>
                <td><span className={`badge ${Number(b.amount) > 0 ? "pos" : Number(b.amount) < 0 ? "neg" : "neutral"}`}>{usd(b.amount)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Mis últimos cierres semanales</h3>
        <table>
          <thead><tr><th>Semana</th><th>Club</th><th>Cierre final</th></tr></thead>
          <tbody>
            {data.cierres.map((c: any) => (
              <tr key={c.id}>
                <td>{dateShort(c.week_start)} - {dateShort(c.week_end)}</td>
                <td>{c.club_name}</td>
                <td><span className={`badge ${Number(c.final_closing) >= 0 ? "pos" : "neg"}`}>{usd(c.final_closing)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Mis movimientos recientes</h3>
        {data.movimientos.length === 0 ? (
          <div className="muted">Todavía no hay movimientos registrados en el sistema nuevo.</div>
        ) : (
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Club</th><th>Monto</th></tr></thead>
            <tbody>
              {data.movimientos.map((m: any) => (
                <tr key={m.id}>
                  <td>{dateShort(m.occurred_at)}</td>
                  <td>{m.type}</td>
                  <td>{m.club_name}</td>
                  <td>{usd(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
