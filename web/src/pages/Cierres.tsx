import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";

export default function Cierres() {
  const [cierres, setCierres] = useState<any[]>([]);

  useEffect(() => {
    api.cierres().then(setCierres);
  }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cierres semanales</h2>
          <div className="muted">Clave idempotente (agente + club + semana) — un cierre nunca se aplica dos veces (BIT-001).</div>
        </div>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Semana</th><th>Agente</th><th>Club</th><th>Sistema</th>
              <th>Resultado</th><th>Rake</th><th>Rakeback</th><th>Cierre final</th><th>Regla</th>
            </tr>
          </thead>
          <tbody>
            {cierres.map((c) => (
              <tr key={c.id}>
                <td>{dateShort(c.week_start)} - {dateShort(c.week_end)}</td>
                <td>{c.agent_name}</td>
                <td>{c.club_name}</td>
                <td>{c.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                <td>{usd(c.result)}</td>
                <td>{usd(c.rake_total)}</td>
                <td>{usd(c.rakeback)}</td>
                <td><span className={`badge ${Number(c.final_closing) >= 0 ? "pos" : "neg"}`}>{usd(c.final_closing)}</span></td>
                <td>{c.rule_applied ? <span className="badge neutral">{c.rule_applied}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
