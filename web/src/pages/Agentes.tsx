import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct } from "../fmt";

export default function Agentes() {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [deals, setDeals] = useState<any[]>([]);

  useEffect(() => {
    api.agentes().then(setAgentes);
  }, []);

  async function open(agent: any) {
    setSelected(agent);
    setDeals(await api.agentDeals(agent.id));
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Agentes</h2>
          <div className="muted">Catálogo abierto: cualquier agente puede operar en cualquier club activo (BIT-050).</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20 }}>
        <div className="panel" style={{ flex: 1 }}>
          <h3>Todos los agentes ({agentes.length})</h3>
          <table>
            <thead>
              <tr><th>Nombre</th><th>Sistema</th><th>Saldo total</th><th></th></tr>
            </thead>
            <tbody>
              {agentes.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{a.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                  <td><span className={`badge ${Number(a.saldo_total) > 0 ? "pos" : Number(a.saldo_total) < 0 ? "neg" : "neutral"}`}>{usd(a.saldo_total)}</span></td>
                  <td><button className="btn secondary" onClick={() => open(a)}>Ver deals</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div className="panel" style={{ width: 340 }}>
            <h3>Deals de {selected.name}</h3>
            <table>
              <thead><tr><th>Club</th><th>% RB</th><th>% Rebate</th></tr></thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.id}>
                    <td>{d.club_name}</td>
                    <td>{pct(d.rakeback_pct)}</td>
                    <td>{pct(d.rebate_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {deals[0]?.notes && <div className="muted" style={{ marginTop: 10 }}>{deals[0].notes}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
