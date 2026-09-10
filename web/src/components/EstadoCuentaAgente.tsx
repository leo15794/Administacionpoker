import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import MovimientosHistorial from "./MovimientosHistorial";

// Agrupa los cierres (uno por club) en un bloque por semana — mismo criterio que la pestaña
// "Estado de cuenta del agente" de la planilla vieja: un total de la semana (suma de todos los
// clubes) y abajo el desglose club por club (Resultado, Rake, % RB, Rebate, Resultado ajustado,
// Cierre final). weekly_closings ya guarda todos estos campos por club/semana, así que esto es
// puramente de presentación — no hace falta nada nuevo del backend.
function agruparPorSemana(cierres: any[]) {
  const grupos = new Map<string, any[]>();
  for (const c of cierres) {
    const key = `${c.week_start}_${c.week_end}`;
    (grupos.get(key) ?? grupos.set(key, []).get(key)!).push(c);
  }
  return [...grupos.entries()]
    .map(([key, filas]) => {
      const [week_start, week_end] = key.split("_");
      const total = filas.reduce((s, f) => s + Number(f.final_closing), 0);
      return { week_start, week_end, filas, total };
    })
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
}

/**
 * Estado de cuenta completo de un agente, para que un admin lo vea de cualquiera (no solo el
 * propio agente logueado, que ya tiene esto en "Mi cuenta"). Mismo endpoint/shape que
 * /portal/mi-cuenta, parametrizado por agentId vía /catalog/agents/:id/cuenta.
 *
 * Reemplaza al viejo modal "Historial" que solo mostraba la lista cruda de movimientos sin
 * saldo por club, garantía ni cierres — acá se ve todo junto, como el propio agente lo vería.
 */
export default function EstadoCuentaAgente({ agentId }: { agentId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    api.cuentaDeAgente(agentId).then(setData).catch((e) => setError(e.message));
  }, [agentId]);

  if (error) return <div className="error">No se pudo cargar el estado de cuenta: {error}</div>;
  if (!data) return <div className="muted">Cargando...</div>;

  const totalNeto = data.saldos.reduce((s: number, b: any) => s + Number(b.amount), 0);

  return (
    <div>
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
        <h3>Saldo por club</h3>
        {data.saldos.length === 0 ? (
          <div className="muted">Sin saldos cargados todavía.</div>
        ) : (
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
        )}
      </div>

      <div className="panel">
        <h3>Últimos cierres semanales</h3>
        {data.cierres.length === 0 ? (
          <div className="muted">Sin cierres cargados todavía.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {agruparPorSemana(data.cierres).map((semana) => (
              <div key={`${semana.week_start}_${semana.week_end}`} className="panel" style={{ padding: 14 }}>
                <div className="topbar" style={{ marginBottom: 10 }}>
                  <div>
                    <strong>{dateShort(semana.week_start)} - {dateShort(semana.week_end)}</strong>
                    <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                      {semana.total >= 0 ? "DEBEMOS / saldo a favor del agente" : "NOS DEBE / saldo a favor de DigiPlayers"}
                    </span>
                  </div>
                  <span className={`badge ${semana.total >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>
                    Cierre semanal: {usd(semana.total)}
                  </span>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Club</th><th>Resultado</th><th>Rake</th><th>% RB</th><th>Rakeback</th>
                      <th>% Rebate</th><th>Rebate</th><th>Resultado ajustado</th><th>Cierre final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semana.filas.map((c: any) => (
                      <tr key={c.id}>
                        <td>{c.club_name}</td>
                        <td>{usd(c.result)}</td>
                        <td>{usd(c.rake_total)}</td>
                        <td className="muted">{pct(c.rakeback_pct)}</td>
                        <td>{usd(c.rakeback)}</td>
                        <td className="muted">{pct(c.rebate_pct)}</td>
                        <td>{usd(c.rebate)}</td>
                        <td>{usd(c.adjusted_result)}</td>
                        <td><span className={`badge ${Number(c.final_closing) >= 0 ? "pos" : "neg"}`}>{usd(c.final_closing)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Movimientos</h3>
        <MovimientosHistorial agentId={agentId} />
      </div>
    </div>
  );
}
