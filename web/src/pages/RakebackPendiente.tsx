import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

// Rakeback pendiente (22/09/2026, pedido de Leo): el cierre semanal ahora separa el resultado
// de mesas (Win/Lose -- lo único que mueve el stock físico/balance del agente automáticamente,
// ver repo/closings.ts) de todo lo demás (rakeback, rebate, Rodeo, ajuste manual), que queda
// ACÁ pendiente hasta decidir cómo se salda: en fichas (SÍ mueve el stock, movimiento CARGA),
// en USDT/efectivo/Zelle (pago financiero real, movimiento PAGO, no toca el stock) o se deja
// pendiente sin más. Una fila por cierre+rol -- normalmente una (el agente), y una segunda si
// el club desvía el rebate a un supervisor (antes se acreditaba directo a su balance, ahora
// también queda pendiente).
export default function RakebackPendiente() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  const [abierto, setAbierto] = useState<string | null>(null);
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<"FICHAS" | "USDT" | "EFECTIVO" | "ZELLE">("FICHAS");
  const [custodio, setCustodio] = useState("");
  const [nota, setNota] = useState("");
  const [pagando, setPagando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.rakebackPendiente().then(setRows).catch((e) => setError(e.message));
  }

  useEffect(() => {
    refresh();
  }, []);

  function abrir(p: any) {
    setAbierto(p.id);
    setMsg(null);
    setMedio("FICHAS");
    setCustodio("");
    setNota("");
    setMonto((Number(p.amount) - Number(p.consumed)).toFixed(2));
  }

  async function pagar(p: any) {
    const pendiente = Number(p.amount) - Number(p.consumed);
    const m = Number(monto);
    if (!(m > 0)) return setMsg({ ok: false, text: "El importe tiene que ser mayor a 0." });
    if (m > pendiente + 0.005) return setMsg({ ok: false, text: `No puede superar el pendiente disponible (${usd(pendiente)}).` });
    if (medio === "EFECTIVO" && !custodio.trim()) return setMsg({ ok: false, text: "Un pago en efectivo requiere custodio (BIT-051/052)." });
    setPagando(true);
    setMsg(null);
    try {
      await api.pagarRakebackPendiente({
        pendienteId: p.id,
        amount: m,
        medio,
        custodian: medio === "EFECTIVO" ? custodio.trim() : undefined,
        notes: nota.trim() || undefined,
      });
      setAbierto(null);
      refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el pago." });
    } finally {
      setPagando(false);
    }
  }

  async function darDeBaja(p: any) {
    const pendiente = Number(p.amount) - Number(p.consumed);
    if (!(await confirmDialog(`¿Dar de baja el rakeback pendiente de ${p.agent_name} (${p.club_name}) por ${usd(pendiente)}? Queda en 0 sin generar ningún movimiento de plata -- no se puede deshacer desde acá.`))) return;
    try {
      await api.darDeBajaRakebackPendiente(p.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo dar de baja.");
    }
  }

  async function eliminar(p: any) {
    if (!(await confirmDialog(`¿Eliminar este rakeback pendiente de ${p.agent_name} (${p.club_name})? Borrado real, no queda en historial -- para uno cargado de prueba. No se puede deshacer.`))) return;
    setBorrando(p.id);
    try {
      await api.eliminarRakebackPendiente(p.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar.");
    } finally {
      setBorrando(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Rakeback pendiente</h2>
          <div className="muted">
            Lo que cada cierre semanal generó además del Win/Lose (rakeback, rebate, Rodeo, ajuste manual) — pendiente
            hasta que se paga en fichas (mueve el stock) o en USDT/efectivo/Zelle (pago financiero, no toca el stock).
          </div>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      <div className="panel" style={{ marginTop: 16 }}>
        {!rows ? (
          <div className="muted">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="muted">No hay rakeback pendiente por pagar.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th>Agente</th>
                <th>Club</th>
                <th>Rol</th>
                <th>Monto</th>
                <th>Pagado</th>
                <th>Pendiente</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p: any) => {
                const pendiente = Number(p.amount) - Number(p.consumed);
                return (
                  <>
                    <tr key={p.id}>
                      <td className="muted">{dateShort(p.week_start)} - {dateShort(p.week_end)}</td>
                      <td>{p.agent_name}</td>
                      <td>{p.club_name}</td>
                      <td className="muted">{p.role === "SUPERVISOR" ? "Supervisor" : "Agente"}</td>
                      <td>{usd(p.amount)}</td>
                      <td className="muted">{usd(p.consumed)}</td>
                      <td><strong className={pendiente >= 0 ? "pos" : "neg"}>{usd(pendiente)}</strong></td>
                      <td style={{ display: "flex", gap: 6 }}>
                        <button className="btn secondary small" onClick={() => abrir(p)}>Pagar</button>
                        <button className="btn secondary small" onClick={() => darDeBaja(p)}>Dar de baja</button>
                        {Number(p.consumed) === 0 && (
                          <button
                            className="btn secondary small"
                            disabled={borrando === p.id}
                            onClick={() => eliminar(p)}
                            style={{ color: "var(--danger, #e5484d)" }}
                          >
                            {borrando === p.id ? "..." : "Eliminar"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {abierto === p.id && (
                      <tr>
                        <td colSpan={8}>
                          <div className="panel" style={{ margin: "8px 0", maxWidth: 460 }}>
                            <div className="field">
                              <label>Medio de pago</label>
                              <select value={medio} onChange={(e) => setMedio(e.target.value as any)}>
                                <option value="FICHAS">Fichas (mueve el stock físico)</option>
                                <option value="USDT">USDT</option>
                                <option value="EFECTIVO">Efectivo</option>
                                <option value="ZELLE">Zelle</option>
                              </select>
                            </div>
                            <div className="field">
                              <label>Importe (USD)</label>
                              <input type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} style={{ width: 150 }} />
                            </div>
                            {medio === "EFECTIVO" && (
                              <div className="field">
                                <label>Custodio del efectivo</label>
                                <input value={custodio} onChange={(e) => setCustodio(e.target.value)} placeholder="Quién tiene la plata físicamente" />
                              </div>
                            )}
                            <div className="field">
                              <label>Observación (opcional)</label>
                              <input value={nota} onChange={(e) => setNota(e.target.value)} />
                            </div>
                            {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
                            <div style={{ display: "flex", gap: 8 }}>
                              <button className="btn" disabled={pagando} onClick={() => pagar(p)}>
                                {pagando ? "Registrando..." : "Confirmar pago"}
                              </button>
                              <button className="btn secondary" onClick={() => setAbierto(null)}>Cancelar</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
