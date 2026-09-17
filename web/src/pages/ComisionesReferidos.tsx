import { useEffect, useState } from "react";
import { api } from "../api";
import { usd } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

// Pantalla dedicada para no tener que entrar a Usuarios y permisos → editar cada supervisor
// solo para ver cuánto le corresponde de comisión por referido. Acá se ven TODOs los
// supervisores con comisión activa, con el historial de cada uno, y el botón para pagar cruza
// TODO el saldo acumulado contra Wallet en un solo movimiento (mismo patrón que "Registrar el
// pago" en Jugadores bancados).
export default function ComisionesReferidos() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [data, setData] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [pagando, setPagando] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState<string | null>(null);
  const [historiales, setHistoriales] = useState<Record<string, any[]>>({});
  const [cargandoHistorial, setCargandoHistorial] = useState<string | null>(null);
  const [borrandoMov, setBorrandoMov] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.comisionesReferidos().then(setData).catch((e) => setError(e.message));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleHistorial(userId: string) {
    if (verHistorial === userId) {
      setVerHistorial(null);
      return;
    }
    setVerHistorial(userId);
    if (!historiales[userId]) {
      setCargandoHistorial(userId);
      try {
        const movimientos = await api.movimientosReferidos(userId);
        setHistoriales((h) => ({ ...h, [userId]: movimientos }));
      } finally {
        setCargandoHistorial(null);
      }
    }
  }

  // Solo se puede borrar el movimiento MÁS RECIENTE de cada referido (ver nota del backend) —
  // para corregir una acreditación o un pago cargado de más, sin desincronizar el saldo corrido.
  async function eliminarMovimiento(supervisorUserId: string, m: any) {
    const tipoLabel = m.type === "COMISION" ? "Comisión" : m.type === "PAGO" ? "Pago" : "Corrección";
    if (
      !(await confirmDialog(
        `¿Borrar este movimiento (${tipoLabel} de ${m.agente_referido_name}, ${usd(m.amount)})? Deja el saldo del referido como estaba antes de este movimiento. Es para corregir cargas de prueba, no se puede deshacer.${
          m.week_start ? " No revierte el cierre semanal que lo generó, solo la comisión." : ""
        }`,
        { danger: true }
      ))
    )
      return;
    setBorrandoMov(m.id);
    try {
      await api.eliminarMovimientoReferido(m.id);
      setHistoriales((h) => {
        const { [supervisorUserId]: _omit, ...resto } = h;
        return resto;
      });
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo borrar el movimiento.");
    } finally {
      setBorrandoMov(null);
    }
  }

  async function pagar(supervisor: any) {
    const total = usd(supervisor.saldoTotal);
    if (
      !(await confirmDialog(
        `¿Registrar el pago de ${total} a ${supervisor.email} (comisión por referido de ${supervisor.referidos.length} agente(s)) como un EGRESO en la Wallet (WALLET_MANOS)? Deja todos sus saldos en 0 y queda anotado en el historial de cada agente.`,
        { danger: false }
      ))
    )
      return;
    setPagando(supervisor.userId);
    try {
      await api.pagarComisionesReferido(supervisor.userId);
      // El historial de este supervisor cambió (se agregaron movimientos PAGO) — se descarta lo
      // cacheado para que, si lo vuelve a abrir, lo traiga de nuevo actualizado.
      setHistoriales((h) => {
        const { [supervisor.userId]: _omit, ...resto } = h;
        return resto;
      });
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo registrar el pago.");
    } finally {
      setPagando(null);
    }
  }

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Comisiones por referido: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="muted">Cargando...</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Comisiones por referido</h2>
          <div className="muted">
            Todos los supervisores con % de comisión por referido configurado, con su saldo acumulado y el historial de cada uno.
            Para asignar o cambiar un %, o dar de baja un referido, se hace desde Usuarios y permisos.
          </div>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="panel muted">Todavía no hay ningún supervisor con comisión por referido configurada.</div>
      ) : (
        data.map((s) => (
          <div key={s.userId} className="panel" style={{ marginBottom: 16 }}>
            <div className="topbar" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{s.email}</h3>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className={`badge ${Number(s.saldoTotal) >= 0 ? "pos" : "neg"}`}>Saldo total: {usd(s.saldoTotal)}</span>
                <button
                  className="btn small"
                  disabled={pagando === s.userId || Number(s.saldoTotal) <= 0}
                  onClick={() => pagar(s)}
                  title={Number(s.saldoTotal) <= 0 ? "No hay saldo positivo para pagar" : "Cruzar el total contra Wallet"}
                >
                  {pagando === s.userId ? "Registrando..." : "Pagar"}
                </button>
              </div>
            </div>
            <table>
              <thead><tr><th>Agente referido</th><th>%</th><th>Saldo</th></tr></thead>
              <tbody>
                {s.referidos.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.agenteName}</td>
                    <td className="muted">{r.porcentaje}%</td>
                    <td className={Number(r.saldo) >= 0 ? "pos" : "neg"}>{usd(r.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className="btn secondary small"
              style={{ marginTop: 10 }}
              onClick={() => toggleHistorial(s.userId)}
            >
              {verHistorial === s.userId ? "Ocultar historial" : "Ver historial"}
            </button>
            {verHistorial === s.userId && (
              cargandoHistorial === s.userId ? (
                <div className="muted" style={{ marginTop: 8 }}>Cargando...</div>
              ) : (historiales[s.userId]?.length ?? 0) === 0 ? (
                <div className="muted" style={{ marginTop: 8 }}>Todavía no hay movimientos.</div>
              ) : (
                <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8 }}>
                  <table>
                    <thead><tr><th>Fecha</th><th>Agente</th><th>Semana del cierre</th><th>Tipo</th><th>Monto</th><th>Saldo resultante</th><th></th></tr></thead>
                    <tbody>
                      {(() => {
                        const vistos = new Set<string>();
                        return historiales[s.userId].map((m: any) => {
                          // El historial viene ordenado más nuevo primero — la primera vez que
                          // aparece un referido_id es su movimiento más reciente, el único
                          // borrable individualmente (ver nota del backend).
                          const esElMasReciente = !vistos.has(m.referido_id);
                          vistos.add(m.referido_id);
                          return (
                            <tr key={m.id}>
                              <td className="muted">{new Date(m.occurred_at).toLocaleDateString("es-AR")}</td>
                              <td>{m.agente_referido_name}</td>
                              <td className="muted">{m.week_start ? `${m.week_start} al ${m.week_end}` : "—"}</td>
                              <td>
                                <span className={`badge ${m.type === "COMISION" ? "pos" : m.type === "PAGO" ? "neutral" : "neutral"}`}>
                                  {m.type === "COMISION" ? "Comisión" : m.type === "PAGO" ? "Pago" : "Corrección"}
                                </span>
                              </td>
                              <td className={Number(m.amount) >= 0 ? "pos" : "neg"}>{m.amount}</td>
                              <td>{m.resulting_saldo}</td>
                              <td>
                                {esElMasReciente && (
                                  <button
                                    className="btn danger small"
                                    disabled={borrandoMov === m.id}
                                    onClick={() => eliminarMovimiento(s.userId, m)}
                                    title="Borrar este movimiento puntual (deja el saldo como estaba antes) — para corregir pruebas"
                                  >
                                    {borrandoMov === m.id ? "..." : "Borrar"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        ))
      )}
    </div>
  );
}
