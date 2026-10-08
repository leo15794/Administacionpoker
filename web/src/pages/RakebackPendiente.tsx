import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";
import Loading from "../components/Loading";

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
  const [accion, setAccion] = useState<"pagar" | "cobrar">("pagar");
  const [monto, setMonto] = useState("");
  const [medio, setMedio] = useState<"FICHAS" | "USDT" | "EFECTIVO" | "ZELLE">("FICHAS");
  const [custodio, setCustodio] = useState("");
  const [nota, setNota] = useState("");
  const [pagando, setPagando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  // Alta manual de rakeback viejo (06/10/2026, pedido de Leo: "traer rakeback viejos que
  // todavia no pusimos en el sistema, eso tiene que afectar directamente al cierre del
  // agente") -- agentes/clubes para los selects del formulario, ver crearRakebackPendienteManual
  // en repo/rakebackPendiente.ts.
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [manualAbierto, setManualAbierto] = useState(false);
  const [manualAgentId, setManualAgentId] = useState("");
  const [manualClubId, setManualClubId] = useState("");
  const [manualWeekStart, setManualWeekStart] = useState("");
  const [manualWeekEnd, setManualWeekEnd] = useState("");
  const [manualMonto, setManualMonto] = useState("");
  const [manualNota, setManualNota] = useState("");
  const [manualGuardando, setManualGuardando] = useState(false);
  const [manualMsg, setManualMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function refresh() {
    setError("");
    api.rakebackPendiente().then(setRows).catch((e) => setError(e.message));
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes).catch(() => {});
    api.clubes().then(setClubes).catch(() => {});
  }, []);

  // Mismo criterio de semana (lunes a domingo) que ya usa "Nuevo cierre" en Cierres.tsx -- al
  // elegir "desde" se autocompleta "hasta" si todavía está vacío, pero queda editable.
  function mondayOf(dateStr: string) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function abrirManual() {
    setManualAbierto(true);
    setManualMsg(null);
    setManualAgentId("");
    setManualClubId("");
    setManualWeekStart("");
    setManualWeekEnd("");
    setManualMonto("");
    setManualNota("");
  }

  async function crearManual() {
    if (!manualAgentId || !manualClubId) return setManualMsg({ ok: false, text: "Elegí agente y club." });
    if (!manualWeekStart || !manualWeekEnd) return setManualMsg({ ok: false, text: "Completá la semana (desde/hasta)." });
    const m = Number(manualMonto);
    if (!m || Math.abs(m) <= 0.004) return setManualMsg({ ok: false, text: "El monto tiene que ser distinto de 0." });
    setManualGuardando(true);
    setManualMsg(null);
    try {
      await api.crearRakebackPendienteManual({
        agentId: manualAgentId,
        clubId: manualClubId,
        weekStart: manualWeekStart,
        weekEnd: manualWeekEnd,
        amount: m,
        notes: manualNota.trim() || undefined,
      });
      setManualAbierto(false);
      refresh();
    } catch (err: any) {
      setManualMsg({ ok: false, text: err.message || "No se pudo cargar el rakeback pendiente." });
    } finally {
      setManualGuardando(false);
    }
  }

  // accion (06/10/2026, reporte real de Leo: pendiente negativo de Mar Bruno/Fénix Suprema --
  // "Pagar" rechazaba el importe porque exige > 0; "en este caso al ser negativo, nosotros
  // recibimos el dinero") -- un pendiente negativo (el agente nos debe) usa "Cobrar" en vez de
  // "Pagar": mismo panel, pero llama a cobrarRakebackPendienteNegativo y no ofrece FICHAS como
  // medio (cobrar en fichas sería sacarle stock al agente, una operación distinta que no se
  // pidió acá -- ver comentario de cobrarPendienteNegativo en repo/rakebackPendiente.ts).
  function abrir(p: any, accionElegida: "pagar" | "cobrar") {
    setAbierto(p.id);
    setAccion(accionElegida);
    setMsg(null);
    setMedio(accionElegida === "cobrar" ? "USDT" : "FICHAS");
    setCustodio("");
    setNota("");
    setMonto(Math.abs(Number(p.amount) - Number(p.consumed)).toFixed(2));
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

  async function cobrar(p: any) {
    const pendiente = Number(p.amount) - Number(p.consumed);
    const m = Number(monto);
    if (!(m > 0)) return setMsg({ ok: false, text: "El importe tiene que ser mayor a 0." });
    if (m > Math.abs(pendiente) + 0.005) return setMsg({ ok: false, text: `No puede superar la deuda pendiente (${usd(Math.abs(pendiente))}).` });
    if (medio === "EFECTIVO" && !custodio.trim()) return setMsg({ ok: false, text: "Un cobro en efectivo requiere custodio (BIT-051/052)." });
    setPagando(true);
    setMsg(null);
    try {
      await api.cobrarRakebackPendienteNegativo({
        pendienteId: p.id,
        amount: m,
        medio: medio as "USDT" | "EFECTIVO" | "ZELLE",
        custodian: medio === "EFECTIVO" ? custodio.trim() : undefined,
        notes: nota.trim() || undefined,
      });
      setAbierto(null);
      refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el cobro." });
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
            <button className="btn secondary small" onClick={() => abrir(p, pendiente < -0.004 ? "cobrar" : "pagar")}>
              {pendiente < -0.004 ? "Cobrar" : "Pagar"}
            </button>
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
                  <label>Medio de {accion === "cobrar" ? "cobro" : "pago"}</label>
                  <select value={medio} onChange={(e) => setMedio(e.target.value as any)}>
                    {accion === "pagar" && <option value="FICHAS">Fichas (mueve el stock físico)</option>}
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
                  <button className="btn" disabled={pagando} onClick={() => (accion === "cobrar" ? cobrar(p) : pagar(p))}>
                    {pagando ? "Registrando..." : accion === "cobrar" ? "Confirmar cobro" : "Confirmar pago"}
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
        <button className="btn secondary" onClick={() => (manualAbierto ? setManualAbierto(false) : abrirManual())}>
          {manualAbierto ? "Cancelar" : "+ Cargar rakeback viejo"}
        </button>
      </div>

      {/* Alta manual de rakeback viejo (06/10/2026, pedido de Leo) -- crea un cierre "fantasma"
          que ancla el pendiente al sistema (ver crearRakebackPendienteManual en
          repo/rakebackPendiente.ts); afecta Saldo anterior/Liquidaciones igual que uno real. */}
      {manualAbierto && (
        <div className="panel" style={{ marginTop: 14, maxWidth: 560 }}>
          <h3 style={{ marginTop: 0 }}>Cargar rakeback pendiente viejo</h3>
          <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
            Para un rakeback de una semana vieja que nunca se cargó en el sistema. Queda igual que un cierre real a
            todos los efectos (Saldo anterior, Liquidaciones) -- no mueve fichas ni genera ningún movimiento de
            tesorería, solo la deuda de rakeback en sí.
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Agente</label>
              <select value={manualAgentId} onChange={(e) => setManualAgentId(e.target.value)}>
                <option value="">Elegir...</option>
                {agentes.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Club</label>
              <select value={manualClubId} onChange={(e) => setManualClubId(e.target.value)}>
                <option value="">Elegir...</option>
                {clubes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Semana desde</label>
              <input
                type="date"
                value={manualWeekStart}
                onChange={(e) => {
                  setManualWeekStart(e.target.value);
                  if (e.target.value && !manualWeekEnd) {
                    const monday = mondayOf(e.target.value);
                    const sunday = new Date(monday);
                    sunday.setDate(sunday.getDate() + 6);
                    setManualWeekEnd(sunday.toISOString().slice(0, 10));
                  }
                }}
              />
            </div>
            <div className="field">
              <label>Semana hasta</label>
              <input type="date" value={manualWeekEnd} onChange={(e) => setManualWeekEnd(e.target.value)} />
            </div>
            <div className="field">
              <label>Monto (USD)</label>
              <input
                type="number"
                step="0.01"
                placeholder="Ej: 903.42 (o -903.42 si el agente queda debiendo)"
                value={manualMonto}
                onChange={(e) => setManualMonto(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Observación (opcional)</label>
              <input value={manualNota} onChange={(e) => setManualNota(e.target.value)} placeholder="De dónde sale este rakeback viejo" />
            </div>
          </div>
          {manualMsg && <div className={manualMsg.ok ? "success" : "error"}>{manualMsg.text}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn" disabled={manualGuardando} onClick={crearManual}>
              {manualGuardando ? "Cargando..." : "Cargar"}
            </button>
            <button className="btn secondary" onClick={() => setManualAbierto(false)}>Cancelar</button>
          </div>
        </div>
      )}

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
          <Loading />
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
