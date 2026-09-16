import { useEffect, useState } from "react";
import { api } from "../api";
import { usd } from "../fmt";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  PREPAGO: "Prepago",
  WIN_LOSE: "Win/Lose",
  BANCADO: "Bancado",
  INTERNO: "Interno",
  SUPERVISOR: "Supervisor",
  UNION: "Unión",
};

// Vista mínima del rol Supervisor — mismo dato que la pestaña "Supervisores" que ya ve el admin
// en Administración, pero filtrado a un solo supervisor (el del login). Placeholder hasta tener
// las reglas de negocio completas de este rol: por ahora solo muestra, no permite ninguna acción.
export default function MiSupervision() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.miSupervision().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <div className="muted">Cargando...</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Hola, {data.supervisor.name}</h2>
          <div className="muted">Resumen de tu grupo de agentes a cargo.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Saldo propio</div>
          <div className={`value ${Number(data.supervisor.saldo_total) >= 0 ? "pos" : "neg"}`}>{usd(data.supervisor.saldo_total)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Rakeback centralizado acreditado</div>
          <div className="value">{usd(data.rakeback_centralizado_acreditado)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Agentes a cargo</div>
          <div className="value">{data.agentes.length}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Comisión por referido acumulada</div>
          <div className="value">{usd(data.saldo_referidos_total ?? 0)}</div>
        </div>
      </div>

      {data.referidos && data.referidos.length > 0 && (
        <div className="panel">
          <h3>Comisiones por referido</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            % fijo sobre el rake semanal de cada agente, acreditado automáticamente en cada cierre suyo — saldo separado de su propia liquidación.
          </div>
          <table>
            <thead><tr><th>Agente referido</th><th>%</th><th>Saldo acumulado</th></tr></thead>
            <tbody>
              {data.referidos.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.agente_referido_name}</td>
                  <td>{r.porcentaje}%</td>
                  <td>{usd(r.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.movimientos_referidos && data.movimientos_referidos.length > 0 && (
        <div className="panel">
          <h3>Historial de comisiones por referido</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Detalle de cada acreditación, semana por semana.
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Fecha</th><th>Agente</th><th>Semana del cierre</th><th>Tipo</th><th>Monto</th><th>Saldo resultante</th></tr></thead>
              <tbody>
                {data.movimientos_referidos.map((m: any) => (
                  <tr key={m.id}>
                    <td className="muted">{new Date(m.occurred_at).toLocaleDateString("es-AR")}</td>
                    <td>{m.agente_referido_name}</td>
                    <td className="muted">{m.week_start ? `${m.week_start} al ${m.week_end}` : "—"}</td>
                    <td><span className={`badge ${m.type === "COMISION" ? "pos" : "neutral"}`}>{m.type === "COMISION" ? "Comisión" : m.type === "PAGO" ? "Pago" : "Corrección"}</span></td>
                    <td className={Number(m.amount) >= 0 ? "pos" : "neg"}>{usd(m.amount)}</td>
                    <td>{usd(m.resulting_saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <h3>Agentes a cargo</h3>
        {data.agentes.length === 0 ? (
          <div className="muted">Todavía no tenés agentes a cargo.</div>
        ) : (
          <table>
            <thead><tr><th>Agente</th><th>Tipo de cuenta</th><th>Saldo</th></tr></thead>
            <tbody>
              {data.agentes.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td><span className="badge neutral">{ACCOUNT_TYPE_LABELS[a.account_type] ?? a.account_type}</span></td>
                  <td><span className={`badge ${Number(a.saldo_total) >= 0 ? "pos" : "neg"}`}>{usd(a.saldo_total)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
