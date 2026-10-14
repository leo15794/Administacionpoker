import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Loading from "../components/Loading";

// Mismas etiquetas que usa el admin en Movimientos (web/src/components/MovimientosHistorial.tsx)
// -- acá en versión de solo lectura, sin acciones de revertir/eliminar (eso es admin-only).
const TIPO_MOVIMIENTO_LABEL: Record<string, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  COBRO: "Cobro",
  PAGO: "Pago",
  TRANSFERENCIA_ENTRE_CLUBES: "Transferencia",
  TICKET_PROMOCIONAL: "Ticket promocional",
  AJUSTE: "Ajuste",
  CIERRE_SEMANAL: "Cierre semanal",
  PAGO_RAKEBACK: "Pago de rakeback pendiente",
  ADELANTO_RAKEBACK: "Adelanto de rakeback (USDT)",
  ADELANTO_FICHAS: "Adelanto de fichas",
};

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

  // Cuenta consolidada -- cierre semanal de agentes a cargo, en solo lectura (14/10/2026,
  // pedido de Leo: "deberia el poder entrar y ver el desglose que esta cargado en
  // supervisores"). Mismo patrón que la pestaña admin en Supervisores.tsx, pero sin ningún
  // botón de aplicar -- eso sigue siendo acción exclusiva del admin.
  const [semanasCierre, setSemanasCierre] = useState<any[] | null>(null);
  const [weekCierre, setWeekCierre] = useState("");
  const [cierreSemana, setCierreSemana] = useState<any | null>(null);
  const [cargandoCierre, setCargandoCierre] = useState(false);

  useEffect(() => {
    api.miSupervision().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!data?.supervisor?.usa_cuenta_consolidada) return;
    api.miSupervisionSemanasCierre().then((semanas: any[]) => {
      setSemanasCierre(semanas);
      if (semanas.length > 0) {
        const ws = String(semanas[0].week_start).slice(0, 10);
        setWeekCierre(ws);
        cargarCierreSemana(ws);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.supervisor?.usa_cuenta_consolidada]);

  async function cargarCierreSemana(ws: string) {
    setCargandoCierre(true);
    try {
      setCierreSemana(await api.miSupervisionCierreSemanal(ws));
    } finally {
      setCargandoCierre(false);
    }
  }

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <Loading />;

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

      {data.supervisor.usa_cuenta_consolidada && (
        <div className="panel">
          <h3>Cuenta consolidada</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            Desglose de tu cuenta consolidada -- lo mismo que ve el admin en Administración desde
            Supervisores, filtrado a tu propia cuenta. Solo lectura.
          </div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Fichas reales</div>
              <div className={`value ${Number(data.supervisor.fichas_reales) >= 0 ? "pos" : "neg"}`}>{usd(Number(data.supervisor.fichas_reales))}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Cuenta corriente</div>
              <div className={`value ${Number(data.supervisor.cuenta_corriente) >= 0 ? "pos" : "neg"}`}>{usd(Number(data.supervisor.cuenta_corriente))}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Saldo total</div>
              <div className={`value ${Number(data.supervisor.fichas_reales) + Number(data.supervisor.cuenta_corriente) >= 0 ? "pos" : "neg"}`}>
                {usd(Number(data.supervisor.fichas_reales) + Number(data.supervisor.cuenta_corriente))}
              </div>
            </div>
          </div>

          <h4 style={{ margin: "4px 0 6px" }}>Cierre semanal de agentes a cargo</h4>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Cada semana, las fichas ganadas en mesas de tus agentes a cargo se suman a Fichas reales, y el
            rakeback que generan se suma a Cuenta corriente -- el saldo propio de cada agente sigue
            acumulando igual que siempre, esto es solo el espejo de tu cuenta.
          </div>
          {!semanasCierre ? (
            <Loading />
          ) : semanasCierre.length === 0 ? (
            <div className="muted">Todavía no hay ningún cierre semanal cargado para tus agentes a cargo.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <label className="muted" style={{ fontSize: 12 }}>Semana</label>
                <select
                  value={weekCierre}
                  onChange={(e) => {
                    setWeekCierre(e.target.value);
                    cargarCierreSemana(e.target.value);
                  }}
                >
                  {semanasCierre.map((s) => {
                    const ws = String(s.week_start).slice(0, 10);
                    return (
                      <option key={ws} value={ws}>
                        {dateShort(s.week_start)} al {dateShort(s.week_end)}
                      </option>
                    );
                  })}
                </select>
                {cierreSemana?.aplicado ? (
                  <span className="badge pos">Aplicada el {dateShort(cierreSemana.aplicado.created_at)}</span>
                ) : (
                  <span className="badge neutral">Todavía no aplicada</span>
                )}
              </div>

              {cargandoCierre || !cierreSemana ? (
                <Loading />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Agente a cargo</th>
                      <th className="num">Fichas ganadas en la semana</th>
                      <th className="num">Rakeback generado en la semana</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cierreSemana.lineas.map((l: any) => (
                      <tr key={l.agent_id}>
                        <td>{l.agent_name}</td>
                        <td className={`num ${Number(l.result) >= 0 ? "pos" : "neg"}`}>{usd(Number(l.result))}</td>
                        <td className="num">{usd(Number(l.rakeback))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 700 }}>
                      <td>Total de la semana</td>
                      <td className="num">{usd(cierreSemana.resultadoTotal)}</td>
                      <td className="num">{usd(cierreSemana.rakebackTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </>
          )}
        </div>
      )}

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

      {data.movimientos_agentes && data.movimientos_agentes.length > 0 && (
        <div className="panel">
          <h3>Pagos y movimientos</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Todo lo que pasó con las cuentas de tu grupo: pagos que les enviamos, cargas y
            descargas de fichas, transferencias entre clubes y ajustes -- para que puedan ver de
            un vistazo cuándo les mandamos plata o hicimos algún cambio.
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Agente</th><th>Club</th><th>Monto</th><th>Observación</th></tr></thead>
              <tbody>
                {data.movimientos_agentes.map((m: any) => (
                  <tr key={m.id}>
                    <td className="muted">{dateShort(m.occurred_at)}</td>
                    <td><span className="badge neutral">{TIPO_MOVIMIENTO_LABEL[m.type] ?? m.type}</span></td>
                    <td>{m.agent_name}</td>
                    <td>{m.club_name}</td>
                    <td><span className={`badge ${Number(m.amount) > 0 ? "pos" : Number(m.amount) < 0 ? "neg" : "neutral"}`}>{usd(m.amount)}</span></td>
                    <td className="muted" style={{ fontSize: 12 }}>{m.observation || "—"}</td>
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
