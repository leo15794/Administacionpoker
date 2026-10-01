import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";

// Saldo neto por club (01/10/2026): para PREPAGO, balances.amount solo no alcanza -- hay que
// sumarle el resultado acumulado de mesas (ver fichasTotal() en Resumen.tsx, misma fórmula).
function saldoNeto(b: any): number {
  if (b.system === "PREPAGO") return Number(b.amount) + Number(b.total_fichas_ganadas_mesas || 0);
  return Number(b.amount);
}


export default function MiCuenta() {
  const [misAgentes, setMisAgentes] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [data, setData] = useState<any>(null);

  // La mayoría de los logins tienen una sola cuenta — el selector solo aparece si de verdad hay
  // más de una asociada (ver Usuarios y permisos → "Agentes/clubes que puede ver").
  useEffect(() => {
    api.misAgentes().then(setMisAgentes).catch(() => {});
  }, []);

  useEffect(() => {
    api.miCuenta(agentId || undefined).then(setData);
  }, [agentId]);

  if (!data) return <div className="muted">Cargando...</div>;

  const totalNeto = data.saldos.reduce((s: number, b: any) => s + saldoNeto(b), 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Hola, {data.agente.name}</h2>
          <div className="muted">Sistema: {data.agente.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"}{data.agente.supervisor ? ` · Supervisor: ${data.agente.supervisor}` : ""}</div>
        </div>
        {misAgentes.length > 1 && (
          <div className="field" style={{ margin: 0 }}>
            <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Ver cuenta de</label>
            <select value={agentId || data.agente.id} onChange={(e) => setAgentId(e.target.value)}>
              {misAgentes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
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
                <td><span className={`badge ${saldoNeto(b) > 0 ? "pos" : saldoNeto(b) < 0 ? "neg" : "neutral"}`}>{usd(saldoNeto(b))}</span></td>
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
