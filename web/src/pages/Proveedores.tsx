import { useEffect, useState } from "react";
import { api } from "../api";
import { cargarLibreriasPdf } from "../pdfLibs";
import { usd, pct, dateShort } from "../fmt";
import Modal from "../components/Modal";
import ActionsMenu from "../components/ActionsMenu";
import Loading from "../components/Loading";

// Sección "Proveedores" (22/09/2026, pedido de Leo) -- entidad separada de Agentes/Clubes,
// a propósito no comparte pantallas ni datos con esas ("no mezclarlo con lo que ya tenemos").
// Caso original: Manzur como "unión" en Fénix GG, que nos entrega el 75% del rake TOTAL del
// club (no un agente al 75% de sus propios jugadores -- eso sigue siendo Cierres/Liquidaciones
// normal, Manzur convive con las dos cuentas al mismo tiempo).

const GARANTIA_TIPO_LABEL: Record<string, string> = {
  ALTA: "Alta",
  AUMENTO: "Aumento",
  REDUCCION: "Reducción",
  CONSUMO: "Consumo",
  BAJA: "Baja",
};

type Tab = "saldos" | "cierres" | "pagos" | "garantias";

export default function Proveedores() {
  const [tab, setTab] = useState<Tab>("cierres");
  const [verRevertidos, setVerRevertidos] = useState(false);
  const [proveedores, setProveedores] = useState<any[] | null>(null);
  const [clubes, setClubes] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [autoCierreClubesTodos, setAutoCierreClubesTodos] = useState<any[]>([]);
  const [saldos, setSaldos] = useState<any[] | null>(null);
  const [cierres, setCierres] = useState<any[] | null>(null);
  const [pagos, setPagos] = useState<any[] | null>(null);
  const [garantias, setGarantias] = useState<any[] | null>(null);
  const [garantiasHistorial, setGarantiasHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  // Solicitudes de retiro/pago de los proveedores (16/10/2026, pedido de Leo: "necesito todo
  // esto mismo para la sección de proveedores") -- siempre visible arriba de todo, no depende
  // de ninguna pestaña (ver repo/proveedores.ts listSolicitudesRetiroPendientesTodasProveedor).
  const [solicitudes, setSolicitudes] = useState<any[] | null>(null);

  const [showNuevoProveedor, setShowNuevoProveedor] = useState(false);
  const [editandoProveedor, setEditandoProveedor] = useState<any | null>(null);
  const [showCierre, setShowCierre] = useState(false);
  const [showPago, setShowPago] = useState(false);
  // Ajuste manual (30/09/2026, pedido de Leo: "necesitamos hacer varios ajuste manuales sobre
  // los proveedores... que esos ajuste los podamos hacer desde aca adentro") -- separado del
  // modal de Pago/Cobro porque es un concepto distinto (una corrección suelta, no el cobro de
  // un cierre puntual) aunque use el mismo endpoint por abajo (origen: "AJUSTE").
  const [showAjuste, setShowAjuste] = useState(false);
  const [showGarantiaAjuste, setShowGarantiaAjuste] = useState<{ proveedorId?: string } | null>(null);
  const [showLiquidacion, setShowLiquidacion] = useState(false);

  function refresh() {
    setError("");
    api.proveedores().then(setProveedores).catch((e) => setError(e.message));
    api.saldosProveedores().then(setSaldos).catch(() => {});
    api.cierresProveedor().then(setCierres).catch(() => {});
    api.pagosProveedor().then(setPagos).catch(() => {});
    api.garantiasProveedores().then(setGarantias).catch(() => {});
    api.garantiasProveedoresHistorial().then(setGarantiasHistorial).catch(() => {});
    api.autoCierreClubesTodos().then(setAutoCierreClubesTodos).catch(() => {});
  }

  function refreshSolicitudes() {
    api.solicitudesRetiroPendientesProveedor().then(setSolicitudes);
  }

  useEffect(() => {
    refresh();
    api.proveedoresClubes().then(setClubes);
    api.agentesProveedores().then(setAgentes);
    refreshSolicitudes();
  }, []);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Proveedores: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!proveedores) return <Loading />;

  // Separado en dos KPIs en vez de un solo neto (22/09/2026, pedido de Leo: "esta mal lo de
  // saldo total a favor del proveedor... ese dinero es para nosotros" -- un total neto puede
  // dar negativo cuando la mayoría de los clubes nos deben a nosotros, y el cartel decía
  // siempre "a favor del proveedor" sin importar el signo real. Con dos números separados no
  // hay ambigüedad posible.
  const totalAFavorProveedor = (saldos ?? []).reduce((s, x) => s + Math.max(Number(x.amount), 0), 0);
  const totalAFavorNuestro = (saldos ?? []).reduce((s, x) => s + Math.max(-Number(x.amount), 0), 0);
  const totalGarantizado = (garantias ?? []).reduce((s, g) => s + Number(g.amount), 0);
  const totalGarantiaPendiente = (garantias ?? []).reduce((s, g) => s + (Number(g.amount) - Number(g.consumed)), 0);

  // Deuda total por proveedor (30/09/2026, pedido de Leo: "necesito que en proveedores
  // aparezca la deuda de manzur") -- deuda operativa (todos sus clubes) + garantía vigente,
  // el mismo TOTAL CONTROLADO que ya calcula el PDF de Liquidación (ver generarLiquidacionPdf
  // más abajo) -- acá se muestra directo en la fila de la tabla, sin tener que armar un PDF.
  function deudaTotalProveedor(proveedorId: string): number {
    const deudaOperativa = -(saldos ?? [])
      .filter((s) => s.proveedor_id === proveedorId)
      .reduce((s, x) => s + Number(x.amount), 0);
    const garantia = (garantias ?? []).find((g) => g.proveedor_id === proveedorId);
    const garantiaVigente = garantia ? Number(garantia.amount) - Number(garantia.consumed) : 0;
    return deudaOperativa + garantiaVigente;
  }

  async function onRevertirCierre(id: string) {
    if (!confirm("¿Revertir este cierre? Solo funciona si no hay pagos/cierres más nuevos encima.")) return;
    try {
      await api.revertirCierreProveedor(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  async function onRevertirPago(id: string) {
    if (!confirm("¿Revertir este pago? Solo funciona si no hay movimientos más nuevos encima.")) return;
    try {
      await api.revertirPagoProveedor(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  async function onRecalcularCierre(id: string) {
    if (!confirm("¿Recalcular este cierre con los datos actuales? Equivale a revertirlo y volver a aplicar las mismas líneas -- solo funciona si no hay pagos/cierres más nuevos encima.")) return;
    try {
      await api.recalcularCierreProveedor(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo recalcular.");
    }
  }

  async function onEliminarCierre(id: string) {
    if (!confirm("¿Eliminar este cierre DEL TODO? No se puede deshacer (a diferencia de \"Revertir\", esto lo saca del historial).")) return;
    try {
      await api.eliminarCierreProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  async function onEliminarPago(id: string) {
    if (!confirm("¿Eliminar este pago DEL TODO? No se puede deshacer.")) return;
    try {
      await api.eliminarPagoProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  async function onEliminarGarantia(id: string) {
    if (!confirm("¿Eliminar esta garantía DEL TODO, junto con su historial? No se puede deshacer.")) return;
    try {
      await api.eliminarGarantiaProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  async function onEliminarProveedor(id: string, nombre: string) {
    if (!confirm(`¿Eliminar a "${nombre}" DEL TODO -- saldos, cierres, pagos y garantías? No se puede deshacer.`)) return;
    try {
      await api.eliminarProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  // ---- Pantalla (19/10/2026, mockup aprobado): cierres y pagos con revertidos ocultos, menú ⋯ por fila ----
  const cierresVisibles = (cierres ?? []).filter((c) => verRevertidos || c.status !== "REVERTIDO");
  const pagosVisibles = (pagos ?? []).filter((p) => verRevertidos || p.status !== "REVERTIDO");
  const medioPagoTxt = (m: string) => ({ SIN_TESORERIA: "Sin tesorería", OTRO: "Otro", USDT: "USDT", EFECTIVO: "Efectivo", ZELLE: "Zelle" } as Record<string, string>)[m] ?? m;
  const itemsPago = (p: any) => [
    ...(p.status !== "REVERTIDO" ? [{ label: "Revertir", onClick: () => onRevertirPago(p.id) }] : []),
    { label: "Eliminar (borrado real)…", onClick: () => onEliminarPago(p.id), danger: true },
  ];

  return (
    <div>
      <div className="topbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2>Proveedores</h2>
          <div className="muted">
            Cuentas separadas de Agentes: alguien nos entrega un % del rake TOTAL de un club (no de sus propios
            jugadores), ej. Manzur en Fénix GG.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {solicitudes && solicitudes.length === 0 && <span className="pill">Sin solicitudes de retiro</span>}
          <button className="btn secondary" onClick={() => setShowPago(true)} disabled={proveedores.length === 0}>+ Pago / cobro</button>
          <button className="btn" onClick={() => setShowCierre(true)} disabled={proveedores.length === 0}>+ Cierre semanal</button>
          <ActionsMenu
            title="Más acciones"
            items={[
              { label: "+ Nuevo proveedor", onClick: () => setShowNuevoProveedor(true) },
              { label: "+ Ajuste manual", onClick: () => setShowAjuste(true), disabled: proveedores.length === 0 },
              { label: "+ Liquidación PDF", onClick: () => setShowLiquidacion(true), disabled: proveedores.length === 0 },
            ]}
          />
        </div>
      </div>

      {solicitudes && solicitudes.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--gold)" }}>
          <h3>Solicitudes de retiro pendientes</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            Lo que piden los proveedores desde "Mi proveedor". Al marcarla como enviada se registra
            el Pago de siempre en el club elegido (misma mecánica que "+ Pago / cobro" de arriba)
            con el link de pago asentado, para que puedan ver el trackeo reflejado en su propia
            pantalla.
          </div>
          <div className="ag-table-wrap" style={{ display: "block", overflowX: "auto" }}>
            <table>
              <thead><tr><th>Proveedor</th><th>Monto solicitado</th><th>Nota</th><th>Fecha</th><th></th></tr></thead>
              <tbody>
                {solicitudes.map((s) => (
                  <SolicitudRetiroProveedorRow
                    key={s.id}
                    solicitud={s}
                    clubes={clubes}
                    onDone={() => {
                      refreshSolicitudes();
                      refresh();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat-card">
          <div className="l">Nos deben</div>
          <div className="v">{usd(totalAFavorNuestro)}</div>
          <div className="s">saldos a favor nuestro</div>
        </div>
        <div className="stat-card">
          <div className="l">Les debemos</div>
          <div className="v">{usd(totalAFavorProveedor)}</div>
          <div className="s">saldos a favor de proveedores</div>
        </div>
        <div className="stat-card">
          <div className="l">Proveedores activos</div>
          <div className="v">{proveedores.length}</div>
          <div className="s">con auto-cierre en {autoCierreClubesTodos.length} club{autoCierreClubesTodos.length === 1 ? "" : "es"}</div>
        </div>
      </div>

      <div className="pv-grid">
        {proveedores.map((p) => {
          const deuda = deudaTotalProveedor(p.id);
          const saldosDelProv = (saldos ?? []).filter((s) => s.proveedor_id === p.id);
          const autos = autoCierreClubesTodos.filter((c) => c.proveedorId === p.id);
          return (
            <div key={p.id} className="panel" style={{ margin: 0, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 750, letterSpacing: "-0.01em" }}>{p.name}</div>
                  <div className="saldo-sub" style={{ marginTop: 2 }} title={p.notes || undefined}>
                    {p.notes ? `${p.notes} · ` : ""}
                    {saldosDelProv.length > 0 ? `${saldosDelProv.length} club${saldosDelProv.length === 1 ? "" : "es"} con saldo` : "sin movimientos todavía"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ textAlign: "right" }} title="Deuda operativa (todos sus clubes) + garantía vigente">
                    <div className="saldo-big" style={{ fontSize: 20, color: deuda > 0.004 ? "var(--amber)" : deuda < -0.004 ? "var(--red)" : "var(--text-dim)" }}>
                      {usd(Math.abs(deuda))}
                    </div>
                    <div className="saldo-sub">{deuda > 0.004 ? "nos debe" : deuda < -0.004 ? "le debemos" : "al día"}</div>
                  </div>
                  <ActionsMenu
                    items={[
                      { label: "Editar", onClick: () => setEditandoProveedor(p) },
                      { label: "Eliminar…", onClick: () => onEliminarProveedor(p.id, p.name), danger: true },
                    ]}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0", alignItems: "center" }}>
                <span className="saldo-sub" style={{ margin: "0 4px 0 0" }}>Auto-cierre</span>
                {autos.length === 0 ? (
                  <span className="muted" style={{ fontSize: 12 }}>sin auto-cierre</span>
                ) : (
                  autos.map((c) => <span key={c.id} className="pill gold">{c.clubName} · {pct(c.rakebackPct)}</span>)
                )}
              </div>
              {saldosDelProv.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {saldosDelProv.map((s) => <ClubSaldoRow key={s.id} saldo={s} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, margin: "10px 0 16px" }}>
        Positivo = a favor del proveedor (le debemos). Negativo = a favor nuestro (nos debe). Los saldos se actualizan solos con cada
        cierre semanal y cada pago/cobro -- nunca se editan a mano. Tocá un club para ver los movimientos que arman ese saldo.
      </div>

      <div className="panel">
        <div className="ag-toolbar" style={{ marginBottom: 12 }}>
          <span className="seg">
            <button className={tab === "cierres" ? "on" : ""} onClick={() => setTab("cierres")}>Cierres<span className="n">{cierres?.length ?? 0}</span></button>
            <button className={tab === "pagos" ? "on" : ""} onClick={() => setTab("pagos")}>Pagos / cobros<span className="n">{pagos?.length ?? 0}</span></button>
            <button className={tab === "garantias" ? "on" : ""} onClick={() => setTab("garantias")}>Garantías<span className="n">{garantias?.length ?? 0}</span></button>
          </span>
          <span className="ag-toolbar-spacer" />
          {(tab === "cierres" || tab === "pagos") && (
            <label className="switch">
              <input type="checkbox" checked={verRevertidos} onChange={(e) => setVerRevertidos(e.target.checked)} />
              <i />
              Mostrar revertidos
            </label>
          )}
        </div>

        {tab === "cierres" && (
          <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Un cierre puede tener varias líneas (club y/o agente) -- tocá una fila para ver el detalle.
            </div>
            {!cierres ? (
              <Loading />
            ) : cierres.length === 0 ? (
              <div className="muted">Todavía no hay cierres cargados.</div>
            ) : (
              <>
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr><th>Semana</th><th>Estado</th><th className="num">Cierre</th><th className="num">Saldo resultante</th><th></th></tr>
                    </thead>
                    <tbody>
                      {cierresVisibles.map((c) => (
                        <CierreRow key={c.id} cierre={c} onRevertir={onRevertirCierre} onRecalcular={onRecalcularCierre} onEliminar={onEliminarCierre} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ag-cards">
                  {cierresVisibles.map((c) => (
                    <CierreCard key={c.id} cierre={c} onRevertir={onRevertirCierre} onRecalcular={onRecalcularCierre} onEliminar={onEliminarCierre} />
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                  Mostrando {cierresVisibles.length} de {cierres.length}
                  {!verRevertidos && cierres.length > cierresVisibles.length ? ` · ${cierres.length - cierresVisibles.length} revertido${cierres.length - cierresVisibles.length === 1 ? "" : "s"} oculto${cierres.length - cierresVisibles.length === 1 ? "" : "s"}` : ""}.
                </div>
              </>
            )}
          </>
        )}

        {tab === "pagos" && (
          <>
            {!pagos ? (
              <Loading />
            ) : pagos.length === 0 ? (
              <div className="muted">Todavía no hay pagos/cobros cargados.</div>
            ) : (
              <>
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr><th>Fecha</th><th>Proveedor · club</th><th>Tipo</th><th>Medio</th><th className="num">Monto</th><th className="num">Saldo resultante</th><th>Link</th><th></th></tr>
                    </thead>
                    <tbody>
                      {pagosVisibles.map((p) => (
                        <tr key={p.id} style={p.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                          <td className="muted">{dateShort(p.occurred_at)}</td>
                          <td>
                            <div className="saldo-name">{p.club_name}</div>
                            <div className="saldo-sub">{p.proveedor_name}</div>
                          </td>
                          <td>
                            <span className={`pill ${p.direction === "PAGO" ? "a" : "g"}`}>{p.direction === "PAGO" ? "Pago · le dimos" : "Cobro · nos dio"}</span>
                            {p.status === "REVERTIDO" && <span className="pill r" style={{ marginLeft: 6 }}>Revertido</span>}
                          </td>
                          <td className="muted">{medioPagoTxt(p.medio)}</td>
                          <td className="num"><span className={`saldo-big ${p.direction === "COBRO" ? "pos" : "neg"}`}>{p.direction === "COBRO" ? "+" : "−"}{usd(p.amount)}</span></td>
                          <td className="num money">{usd(p.saldo_nuevo)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {p.payment_link ? <a className="link-pago" href={p.payment_link} target="_blank" rel="noreferrer">Ver pago ↗</a> : "—"}
                          </td>
                          <td style={{ width: 60, textAlign: "right" }}><ActionsMenu items={itemsPago(p)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ag-cards">
                  {pagosVisibles.map((p) => (
                    <div key={p.id} className={`saldo-card ${p.direction === "COBRO" ? "is-pos" : "is-neg"}`} style={p.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                      <div className="saldo-card-body">
                        <div className="saldo-card-top">
                          <div className="saldo-name">{p.club_name}</div>
                          <div className={`saldo-big ${p.direction === "COBRO" ? "pos" : "neg"}`}>{p.direction === "COBRO" ? "+" : "−"}{usd(p.amount)}</div>
                        </div>
                        <div className="saldo-card-mid">
                          <div className="saldo-sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span className={`pill ${p.direction === "PAGO" ? "a" : "g"}`}>{p.direction === "PAGO" ? "Pago · le dimos" : "Cobro · nos dio"}</span>
                            {p.status === "REVERTIDO" && <span className="pill r">Revertido</span>}
                            {medioPagoTxt(p.medio)} · {dateShort(p.occurred_at)}
                          </div>
                          <ActionsMenu items={itemsPago(p)} />
                        </div>
                        <div className="saldo-card-foot">
                          <span>{p.proveedor_name} · saldo resultante <b>{usd(p.saldo_nuevo)}</b></span>
                          {p.payment_link && <a className="link-pago" href={p.payment_link} target="_blank" rel="noreferrer">Ver pago ↗</a>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                  Mostrando {pagosVisibles.length} de {pagos.length}
                  {!verRevertidos && pagos.length > pagosVisibles.length ? ` · ${pagos.length - pagosVisibles.length} revertido${pagos.length - pagosVisibles.length === 1 ? "" : "s"} oculto${pagos.length - pagosVisibles.length === 1 ? "" : "s"}` : ""}.
                </div>
              </>
            )}
          </>
        )}

        {tab === "garantias" && (
          <>
            <div className="stat-row">
              <div className="stat-card">
                <div className="l">Garantizado</div>
                <div className="v">{usd(totalGarantizado)}</div>
              </div>
              <div className="stat-card">
                <div className="l">Garantía pendiente</div>
                <div className="v">{usd(totalGarantiaPendiente)}</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Garantías activas</h3>
              <button className="btn secondary small" onClick={() => setShowGarantiaAjuste({})}>+ Ajustar garantía</button>
            </div>
            {!garantias ? (
              <Loading />
            ) : garantias.length === 0 ? (
              <div className="muted">Todavía no hay garantías activas.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Proveedor</th><th>Garantizado</th><th>Consumido</th><th>Pendiente</th><th>Notas</th><th></th></tr></thead>
                  <tbody>
                    {garantias.map((g) => (
                      <tr key={g.id}>
                        <td>{g.proveedor_name}</td>
                        <td>{usd(g.amount)}</td>
                        <td>{usd(g.consumed)}</td>
                        <td><span className="badge neutral">{usd(Number(g.amount) - Number(g.consumed))}</span></td>
                        <td className="muted" style={{ fontSize: 12 }} title={g.notes || undefined}>{g.notes || "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn secondary small" onClick={() => setShowGarantiaAjuste({ proveedorId: g.proveedor_id })}>Ajustar</button>{" "}
                          <button className="btn danger small" onClick={() => onEliminarGarantia(g.id)}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h3 style={{ margin: "18px 0 8px" }}>Historial de garantías</h3>
            {!garantiasHistorial ? (
              <Loading />
            ) : garantiasHistorial.length === 0 ? (
              <div className="muted">Todavía no hay movimientos.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr><th>Fecha</th><th>Proveedor</th><th>Tipo</th><th>Monto</th><th>Resultante</th><th>Consumido</th><th>Notas</th></tr></thead>
                  <tbody>
                    {garantiasHistorial.map((m) => (
                      <tr key={m.id}>
                        <td>{dateShort(m.occurred_at)}</td>
                        <td>{m.proveedor_name}</td>
                        <td><span className="badge neutral">{GARANTIA_TIPO_LABEL[m.type] ?? m.type}</span></td>
                        <td>{m.type === "BAJA" ? "—" : usd(m.amount)}</td>
                        <td>{usd(m.resulting_amount)}</td>
                        <td>{usd(m.resulting_consumed)}</td>
                        <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {showNuevoProveedor && (
        <Modal title="Nuevo proveedor" onClose={() => setShowNuevoProveedor(false)}>
          <NuevoProveedorForm clubes={clubes} onDone={() => { setShowNuevoProveedor(false); refresh(); }} />
        </Modal>
      )}
      {editandoProveedor && (
        <Modal title={`Editar ${editandoProveedor.name}`} onClose={() => setEditandoProveedor(null)}>
          <NuevoProveedorForm
            proveedor={editandoProveedor}
            clubes={clubes}
            onDone={() => { setEditandoProveedor(null); refresh(); }}
          />
        </Modal>
      )}
      {showCierre && (
        <Modal title="Cierre semanal de proveedor" onClose={() => setShowCierre(false)}>
          <CierreForm
            proveedores={proveedores}
            clubes={clubes}
            agentes={agentes}
            onDone={() => { setShowCierre(false); refresh(); }}
          />
        </Modal>
      )}
      {showPago && (
        <Modal title="Pago / cobro a proveedor" onClose={() => setShowPago(false)}>
          <PagoForm
            proveedores={proveedores}
            clubes={clubes}
            onDone={() => { setShowPago(false); refresh(); }}
          />
        </Modal>
      )}
      {showAjuste && (
        <Modal title="Ajuste manual de proveedor" onClose={() => setShowAjuste(false)}>
          <AjusteForm
            proveedores={proveedores}
            clubes={clubes}
            onDone={() => { setShowAjuste(false); refresh(); }}
          />
        </Modal>
      )}
      {showGarantiaAjuste && (
        <Modal title="Ajustar garantía de proveedor" onClose={() => setShowGarantiaAjuste(null)}>
          <GarantiaAjusteForm
            proveedores={proveedores}
            garantias={garantias ?? []}
            preselectProveedorId={showGarantiaAjuste.proveedorId}
            onDone={() => { setShowGarantiaAjuste(null); refresh(); }}
          />
        </Modal>
      )}
      {showLiquidacion && (
        <Modal title="Liquidación PDF de proveedor" onClose={() => setShowLiquidacion(false)}>
          <LiquidacionProveedorForm
            proveedores={proveedores}
            saldos={saldos ?? []}
            garantias={garantias ?? []}
            onDone={() => setShowLiquidacion(false)}
          />
        </Modal>
      )}
    </div>
  );
}

// Fila de club dentro de la tarjeta de un proveedor (22/09/2026, pedido de Leo: "en algun lado
// tendria que tener el saldo que van sumando y restando, porque asi queda muy mezclado") -- al
// tocarla, trae el historial de movimientos (cierres de club/agente + pagos/cobros) de ESE
// proveedor+club puntual, con el saldo antes/después de cada uno, para ver de dónde sale el número.
function ClubSaldoRow({ saldo }: { saldo: any }) {
  const [abierto, setAbierto] = useState(false);
  const [movimientos, setMovimientos] = useState<any[] | null>(null);

  function toggle() {
    const next = !abierto;
    setAbierto(next);
    if (next && !movimientos) {
      api.movimientosSaldoProveedor(saldo.proveedor_id, saldo.club_id).then(setMovimientos).catch(() => setMovimientos([]));
    }
  }

  const monto = Number(saldo.amount);
  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <div onClick={toggle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 2px", cursor: "pointer" }}>
        <div>
          <div className="saldo-name" style={{ fontWeight: 600 }}>{saldo.club_name}</div>
          <div className="saldo-sub">actualizado {dateShort(saldo.updated_at)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`saldo-big ${monto > 0 ? "pos" : monto < 0 ? "neg" : "neutral"}`}>{monto < 0 ? "−" : ""}{usd(Math.abs(monto))}</span>
          <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{abierto ? "▴" : "▾"}</span>
        </div>
      </div>
      {abierto && (
        <div style={{ background: "rgba(255,255,255,0.02)", padding: 6, overflowX: "auto" }}>
          {!movimientos ? (
            <div className="muted" style={{ fontSize: 12, padding: 8 }}>Cargando movimientos...</div>
          ) : movimientos.length === 0 ? (
            <div className="muted" style={{ fontSize: 12, padding: 8 }}>Sin movimientos registrados para este club.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th><th>Movimiento</th><th>Delta</th><th>Saldo antes</th><th>Saldo después</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} style={m.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                    <td className="muted">{dateShort(m.fecha)}</td>
                    <td>{m.label}</td>
                    <td>
                      <span className={`badge ${m.delta > 0 ? "pos" : m.delta < 0 ? "neg" : "neutral"}`}>{usd(m.delta)}</span>
                    </td>
                    <td className="muted">{usd(m.saldoAnterior)}</td>
                    <td className="muted">{usd(m.saldoNuevo)}</td>
                    <td className="muted">{m.status === "REVERTIDO" ? "Revertido" : "Aplicado"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function EstadoCierre({ status }: { status: string }) {
  return status === "REVERTIDO" ? <span className="pill r">Revertido</span> : <span className="pill g">Aplicado</span>;
}

function LineasCierre({ lineas }: { lineas: any[] | null }) {
  if (!lineas) return <div className="muted" style={{ fontSize: 12, padding: 8 }}>Cargando líneas...</div>;
  if (lineas.length === 0) return <div className="muted" style={{ fontSize: 12, padding: 8 }}>Sin líneas registradas (cierre del formato anterior).</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ margin: "4px 0" }}>
        <thead>
          <tr>
            <th>Tipo</th><th>Club</th><th>Agente</th><th>Resultado</th><th>Rake</th><th>%</th>
            <th>Rebate club</th><th>Rodeo</th><th>Monto bruto</th><th>Aplicado al saldo</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => {
            // Las líneas tipo AGENTE no guardan su propio resultado/rake/rakeback/rodeo
            // (solo el weekly_closing_id de referencia) -- listLineasCierreProveedor
            // trae ese desglose con un LEFT JOIN a weekly_closings (wc_*), se muestra
            // tal cual quedó aplicado en Cierres semanales, nunca se recalcula acá.
            const esAgente = l.tipo === "AGENTE";
            const resultado = esAgente ? l.wc_result : l.resultado_total;
            const rakeTotal = esAgente ? l.wc_rake_total : l.rake_total;
            const rodeo = esAgente ? l.wc_rodeo : l.impacto_rodeo;
            return (
              <tr key={l.id}>
                <td>{l.tipo === "CLUB" ? "Club total" : "Agente"}</td>
                <td>{l.club_name}</td>
                <td>{l.agent_name ?? "—"}</td>
                <td>{resultado !== null && resultado !== undefined ? usd(resultado) : "—"}</td>
                <td>{rakeTotal !== null && rakeTotal !== undefined ? usd(rakeTotal) : "—"}</td>
                <td>{(esAgente ? l.wc_rakeback_pct : l.rakeback_pct) !== null && (esAgente ? l.wc_rakeback_pct : l.rakeback_pct) !== undefined ? pct(esAgente ? l.wc_rakeback_pct : l.rakeback_pct) : "—"}</td>
                <td>{l.club_rebate !== null ? usd(l.club_rebate) : "—"}</td>
                <td>{rodeo !== null && rodeo !== undefined ? usd(rodeo) : "—"}</td>
                <td>{usd(l.monto_crudo)}</td>
                <td><b>{usd(l.monto_aplicado)}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type CierreProps = {
  cierre: any;
  onRevertir: (id: string) => void;
  onRecalcular: (id: string) => void;
  onEliminar: (id: string) => void;
};

function itemsCierreProveedor({ cierre, onRevertir, onRecalcular, onEliminar }: CierreProps) {
  return [
    ...(cierre.status !== "REVERTIDO"
      ? [
          { label: "Recalcular", onClick: () => onRecalcular(cierre.id) },
          { label: "Revertir", onClick: () => onRevertir(cierre.id) },
        ]
      : []),
    { label: "Eliminar (borrado real)…", onClick: () => onEliminar(cierre.id), danger: true },
  ];
}

function useLineasCierre(cierreId: string) {
  const [abierto, setAbierto] = useState(false);
  const [lineas, setLineas] = useState<any[] | null>(null);
  function toggle() {
    const next = !abierto;
    setAbierto(next);
    if (next && !lineas) {
      api.lineasCierreProveedor(cierreId).then(setLineas).catch(() => setLineas([]));
    }
  }
  return { abierto, lineas, toggle };
}

function CierreRow(props: CierreProps) {
  const { cierre } = props;
  const { abierto, lineas, toggle } = useLineasCierre(cierre.id);
  const monto = Number(cierre.cierre);
  return (
    <>
      <tr style={{ cursor: "pointer", ...(cierre.status === "REVERTIDO" ? { opacity: 0.55 } : {}) }} onClick={toggle}>
        <td>
          <div className="saldo-name">{dateShort(cierre.week_start)} - {dateShort(cierre.week_end)}</div>
          <div className="saldo-sub">{cierre.proveedor_name}{cierre.notes ? ` · ${cierre.notes}` : ""}</div>
        </td>
        <td><EstadoCierre status={cierre.status} /></td>
        <td className="num"><span className={`saldo-big ${monto > 0 ? "pos" : monto < 0 ? "neg" : "neutral"}`}>{monto < 0 ? "−" : ""}{usd(Math.abs(monto))}</span></td>
        <td className="num money">{usd(cierre.saldo_nuevo)}</td>
        <td style={{ width: 60, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
          <ActionsMenu items={itemsCierreProveedor(props)} />
        </td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={5} style={{ background: "rgba(255,255,255,0.02)" }}>
            <LineasCierre lineas={lineas} />
          </td>
        </tr>
      )}
    </>
  );
}

function CierreCard(props: CierreProps) {
  const { cierre } = props;
  const { abierto, lineas, toggle } = useLineasCierre(cierre.id);
  const monto = Number(cierre.cierre);
  return (
    <div className={`saldo-card ${monto > 0 ? "is-pos" : monto < 0 ? "is-neg" : ""}`} style={cierre.status === "REVERTIDO" ? { opacity: 0.55 } : undefined} onClick={toggle}>
      <div className="saldo-card-body">
        <div className="saldo-card-top">
          <div className="saldo-name">{dateShort(cierre.week_start)} - {dateShort(cierre.week_end)}</div>
          <div className={`saldo-big ${monto > 0 ? "pos" : monto < 0 ? "neg" : "neutral"}`}>{monto < 0 ? "−" : ""}{usd(Math.abs(monto))}</div>
        </div>
        <div className="saldo-card-mid">
          <div className="saldo-sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>{cierre.proveedor_name} <EstadoCierre status={cierre.status} /></div>
          <div onClick={(e) => e.stopPropagation()}><ActionsMenu items={itemsCierreProveedor(props)} /></div>
        </div>
        <div className="saldo-card-foot">
          <span>Saldo antes <b>{usd(cierre.saldo_anterior)}</b></span>
          <span>Saldo después <b>{usd(cierre.saldo_nuevo)}</b></span>
        </div>
        {abierto && <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}><LineasCierre lineas={lineas} /></div>}
      </div>
    </div>
  );
}

// Sirve para crear Y para editar (pasando `proveedor`). El auto-cierre (qué clubes cierran
// solos cuando se guarda "Resumen por club") vive en una tabla aparte con N clubes por
// proveedor (22/09/2026, caso Manzur: M CHOCO Y Fénix GG a la vez, no uno solo) -- se edita
// con AutoCierreClubesEditor más abajo, y solo cuando el proveedor ya existe (necesita su id).
function NuevoProveedorForm({
  proveedor,
  clubes,
  onDone,
}: {
  proveedor?: any;
  clubes: any[];
  onDone: () => void;
}) {
  const [name, setName] = useState(proveedor?.name ?? "");
  const [notes, setNotes] = useState(proveedor?.notes ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    setLoading(true);
    const payload = { name: name.trim(), notes: notes.trim() || undefined };
    try {
      if (proveedor) {
        await api.actualizarProveedor(proveedor.id, payload);
      } else {
        await api.crearProveedor(payload);
      }
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el proveedor." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Manzur (unión Fénix GG)" />
        </div>
        <div className="field">
          <label>Notas (opcional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Descripción de la relación, referencia, etc." />
        </div>
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading}>{loading ? "Guardando..." : proveedor ? "Guardar cambios" : "Crear"}</button>
      </form>
      {proveedor && <AutoCierreClubesEditor proveedorId={proveedor.id} clubes={clubes} />}
      {!proveedor && (
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Después de crear el proveedor podés volver a "Editar" para configurar los clubes de auto-cierre.
        </div>
      )}
    </>
  );
}

// Lista de clubes configurados para auto-cierre de este proveedor, con alta y baja (22/09/2026,
// pedido de Leo: "que se haga automaticamente en proveedores, asi no tenemos que cargar de
// nuevo todo" -- ahora soporta cualquier cantidad de clubes por proveedor, no solo uno. Cada
// vez que se guarda el resumen semanal de uno de estos clubes en "Resumen por club", se aplica
// (o se agrega, si el proveedor ya tiene cierre esa semana por otro club) solo el cierre de
// este proveedor para ese club, sin tener que volver acá.
function AutoCierreClubesEditor({ proveedorId, clubes }: { proveedorId: string; clubes: any[] }) {
  const [configs, setConfigs] = useState<any[] | null>(null);
  const [clubId, setClubId] = useState("");
  const [rakebackPct, setRakebackPct] = useState("75");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function refresh() {
    api.autoCierreClubesProveedor(proveedorId).then(setConfigs).catch(() => setConfigs([]));
  }
  useEffect(refresh, [proveedorId]);

  async function onAgregar() {
    setMsg(null);
    if (!clubId) return setMsg({ ok: false, text: "Elegí un club." });
    if (!(Number(rakebackPct) > 0)) return setMsg({ ok: false, text: "El % de rakeback tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.agregarAutoCierreClub(proveedorId, { clubId, rakebackPct: Number(rakebackPct) / 100 });
      setClubId("");
      setRakebackPct("75");
      refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo agregar el club." });
    } finally {
      setLoading(false);
    }
  }

  async function onQuitar(configId: string) {
    if (!confirm("¿Quitar este club del auto-cierre? El cierre semanal de este club para este proveedor va a pasar a cargarse a mano.")) return;
    try {
      await api.eliminarAutoCierreClub(configId);
      refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo quitar." });
    }
  }

  const clubesDisponibles = clubes.filter((c) => !(configs ?? []).some((cfg) => cfg.clubId === c.id));

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
      <label style={{ fontWeight: 600, fontSize: 13 }}>Clubes de auto-cierre</label>
      <div className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
        Cada club de esta lista cierra solo (con el % fijo indicado) cada vez que se guarda el resumen semanal de ese
        club en "Resumen por club" -- sin tener que volver a esta pantalla.
      </div>
      {configs === null ? (
        <Loading />
      ) : configs.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Sin clubes configurados -- este proveedor se cierra a mano.</div>
      ) : (
        <table style={{ marginBottom: 10 }}>
          <thead><tr><th>Club</th><th>% rakeback</th><th></th></tr></thead>
          <tbody>
            {configs.map((cfg) => (
              <tr key={cfg.id}>
                <td>{cfg.clubName}</td>
                <td>{pct(cfg.rakebackPct)}</td>
                <td><button type="button" className="btn danger small" onClick={() => onQuitar(cfg.id)}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="form-grid">
        <div className="field">
          <label>Agregar club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Elegir club...</option>
            {clubesDisponibles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>% rakeback fijo</label>
          <input value={rakebackPct} onChange={(e) => setRakebackPct(e.target.value)} type="number" step="0.01" />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button type="button" className="btn secondary small" disabled={loading} onClick={onAgregar}>
        {loading ? "Agregando..." : "+ Agregar club"}
      </button>
    </div>
  );
}

// Un cierre de proveedor cubre UNA semana y puede tener varias líneas (22/09/2026, pedido de
// Leo, caso Manzur: línea CLUB para Fénix GG donde es "la unión" + línea AGENTE para M CHOCO
// en Fénix Suprema, que ya tiene su cierre normal en Cierres semanales). Línea CLUB: el total
// del club (nunca se re-tipea, sale de "Resumen por club"), se guarda invertido -- esa
// inversión es exclusiva de acá. Línea AGENTE: el cierre YA APLICADO de un agente puntual en
// Cierres semanales, tal cual, sin invertir.
type LineaTipo = "CLUB" | "AGENTE";
interface LineaState {
  key: number;
  tipo: LineaTipo;
  clubId: string;
  rakebackPct: string; // solo CLUB
  agentId: string; // solo AGENTE
}

let lineaKeySeq = 1;
function nuevaLinea(): LineaState {
  return { key: lineaKeySeq++, tipo: "CLUB", clubId: "", rakebackPct: "75", agentId: "" };
}

function LineaClubEditor({
  linea,
  clubes,
  weekStart,
  onChange,
  onRemove,
  soloUna,
}: {
  linea: LineaState;
  clubes: any[];
  weekStart: string;
  onChange: (l: LineaState) => void;
  onRemove: () => void;
  soloUna: boolean;
}) {
  const [preview, setPreview] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (linea.tipo !== "CLUB" || !linea.clubId || !weekStart) return;
    const pctNum = (Number(linea.rakebackPct) || 0) / 100;
    setCargando(true);
    api
      .cierreClubPreview(linea.clubId, weekStart, pctNum)
      .then(setPreview)
      .catch((err) => setError(err.message || "No se pudo calcular el preview."))
      .finally(() => setCargando(false));
  }, [linea.tipo, linea.clubId, linea.rakebackPct, weekStart]);

  const resumen = preview?.resumen ?? null;

  return (
    <div className="panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: 10 }}>
      <div className="form-grid">
        <div className="field">
          <label>Club</label>
          <select value={linea.clubId} onChange={(e) => onChange({ ...linea, clubId: e.target.value })}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>% rakeback sobre el rake total del club</label>
          <input value={linea.rakebackPct} onChange={(e) => onChange({ ...linea, rakebackPct: e.target.value })} type="number" step="0.01" />
        </div>
      </div>
      {cargando && <div className="muted" style={{ fontSize: 12 }}>Calculando...</div>}
      {error && <div className="error" style={{ fontSize: 12 }}>{error}</div>}
      {preview && resumen && !error && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Resultado: {usd(resumen.resultadoTotal)} (de {resumen.agentesConCierre} agente{Number(resumen.agentesConCierre) === 1 ? "" : "s"}) · Rake:{" "}
          {usd(resumen.rakeTotal)} · Participación rake: {usd(preview.participacionRake)}
          {Number(preview.clubRebate) !== 0 && <> · Rebate del club: {usd(preview.clubRebate)}</>}
          {Number(preview.impactoRodeo) !== 0 && <> · Rodeo: {usd(preview.impactoRodeo)}</>}
          {" "}· Cierre bruto = {usd(preview.montoCrudo)} · Se guarda invertido: <b>{usd(preview.montoAplicado)}</b>
        </div>
      )}
      {!soloUna && (
        <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={onRemove}>Quitar línea</button>
      )}
    </div>
  );
}

function LineaAgenteEditor({
  linea,
  clubes,
  agentes,
  weekStart,
  onChange,
  onRemove,
  soloUna,
}: {
  linea: LineaState;
  clubes: any[];
  agentes: any[];
  weekStart: string;
  onChange: (l: LineaState) => void;
  onRemove: () => void;
  soloUna: boolean;
}) {
  const [preview, setPreview] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState(false);

  useEffect(() => {
    setPreview(null);
    setNoEncontrado(false);
    if (linea.tipo !== "AGENTE" || !linea.clubId || !linea.agentId || !weekStart) return;
    setCargando(true);
    api
      .cierreAgentePreview(linea.agentId, linea.clubId, weekStart)
      .then((r) => {
        if (!r) setNoEncontrado(true);
        setPreview(r);
      })
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  }, [linea.tipo, linea.clubId, linea.agentId, weekStart]);

  return (
    <div className="panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: 10 }}>
      <div className="form-grid">
        <div className="field">
          <label>Club</label>
          <select value={linea.clubId} onChange={(e) => onChange({ ...linea, clubId: e.target.value })}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Agente</label>
          <select value={linea.agentId} onChange={(e) => onChange({ ...linea, agentId: e.target.value })}>
            <option value="">Elegir...</option>
            {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      {cargando && <div className="muted" style={{ fontSize: 12 }}>Buscando el cierre del agente...</div>}
      {noEncontrado && !cargando && linea.clubId && linea.agentId && (
        <div className="error" style={{ fontSize: 12 }}>
          Este agente no tiene un cierre aplicado en ese club para esa semana -- cargalo primero en "Cierres semanales".
        </div>
      )}
      {preview && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Cierre de {preview.agent_name} en {preview.club_name}: <b>{usd(preview.final_closing)}</b> -- se agrega tal cual (sin invertir).
        </div>
      )}
      {!soloUna && (
        <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={onRemove}>Quitar línea</button>
      )}
    </div>
  );
}

function CierreForm({
  proveedores,
  clubes,
  agentes,
  onDone,
}: {
  proveedores: any[];
  clubes: any[];
  agentes: any[];
  onDone: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [notes, setNotes] = useState("");
  const [lineas, setLineas] = useState<LineaState[]>([nuevaLinea()]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function actualizarLinea(idx: number, l: LineaState) {
    setLineas((prev) => prev.map((x, i) => (i === idx ? l : x)));
  }
  function quitarLinea(idx: number) {
    setLineas((prev) => prev.filter((_, i) => i !== idx));
  }
  function agregarLinea() {
    setLineas((prev) => [...prev, nuevaLinea()]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId) return setMsg({ ok: false, text: "Elegí un proveedor." });
    if (!weekStart) return setMsg({ ok: false, text: "Elegí la semana." });
    for (const l of lineas) {
      if (!l.clubId) return setMsg({ ok: false, text: "Todas las líneas necesitan un club." });
      if (l.tipo === "CLUB" && !(Number(l.rakebackPct) >= 0)) {
        return setMsg({ ok: false, text: "El % de rakeback de cada línea de club tiene que ser un número." });
      }
      if (l.tipo === "AGENTE" && !l.agentId) {
        return setMsg({ ok: false, text: "Todas las líneas de agente necesitan un agente." });
      }
    }
    setLoading(true);
    try {
      await api.aplicarCierreProveedor({
        proveedorId,
        weekStart,
        lineas: lineas.map((l) =>
          l.tipo === "CLUB"
            ? { tipo: "CLUB" as const, clubId: l.clubId, rakebackPct: (Number(l.rakebackPct) || 0) / 100 }
            : { tipo: "AGENTE" as const, clubId: l.clubId, agentId: l.agentId }
        ),
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el cierre." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Semana (lunes de inicio)</label>
          <input value={weekStart} onChange={(e) => setWeekStart(e.target.value)} type="date" />
        </div>
      </div>

      <div style={{ marginTop: 10, marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Líneas del cierre</div>
      {lineas.map((l, idx) => (
        <div key={l.key}>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Tipo de línea</label>
            <select value={l.tipo} onChange={(e) => actualizarLinea(idx, { ...l, tipo: e.target.value as LineaTipo })}>
              <option value="CLUB">Club total (ej. "es la unión")</option>
              <option value="AGENTE">Cierre de un agente puntual</option>
            </select>
          </div>
          {l.tipo === "CLUB" ? (
            <LineaClubEditor
              linea={l}
              clubes={clubes}
              weekStart={weekStart}
              onChange={(nl) => actualizarLinea(idx, nl)}
              onRemove={() => quitarLinea(idx)}
              soloUna={lineas.length === 1}
            />
          ) : (
            <LineaAgenteEditor
              linea={l}
              clubes={clubes}
              agentes={agentes}
              weekStart={weekStart}
              onChange={(nl) => actualizarLinea(idx, nl)}
              onRemove={() => quitarLinea(idx)}
              soloUna={lineas.length === 1}
            />
          )}
        </div>
      ))}
      <button type="button" className="btn secondary small" onClick={agregarLinea} style={{ marginBottom: 10 }}>
        + Agregar línea
      </button>

      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, etc." />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Aplicando..." : "Aplicar cierre"}</button>
    </form>
  );
}

// Pago/Cobro (30/09/2026, rediseñado a pedido de Leo: "en pago/cobro deberiamos poder elegir
// varios clubes y elegir el cierre el cual pago"). Dos modos:
//  - "Por línea" (default): elegís proveedor, se listan TODAS sus líneas de cierre con saldo
//    pendiente (de cualquier club/semana, ver listLineasPendientesProveedor), tildás las que
//    estás pagando/cobrando ahora -- pueden ser de clubes y semanas distintas -- y un solo
//    envío registra un pago por cada línea tildada, cada uno atado a su línea (así queda el
//    rastro de qué línea puntual ya se saldó).
//  - "Suelto" (comportamiento de siempre): un pago directo contra el saldo total de un
//    proveedor+club, sin atarlo a ninguna línea -- para casos sin una línea que matchee (o
//    cierres viejos, de antes de este cambio, que no tienen nada que trackear todavía).
function PagoForm({ proveedores, clubes, onDone }: { proveedores: any[]; clubes: any[]; onDone: () => void }) {
  const [modo, setModo] = useState<"lineas" | "suelto">("lineas");
  const [proveedorId, setProveedorId] = useState("");
  const [medio, setMedio] = useState<"USDT" | "EFECTIVO" | "ZELLE" | "OTRO">("USDT");
  const [custodio, setCustodio] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Modo "Por línea"
  const [lineas, setLineas] = useState<any[] | null>(null);
  const [seleccion, setSeleccion] = useState<Record<string, { checked: boolean; monto: string }>>({});

  useEffect(() => {
    setLineas(null);
    setSeleccion({});
    if (!proveedorId || modo !== "lineas") return;
    api.lineasPendientesProveedor(proveedorId).then(setLineas).catch(() => setLineas([]));
  }, [proveedorId, modo]);

  function toggleLinea(l: any) {
    setSeleccion((prev) => {
      const actual = prev[l.id];
      if (actual?.checked) return { ...prev, [l.id]: { checked: false, monto: actual.monto } };
      return { ...prev, [l.id]: { checked: true, monto: Math.abs(Number(l.disponible)).toFixed(2) } };
    });
  }

  // Modo "Suelto"
  const [clubId, setClubId] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"PAGO" | "COBRO">("PAGO");

  async function onSubmitSuelto(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId || !clubId) return setMsg({ ok: false, text: "Elegí proveedor y club." });
    if (!(Number(amount) > 0)) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    if (medio === "EFECTIVO" && !custodio.trim()) return setMsg({ ok: false, text: "Un pago/cobro en efectivo requiere custodio (BIT-051/052)." });
    setLoading(true);
    try {
      await api.registrarPagoProveedor({
        proveedorId,
        clubId,
        amount: Number(amount),
        medio,
        direction,
        notes: notes.trim() || undefined,
        custodian: medio === "EFECTIVO" ? custodio.trim() : undefined,
        paymentLink: paymentLink.trim() || null,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el pago." });
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitLineas(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const elegidas = Object.entries(seleccion).filter(([, v]) => v.checked);
    if (elegidas.length === 0) return setMsg({ ok: false, text: "Tildá al menos una línea." });
    for (const [, v] of elegidas) {
      if (!(Number(v.monto) > 0)) return setMsg({ ok: false, text: "Todos los montos tildados tienen que ser mayores a 0." });
    }
    if (medio === "EFECTIVO" && !custodio.trim()) return setMsg({ ok: false, text: "Un pago/cobro en efectivo requiere custodio (BIT-051/052)." });
    setLoading(true);
    let exitos = 0;
    let ultimoError = "";
    for (const [lineaId, v] of elegidas) {
      const l = (lineas ?? []).find((x) => x.id === lineaId);
      if (!l) continue;
      try {
        await api.registrarPagoProveedor({
          proveedorId,
          clubId: l.club_id,
          amount: Number(v.monto),
          medio,
          direction: Number(l.disponible) >= 0 ? "PAGO" : "COBRO",
          notes: notes.trim() || undefined,
          cierreLineaId: l.id,
          custodian: medio === "EFECTIVO" ? custodio.trim() : undefined,
          paymentLink: paymentLink.trim() || null,
        });
        exitos++;
      } catch (err: any) {
        ultimoError = err.message || "Error desconocido.";
      }
    }
    setLoading(false);
    if (exitos === elegidas.length) {
      onDone();
    } else if (exitos > 0) {
      setMsg({ ok: false, text: `Se aplicaron ${exitos} de ${elegidas.length} -- el resto falló (${ultimoError}). Revisá y reintentá las que falten.` });
      api.lineasPendientesProveedor(proveedorId).then(setLineas).catch(() => {});
    } else {
      setMsg({ ok: false, text: ultimoError || "No se pudo registrar ningún pago." });
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button type="button" className={`btn small ${modo === "lineas" ? "" : "secondary"}`} onClick={() => setModo("lineas")}>
          Por línea de cierre
        </button>
        <button type="button" className={`btn small ${modo === "suelto" ? "" : "secondary"}`} onClick={() => setModo("suelto")}>
          Pago suelto (sin atar a una línea)
        </button>
      </div>

      <div className="field">
        <label>Proveedor</label>
        <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
          <option value="">Elegir...</option>
          {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {modo === "lineas" ? (
        <form onSubmit={onSubmitLineas}>
          {proveedorId && (
            !lineas ? (
              <div className="muted">Cargando líneas pendientes...</div>
            ) : lineas.length === 0 ? (
              <div className="muted" style={{ marginBottom: 10 }}>
                Este proveedor no tiene líneas de cierre con saldo pendiente (o son cierres viejos, de antes de este
                cambio, que nunca trackearon esto -- usá "Pago suelto" para esos).
              </div>
            ) : (
              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8, marginBottom: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th></th><th>Semana</th><th>Club</th><th>Línea</th><th className="num">Disponible</th><th className="num">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineas.map((l) => {
                      const sel = seleccion[l.id];
                      return (
                        <tr key={l.id}>
                          <td><input type="checkbox" checked={!!sel?.checked} onChange={() => toggleLinea(l)} /></td>
                          <td className="muted" style={{ fontSize: 12 }}>{dateShort(l.week_start)} - {dateShort(l.week_end)}</td>
                          <td>{l.club_name}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{l.tipo === "AGENTE" ? (l.agent_name ?? "Agente") : "Total club"}</td>
                          <td className={`num ${Number(l.disponible) >= 0 ? "pos" : "neg"}`}>{usd(Number(l.disponible))}</td>
                          <td className="num">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              disabled={!sel?.checked}
                              value={sel?.monto ?? ""}
                              onChange={(e) => setSeleccion((prev) => ({ ...prev, [l.id]: { checked: true, monto: e.target.value } }))}
                              style={{ width: 100, textAlign: "right" }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
          <div className="form-grid">
            <div className="field">
              <label>Medio (aplica a todas las líneas tildadas)</label>
              <select value={medio} onChange={(e) => setMedio(e.target.value as any)}>
                <option value="USDT">USDT</option>
                <option value="EFECTIVO">Efectivo</option>
                <option value="ZELLE">Zelle</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            {medio === "EFECTIVO" && (
              <div className="field">
                <label>Custodio</label>
                <input value={custodio} onChange={(e) => setCustodio(e.target.value)} placeholder="Quién tiene la plata físicamente" />
              </div>
            )}
          </div>
          <div className="field">
            <label>Notas (opcional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, hash de la transacción, etc." />
          </div>
          <div className="field">
            <label>Link de pago (opcional)</label>
            <input value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} placeholder="usdt.tx/..." />
          </div>
          {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
          <button className="btn" disabled={loading || !lineas || lineas.length === 0}>{loading ? "Guardando..." : "Registrar"}</button>
        </form>
      ) : (
        <form onSubmit={onSubmitSuelto}>
          <div className="form-grid">
            <div className="field">
              <label>Club</label>
              <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
                <option value="">Elegir...</option>
                {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
                <option value="PAGO">Pago (le pagamos)</option>
                <option value="COBRO">Cobro (nos paga)</option>
              </select>
            </div>
            <div className="field">
              <label>Medio</label>
              <select value={medio} onChange={(e) => setMedio(e.target.value as any)}>
                <option value="USDT">USDT</option>
                <option value="EFECTIVO">Efectivo</option>
                <option value="ZELLE">Zelle</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
            {medio === "EFECTIVO" && (
              <div className="field">
                <label>Custodio</label>
                <input value={custodio} onChange={(e) => setCustodio(e.target.value)} placeholder="Quién tiene la plata físicamente" />
              </div>
            )}
            <div className="field">
              <label>Monto (USD)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
            </div>
          </div>
          <div className="field">
            <label>Notas (opcional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, hash de la transacción, etc." />
          </div>
          <div className="field">
            <label>Link de pago (opcional)</label>
            <input value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} placeholder="usdt.tx/..." />
          </div>
          {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
          <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar"}</button>
        </form>
      )}
    </div>
  );
}

// Ajuste manual (30/09/2026, pedido de Leo: "necesitamos hacer varios ajuste manuales sobre los
// proveedores asi que necesitaria que esos ajuste los podamos hacer desde aca adentro") --
// misma mecánica que un pago/cobro (mismo endpoint, mismo delta sobre el saldo proveedor+club),
// pero marcado con origen "AJUSTE" para que se muestre distinto en el historial (nunca como si
// fuera plata real de tesorería -- medio se fuerza a SIN_TESORERIA del lado del servidor) y sin
// atar a ninguna línea de cierre (es una corrección suelta, no el cobro de un cierre puntual).
// Como usa el mismo saldo de proveedor_saldos que ya suma el PDF de Liquidación, el ajuste
// entra solo al total -- no hace falta tocar nada ahí aparte de mostrarlo desglosado.
function AjusteForm({ proveedores, clubes, onDone }: { proveedores: any[]; clubes: any[]; onDone: () => void }) {
  const [proveedorId, setProveedorId] = useState("");
  const [clubId, setClubId] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"PAGO" | "COBRO">("PAGO");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId || !clubId) return setMsg({ ok: false, text: "Elegí proveedor y club." });
    if (!(Number(amount) > 0)) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    if (!notes.trim()) return setMsg({ ok: false, text: "Un ajuste manual necesita un motivo en las notas." });
    setLoading(true);
    try {
      await api.registrarPagoProveedor({
        proveedorId,
        clubId,
        amount: Number(amount),
        medio: "SIN_TESORERIA",
        direction,
        notes: notes.trim(),
        origen: "AJUSTE",
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Corrección suelta del saldo -- no mueve tesorería de verdad, ni queda atada a ningún cierre puntual. Para
        pagarle/cobrarle de verdad a un proveedor usá "Pago / cobro".
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Efecto</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="PAGO">Resta del saldo (a favor nuestro)</option>
            <option value="COBRO">Suma al saldo (a favor del proveedor)</option>
          </select>
        </div>
        <div className="field">
          <label>Monto (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
        </div>
      </div>
      <div className="field">
        <label>Motivo (obligatorio)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Por qué se hace este ajuste" />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar ajuste"}</button>
    </form>
  );
}

// Genera el PDF "REPORTE ACTUAL DE <proveedor>" (22/09/2026, formato exacto del ejemplo que
// mandó Leo). Convención de ESTE reporte es la OPUESTA a la interna del sistema (acá positivo
// = <proveedor> nos debe, para que se lea como estado de cuenta) -- se invierte al armar el
// reporte, nunca se toca la convención interna (positivo = a favor del proveedor) en ningún
// otro lado. "Cierre línea" = monto_crudo tal cual quedó guardado en cada línea (para CLUB ya
// es el crudo sin invertir; para AGENTE es el final_closing del agente, nunca se invierte).
// "Impacto <proveedor>" = -monto_aplicado (la vuelta de tuerca de este reporte en particular).
async function generarLiquidacionPdf(input: {
  proveedorName: string;
  weekStart: string;
  weekEnd: string;
  lineasSeleccionadas: any[];
  // ajustes manuales de esta semana (30/09/2026, ver comentario en onGenerar más arriba) --
  // ya están adentro de saldoActualTotal, esto es solo para mostrarlos desglosados aparte.
  ajustes: any[];
  saldoActualTotal: number; // convención interna: positivo = a favor del proveedor
  garantiaVigente: number;
  nota: string;
}) {
  const { jsPDF, autoTable } = await cargarLibreriasPdf();
  const doc = new jsPDF();
  const margen = 14;
  let y = 18;

  doc.setFillColor(40, 50, 90);
  doc.rect(0, 0, 210, 14, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(`REPORTE ACTUAL DE ${input.proveedorName.toUpperCase()}`, 105, 9.5, { align: "center" });
  doc.setTextColor(0);
  y = 22;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Semana", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${dateShort(input.weekStart)} al ${dateShort(input.weekEnd)}`, margen + 22, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Proveedor / Unión", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(input.proveedorName, margen + 32, y);
  y += 8;

  const mostrarRebate = input.lineasSeleccionadas.some((l) => Number(l.club_rebate || 0) !== 0);

  function datosLinea(l: any) {
    const esAgente = l.tipo === "AGENTE";
    const resultado = esAgente ? Number(l.wc_result || 0) : Number(l.resultado_total || 0);
    const rakeTotal = esAgente ? Number(l.wc_rake_total || 0) : Number(l.rake_total || 0);
    const rakeback = esAgente ? Number(l.wc_rakeback || 0) : rakeTotal * Number(l.rakeback_pct || 0);
    const rebateClub = Number(l.club_rebate || 0);
    const rodeo = esAgente ? Number(l.wc_rodeo || 0) : Number(l.impacto_rodeo || 0);
    const cierreLinea = Number(l.monto_crudo);
    const impacto = -Number(l.monto_aplicado);
    return { esAgente, resultado, rakeTotal, rakeback, rebateClub, rodeo, cierreLinea, impacto };
  }

  const head = [
    "Agente / Línea", "Club", "Resultado", "Rake", "Rakeback",
    ...(mostrarRebate ? ["Rebate club"] : []),
    "Rodeo", "Cierre línea", `Impacto ${input.proveedorName}`,
  ];
  const body = input.lineasSeleccionadas.map((l) => {
    const d = datosLinea(l);
    const label = d.esAgente ? (l.agent_name ?? "?") : `TOTAL ${(l.club_name ?? "?").toUpperCase()}`;
    return [
      label, l.club_name, usd(d.resultado), usd(d.rakeTotal), usd(d.rakeback),
      ...(mostrarRebate ? [usd(d.rebateClub)] : []),
      usd(d.rodeo), usd(d.cierreLinea), usd(d.impacto),
    ];
  });
  const sum = (fn: (d: ReturnType<typeof datosLinea>) => number) =>
    input.lineasSeleccionadas.reduce((s, l) => s + fn(datosLinea(l)), 0);
  const totalImpacto = sum((d) => d.impacto);
  const foot = [
    "TOTAL CIERRE", "", usd(sum((d) => d.resultado)), usd(sum((d) => d.rakeTotal)), usd(sum((d) => d.rakeback)),
    ...(mostrarRebate ? [usd(sum((d) => d.rebateClub))] : []),
    usd(sum((d) => d.rodeo)), "", usd(totalImpacto),
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [head],
    body,
    foot: [foot],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [40, 50, 90] },
    footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // Ajustes manuales de esta semana (30/09/2026, pedido de Leo: "en la liquidacion PDF, todo
  // se deberia sumar y restar de estos ajuste manuales") -- desglosados en su propia tabla,
  // mismo signo/convención que "Impacto <proveedor>" de la tabla de arriba (-delta interno).
  if (input.ajustes.length > 0) {
    const impactoAjuste = (a: any) => (a.direction === "PAGO" ? Number(a.amount) : -Number(a.amount));
    autoTable(doc, {
      startY: y,
      margin: { left: margen, right: margen },
      head: [["Ajuste manual", "Club", "Fecha", "Motivo", "Impacto"]],
      body: input.ajustes.map((a: any) => [
        a.direction === "PAGO" ? "Resta (a favor nuestro)" : "Suma (a favor del proveedor)",
        a.club_name,
        dateShort(String(a.occurred_at).slice(0, 10)),
        a.notes || "—",
        usd(impactoAjuste(a)),
      ]),
      foot: [["TOTAL AJUSTES", "", "", "", usd(input.ajustes.reduce((s: number, a: any) => s + impactoAjuste(a), 0))]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [40, 50, 90] },
      footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Estado de cuenta -- ver comentario de convención arriba: acá SIEMPRE se combinan TODOS los
  // clubes del proveedor (el estado de cuenta completo), no solo las líneas tildadas para el
  // reporte. Refleja el saldo/garantía de HOY, no una reconstrucción histórica de esa semana.
  const deudaActualReporte = -input.saldoActualTotal;
  const saldoAnteriorReporte = deudaActualReporte - totalImpacto;
  const totalControlado = deudaActualReporte + input.garantiaVigente;

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Estado de cuenta", "Importe", "Detalle"]],
    body: [
      ["Saldo operativo anterior", usd(saldoAnteriorReporte), ""],
      ["Cierre semanal actual", usd(totalImpacto), "Impacto neto de las líneas incluidas en este reporte"],
      ["Deuda operativa actual", usd(deudaActualReporte), deudaActualReporte >= 0 ? `${input.proveedorName} nos debe` : `Le debemos a ${input.proveedorName}`],
      ["Garantía vigente", usd(input.garantiaVigente), "Separada de la deuda operativa"],
      ["TOTAL CONTROLADO", usd(totalControlado), "Deuda operativa actual + garantía vigente"],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 50, 90] },
    didParseCell: (data: any) => {
      if (data.row.section === "body" && (data.row.index === 2 || data.row.index === 4)) {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  doc.setFillColor(40, 50, 90);
  doc.rect(margen, y, 182, 10, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`TOTAL FINAL ${input.proveedorName.toUpperCase()}: ${usd(totalControlado)}`, margen + 3, y + 7);
  doc.setTextColor(0);
  y += 16;

  const notaSignos = input.lineasSeleccionadas
    .map((l) => {
      const d = datosLinea(l);
      return d.esAgente
        ? `En ${l.club_name} el cierre de ${l.agent_name ?? "el agente"} se invierte para obtener el impacto en ${input.proveedorName}.`
        : `En ${l.club_name} el signo se mantiene.`;
    })
    .join(" ");
  const notaCompleta = [notaSignos, "La garantía se conserva separada del saldo operativo.", input.nota.trim()]
    .filter(Boolean)
    .join(" ");
  if (notaCompleta) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(90);
    const lineas = doc.splitTextToSize(`Nota: ${notaCompleta}`, 182);
    doc.text(lineas, margen, y);
    doc.setTextColor(0);
  }

  const nombreArchivo = `Cierre_${input.proveedorName.replace(/[^a-z0-9]+/gi, "-")}_${input.weekStart}.pdf`;
  doc.save(nombreArchivo);
}

// Formulario del modal "+ Liquidación PDF" (22/09/2026, pedido de Leo: "tenemos que poder
// elegir en este caso al proveedor y a los clubes que tiene, no que salga de a uno") -- elige
// proveedor, después semana (de sus cierres ya aplicados), y tilda qué líneas (club y/o
// agente) van en el reporte -- por defecto todas tildadas. El saldo/garantía del estado de
// cuenta salen de los mismos `saldos`/`garantias` ya cargados en la página principal (filtrados
// por proveedor acá), nunca se recalculan.
function LiquidacionProveedorForm({
  proveedores,
  saldos,
  garantias,
  onDone,
}: {
  proveedores: any[];
  saldos: any[];
  garantias: any[];
  onDone: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [cierresProveedor, setCierresProveedor] = useState<any[] | null>(null);
  const [cierreId, setCierreId] = useState("");
  const [lineas, setLineas] = useState<any[] | null>(null);
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({});
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cargandoCierres, setCargandoCierres] = useState(false);
  const [generando, setGenerando] = useState(false);

  useEffect(() => {
    setCierreId("");
    setLineas(null);
    if (!proveedorId) { setCierresProveedor(null); return; }
    setCargandoCierres(true);
    api
      .cierresProveedor(proveedorId)
      .then((rows: any[]) => setCierresProveedor(rows.filter((c) => c.status !== "REVERTIDO")))
      .catch(() => setCierresProveedor([]))
      .finally(() => setCargandoCierres(false));
  }, [proveedorId]);

  useEffect(() => {
    if (!cierreId) { setLineas(null); return; }
    api
      .lineasCierreProveedor(cierreId)
      .then((rows: any[]) => {
        setLineas(rows);
        const sel: Record<string, boolean> = {};
        rows.forEach((l) => { sel[l.id] = true; });
        setSeleccion(sel);
      })
      .catch(() => setLineas([]));
  }, [cierreId]);

  const proveedor = proveedores.find((p) => p.id === proveedorId);
  const cierre = (cierresProveedor ?? []).find((c) => c.id === cierreId);

  async function onGenerar() {
    setMsg(null);
    if (!proveedor || !cierre || !lineas) return;
    const lineasSeleccionadas = lineas.filter((l) => seleccion[l.id]);
    if (lineasSeleccionadas.length === 0) return setMsg({ ok: false, text: "Elegí al menos una línea." });
    setGenerando(true);
    try {
      const saldoActualTotal = saldos
        .filter((s) => s.proveedor_id === proveedorId)
        .reduce((s, x) => s + Number(x.amount), 0);
      const garantiaVigente = garantias
        .filter((g) => g.proveedor_id === proveedorId)
        .reduce((s, g) => s + (Number(g.amount) - Number(g.consumed)), 0);
      // Ajustes manuales de esta semana (30/09/2026, pedido de Leo: "en la liquidacion PDF,
      // todo se deberia sumar y restar de estos ajuste manuales") -- ya están adentro de
      // saldoActualTotal (mismo saldo que ya suma todo), esto es solo para desglosarlos aparte
      // en el reporte en vez de que queden escondidos dentro del número final.
      const todosLosPagos: any[] = await api.pagosProveedor(proveedorId);
      const ajustes = todosLosPagos.filter(
        (p) =>
          p.origen === "AJUSTE" &&
          p.status !== "REVERTIDO" &&
          String(p.occurred_at).slice(0, 10) >= cierre.week_start &&
          String(p.occurred_at).slice(0, 10) <= cierre.week_end
      );
      await generarLiquidacionPdf({
        proveedorName: proveedor.name,
        weekStart: cierre.week_start,
        weekEnd: cierre.week_end,
        lineasSeleccionadas,
        ajustes,
        saldoActualTotal,
        garantiaVigente,
        nota,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo generar el PDF." });
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Semana</label>
          <select value={cierreId} onChange={(e) => setCierreId(e.target.value)} disabled={!proveedorId || cargandoCierres}>
            <option value="">{cargandoCierres ? "Cargando..." : "Elegir..."}</option>
            {(cierresProveedor ?? []).map((c) => (
              <option key={c.id} value={c.id}>{dateShort(c.week_start)} - {dateShort(c.week_end)}</option>
            ))}
          </select>
        </div>
      </div>

      {proveedorId && cierresProveedor && cierresProveedor.length === 0 && (
        <div className="muted" style={{ fontSize: 12 }}>Este proveedor todavía no tiene cierres semanales aplicados.</div>
      )}

      {cierreId && !lineas && <div className="muted">Cargando líneas...</div>}

      {lineas && lineas.length > 0 && (
        <div className="field">
          <label>Líneas a incluir en el reporte</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setSeleccion(Object.fromEntries(lineas.map((l) => [l.id, true])))}
            >
              Seleccionar todos
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setSeleccion(Object.fromEntries(lineas.map((l) => [l.id, false])))}
            >
              Deseleccionar todos
            </button>
          </div>
          {lineas.map((l) => (
            <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={!!seleccion[l.id]}
                onChange={(e) => setSeleccion((prev) => ({ ...prev, [l.id]: e.target.checked }))}
              />
              {l.tipo === "AGENTE" ? `${l.agent_name ?? "?"} (agente) -- ${l.club_name}` : `Club total -- ${l.club_name}`}
              <span className="muted">({usd(l.monto_aplicado)})</span>
            </label>
          ))}
        </div>
      )}

      <div className="field">
        <label>Nota (opcional)</label>
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Aclaración extra para el pie del PDF" />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={!lineas || lineas.length === 0 || generando} onClick={onGenerar}>
        {generando ? "Generando..." : "Generar PDF"}
      </button>
    </div>
  );
}

function GarantiaAjusteForm({
  proveedores,
  garantias,
  preselectProveedorId,
  onDone,
}: {
  proveedores: any[];
  garantias: any[];
  preselectProveedorId?: string;
  onDone: () => void;
}) {
  const [proveedorId, setProveedorId] = useState(preselectProveedorId ?? "");
  const [type, setType] = useState<"ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA">(preselectProveedorId ? "AUMENTO" : "ALTA");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const tieneGarantiaActiva = garantias.some((g) => g.proveedor_id === proveedorId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId) return setMsg({ ok: false, text: "Elegí un proveedor." });
    const monto = Number(amount) || 0;
    if (type !== "BAJA" && monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.ajustarGarantiaProveedor({ proveedorId, type, amount: monto, notes: notes.trim() || undefined });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select
            value={proveedorId}
            onChange={(e) => {
              const nextId = e.target.value;
              setProveedorId(nextId);
              const yaTiene = garantias.some((g) => g.proveedor_id === nextId);
              setType(yaTiene ? "AUMENTO" : "ALTA");
            }}
            disabled={!!preselectProveedorId}
          >
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo de movimiento</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="ALTA" disabled={tieneGarantiaActiva}>Alta (garantía nueva)</option>
            <option value="AUMENTO" disabled={!tieneGarantiaActiva}>Aumento</option>
            <option value="REDUCCION" disabled={!tieneGarantiaActiva}>Reducción</option>
            <option value="CONSUMO" disabled={!tieneGarantiaActiva}>Consumo</option>
            <option value="BAJA" disabled={!tieneGarantiaActiva}>Baja</option>
          </select>
        </div>
        {type !== "BAJA" && (
          <div className="field">
            <label>Monto (USD)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
          </div>
        )}
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo del ajuste, referencia, etc." />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Aplicar"}</button>
    </form>
  );
}

// Fila de resolución de una solicitud de retiro pendiente (ver panel "Solicitudes de retiro
// pendientes" más arriba) -- mismo mecanismo de siempre (registrarPagoProveedor medio USDT
// direction PAGO, vía marcarSolicitudRetiroEnviadaProveedor en repo/proveedores.ts), con el
// link de pago quedando asentado para que el proveedor lo vea en su propio historial. A
// diferencia de Supervisor, acá el admin SÍ elige el club (el saldo del proveedor está
// separado por club, no es un pool único).
function SolicitudRetiroProveedorRow({
  solicitud,
  clubes,
  onDone,
}: {
  solicitud: any;
  clubes: any[];
  onDone: () => void;
}) {
  const [clubId, setClubId] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onEnviar() {
    setMsg(null);
    if (!clubId) return setMsg({ ok: false, text: "Elegí el club." });
    if (!paymentLink.trim()) return setMsg({ ok: false, text: "Pegá el link de pago." });
    setEnviando(true);
    try {
      await api.marcarSolicitudRetiroEnviadaProveedor(solicitud.id, { clubId, paymentLink: paymentLink.trim() });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo marcar como enviado." });
    } finally {
      setEnviando(false);
    }
  }

  async function onRechazar() {
    const motivo = prompt(
      `¿Rechazar la solicitud de ${usd(Number(solicitud.amount))} de ${solicitud.proveedor_name}? Motivo (opcional):`
    );
    if (motivo === null) return;
    setRechazando(true);
    try {
      await api.rechazarSolicitudRetiroProveedor(solicitud.id, motivo || undefined);
      onDone();
    } catch (err: any) {
      alert(err.message || "No se pudo rechazar la solicitud.");
    } finally {
      setRechazando(false);
    }
  }

  return (
    <tr className="fila-pendiente">
      <td style={{ fontWeight: 600 }}>{solicitud.proveedor_name}</td>
      <td><span className="badge neutral">{usd(Number(solicitud.amount))}</span></td>
      <td className="muted" style={{ fontSize: 12.5 }}>{solicitud.nota || "—"}</td>
      <td className="muted">{dateShort(solicitud.requested_at)}</td>
      <td style={{ minWidth: 360 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)} style={{ fontSize: 12.5 }}>
            <option value="">Club...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            placeholder="Pegá el link de pago (tx) acá..."
            value={paymentLink}
            onChange={(e) => setPaymentLink(e.target.value)}
            style={{ flex: 1, minWidth: 160, fontSize: 12.5 }}
          />
          <button className="btn small" disabled={enviando} onClick={onEnviar}>
            {enviando ? "..." : "Marcar como enviado"}
          </button>
          <button className="btn danger small" disabled={rechazando} onClick={onRechazar}>
            {rechazando ? "..." : "Rechazar"}
          </button>
        </div>
        {msg && <div className={msg.ok ? "success" : "error"} style={{ fontSize: 12, marginTop: 4 }}>{msg.text}</div>}
      </td>
    </tr>
  );
}
