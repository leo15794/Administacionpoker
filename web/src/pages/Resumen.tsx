import { useEffect, useState } from "react";
import { api } from "../api";
import { usd } from "../fmt";

export default function Resumen() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.resumen().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">No se pudo cargar el resumen: {error}</div>;
  if (!data) return <div className="muted">Cargando...</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen ejecutivo</h2>
          <div className="muted">Calculado en vivo desde el ledger — no desde celdas fijas.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Agentes nos deben</div>
          <div className="value neg">{usd(data.kpis.agentesNosDeben)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Debemos a agentes</div>
          <div className="value pos">{usd(data.kpis.debemosAAgentes)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Clubes activos</div>
          <div className="value">{data.kpis.clubesActivos}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Agentes activos</div>
          <div className="value">{data.kpis.agentesActivos}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Saldo neto por club</h3>
        <table>
          <thead>
            <tr><th>Club</th><th>Agentes con saldo</th><th>Saldo neto</th></tr>
          </thead>
          <tbody>
            {data.porClub.map((c: any) => (
              <tr key={c.club}>
                <td>{c.club}</td>
                <td>{c.agentes}</td>
                <td className={Number(c.saldo_neto) >= 0 ? "" : ""}>
                  <span className={`badge ${Number(c.saldo_neto) > 0 ? "pos" : Number(c.saldo_neto) < 0 ? "neg" : "neutral"}`}>
                    {usd(c.saldo_neto)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Saldos por agente y club (positivo = a favor del agente)</h3>
        <table>
          <thead>
            <tr><th>Agente</th><th>Club</th><th>Saldo</th></tr>
          </thead>
          <tbody>
            {data.balances
              .filter((b: any) => Number(b.amount) !== 0)
              .sort((a: any, b: any) => Number(b.amount) - Number(a.amount))
              .map((b: any) => (
                <tr key={b.id}>
                  <td>{b.agent_name}</td>
                  <td>{b.club_name}</td>
                  <td>
                    <span className={`badge ${Number(b.amount) > 0 ? "pos" : "neg"}`}>{usd(b.amount)}</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
