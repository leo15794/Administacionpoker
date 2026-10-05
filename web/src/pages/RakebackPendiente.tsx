import { Fragment, useEffect, useState } from "react";
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

  // Filtro + agrupado por agente (05/10/2026, pedido de Leo: "poner filtro" + "poder agrupar
  // entre agentes") -- todo client-side, son las filas que ya trae /rakeback-pendiente, no hay
  // necesidad de ir de nuevo al backend por esto.
  const [filtro, setFiltro] = useState("");
  const [filtroClub, setFiltroClub] = useState("");
  const [agrupar, setAgrupar] = useState(true);
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());

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

  function toggleColapsado(agentName: string) {
    setColapsados((prev) => {
      const next = new Set(prev);
      if (next.has(agentName)) next.delete(agentName);
      else next.add(agentName);
      return next;
    });
  }

  // Clubes distintos presentes en los datos, para el select de filtro -- se arma solo, no hay
  // que mantenerlo a mano en ningún lado.
  const clubesDisponibles = Array.from(new Set((rows ?? []).map((p: any) => p.club_name as string))).sort();

  const filtroNorm = filtro.trim().toLowerCase();
  const filasFiltradas = (rows ?? []).filter((p: any) => {
    if (filtroClub && p.club_name !== filtroClub) return false;
    if (filtroNorm && !p.agent_name.toLowerCase().includes(filtroNorm) && !p.club_name.toLowerCase().includes(filtroNorm)) return false;
    return true;
  });

  // Grupos por agente (05/10/2026, pedido de Leo) -- orden por mayor pendiente total primero,
  // así los agentes que de verdad importan quedan arriba en vez de perderse en orden alfabético.
  const gruposPorAgente = (() => {
    const mapa = new Map<string, any[]>();
    for (const p of filasFiltradas) {
      const lista = mapa.get(p.agent_name) ?? [];
      lista.push(p);
      mapa.set(p.agent_name, lista);
    }
    return Array.from(mapa.entries())
      .map(([agentName, filas]) => ({
        agentName,
        filas,
        totalPendiente: filas.reduce((s, p) => s + (Number(p.amount) - Number(p.consumed)), 0),
      }))
      .sort((a, b) => Math.abs(b.totalPendiente) - Math.abs(a.totalPendiente));
  })();

  // Fila de la tabla (misma, se use agrupado o no) -- factoreada para no duplicar el JSX de
  // acciones/popup de pago entre las dos vistas.
  function filaTabla(p: any, mostrarAgente: boolean) {
    const pendiente = Number(p.amount) - Number(p.consumed);
    return (
      <Fragment key={p.id}>
        <tr>
          <td className="muted">{dateShort(p.week_start)} - {dateShort(p.week_end)}</td>
          {mostrarAgente && <td>{p.agent_name}</td>}
          <td>{p.club_name}</td>
          <td className="muted">{p.role === "SUPERVISOR" ? "Supervisor" : "Agente"}</td>
          <td className="num money">{usd(p.amount)}</td>
          <td className="num muted">{usd(p.consumed)}</td>
          <td className="num"><strong className={pendiente >= 0 ? "pos" : "neg"}>{usd(pendiente)}</strong></td>
          <td style={{ display: "flex", gap: 6 }}>
            <button className="btn secondary small" onClick={() => abrir(p)}>Pagar</button>
            <button className="btn secondary small" onClick={() => darDeBaja(p)}>Dar de baja</button>
            {Number(p.consumed) === 0 && (
              <button
                className="btn secondary small"
                disabled={borrando === p.id}
                onClick={() => eliminar(p)}
                style={{ color: "var(--red)" }}
              >
                {borrando === p.id ? "..." : "Eliminar"}
              </button>
            )}
          </td>
        </tr>
        {abierto === p.id && (
          <tr>
            <td colSpan={mostrarAgente ? 8 : 7}>
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
      </Fragment>
    );
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

      {/* Filtro + agrupado por agente (05/10/2026, pedido de Leo: "poner filtro" + "poder
          agrupar entre agentes") -- todo client-side sobre lo que ya trajo /rakeback-pendiente. */}
      <div className="panel" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          placeholder="Buscar agente o club..."
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={filtroClub} onChange={(e) => setFiltroClub(e.target.value)}>
          <option value="">Todos los clubes</option>
          {clubesDisponibles.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} />
          Agrupar por agente
        </label>
      </div>

      <div className="panel" style={{ marginTop: 10 }}>
        {!rows ? (
          <div className="muted">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="muted">No hay rakeback pendiente por pagar.</div>
        ) : filasFiltradas.length === 0 ? (
          <div className="muted">Ningún resultado con ese filtro.</div>
        ) : agrupar ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {gruposPorAgente.map((g) => {
              const colapsado = colapsados.has(g.agentName);
              return (
                <div key={g.agentName} className="panel" style={{ padding: 0 }}>
                  <div
                    onClick={() => toggleColapsado(g.agentName)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="muted">{colapsado ? "▸" : "▾"}</span>
                      <strong>{g.agentName}</strong>
                      <span className="muted">({g.filas.length} {g.filas.length === 1 ? "fila" : "filas"})</span>
                    </div>
                    <strong className={g.totalPendiente >= 0 ? "pos" : "neg"}>{usd(g.totalPendiente)}</strong>
                  </div>
                  {!colapsado && (
                    <table style={{ borderTop: "1px solid var(--border)" }}>
                      <thead>
                        <tr>
                          <th>Semana</th>
                          <th>Club</th>
                          <th>Rol</th>
                          <th className="num">Monto</th>
                          <th className="num">Pagado</th>
                          <th className="num">Pendiente</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>{g.filas.map((p: any) => filaTabla(p, false))}</tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th>Agente</th>
                <th>Club</th>
                <th>Rol</th>
                <th className="num">Monto</th>
                <th className="num">Pagado</th>
                <th className="num">Pendiente</th>
                <th></th>
              </tr>
            </thead>
            <tbody>{filasFiltradas.map((p: any) => filaTabla(p, true))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
