import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import MovimientosHistorial from "./MovimientosHistorial";

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
        )}
      </div>

      <div className="panel">
        <h3>Movimientos</h3>
        <MovimientosHistorial agentId={agentId} />
      </div>
    </div>
  );
}
