import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";
import Loading from "../components/Loading";
import ActionsMenu from "../components/ActionsMenu";

// Cuentas consolidadas para supervisores (30/09/2026, pedido de Leo: "Edwar es un super
// agente, todo lo que pase con sus agentes va todo al mismo lugar") -- sección separada de
// Agentes/Movimientos, a propósito (ver repo/supervisores.ts): un supervisor con
// usa_cuenta_consolidada=true tiene UN SOLO saldo (fichas_reales + cuenta_corriente, no por
// club) que junta todo lo de sus agentes -- esos agentes se ven acá solo como desglose de
// lectura/auditoría, nunca tienen saldo propio mientras esto esté prendido.
const TIPO_LABEL: Record<string, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  AJUSTE: "Ajuste manual",
};

export default function Supervisores() {
  const [supervisores, setSupervisores] = useState<any[] | null>(null);
  const [clubes, setClubes] = useState<any[]>([]);
  const [error, setError] = useState("");
  // Solicitudes de retiro/pago de los supervisores (16/10/2026, pedido de Leo: "al supervisor le
  // queremos poner botones para que pueda solicitar retiros/pagos y que nos llegue la
  // notificacion a nosotros") -- siempre visible arriba de todo, no depende de tener un
  // supervisor seleccionado (ver repo/supervisores.ts listSolicitudesRetiroPendientesTodas).
  const [solicitudes, setSolicitudes] = useState<any[] | null>(null);
  const [seleccionado, setSeleccionado] = useState<any | null>(null);
  const [subordinados, setSubordinados] = useState<any[] | null>(null);
  const [movimientos, setMovimientos] = useState<any[] | null>(null);
  // Desglose de "cómo se compone el saldo" (01/10/2026, pedido de Leo): el saldo de la cuenta
  // consolidada es un pool único (no tiene desglose vivo por agente, ver nota en
  // repo/supervisores.ts), pero el saldo HISTÓRICO inicial que se migró sí quedó registrado
  // línea por línea en supervisor_migracion_historica -- esto lo muestra.
  const [migracion, setMigracion] = useState<any[] | null>(null);
  // Fichas en tiempo real por agente (15/10/2026, pedido de Leo) -- desglose calculado del mismo
  // saldo de arriba, repartido por agente usando el agent_id de movimientos/cierres/migración.
  const [saldosPorAgente, setSaldosPorAgente] = useState<any[] | null>(null);
  const [clubesExpandidos, setClubesExpandidos] = useState<Record<string, boolean>>({});
  const [showMovimiento, setShowMovimiento] = useState(false);
  // Ocultar/mostrar un agente de "Agentes a cargo" (01/10/2026, pedido de Leo, caso Uriel):
  // puramente visual, nunca mueve plata -- ver nota en schema.sql / repo/catalog.ts. Arranca
  // colapsado (false) para no mostrar de entrada una lista larga de ocultos.
  const [mostrarOcultos, setMostrarOcultos] = useState(false);
  const [ocultando, setOcultando] = useState<string | null>(null);
  const [tabDet, setTabDet] = useState<"resumen" | "cierre" | "agentes" | "movs" | "origen">("resumen");
  const [verRevertidos, setVerRevertidos] = useState(false);

  // Cierre semanal consolidado (14/10/2026, pedido de Leo: "las liquidaciones de sus agentes,
  // sumen su saldo al momento de hacer el cierre") -- espejo automático aparte, el saldo propio
  // del agente sigue acumulando igual que siempre, ver repo/supervisores.ts.
  const [semanasCierre, setSemanasCierre] = useState<any[] | null>(null);
  const [weekCierre, setWeekCierre] = useState("");
  const [cierreSemana, setCierreSemana] = useState<any | null>(null);
  const [cargandoCierre, setCargandoCierre] = useState(false);
  const [aplicandoCierre, setAplicandoCierre] = useState(false);
  const [revirtiendoCierre, setRevirtiendoCierre] = useState(false);

  function refresh() {
    setError("");
    api.supervisoresConsolidados().then(setSupervisores).catch((e) => setError(e.message));
  }

  function refreshSolicitudes() {
    api.solicitudesRetiroPendientes().then(setSolicitudes);
  }

  useEffect(() => {
    refresh();
    api.clubes().then(setClubes);
    refreshSolicitudes();
  }, []);

  function abrirSupervisor(s: any) {
    setSeleccionado(s);
    setTabDet("resumen");
    setVerRevertidos(false);
    setTimeout(() => document.getElementById("cuenta-supervisor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    setSubordinados(null);
    setMovimientos(null);
    setMostrarOcultos(false);
    setMigracion(null);
    setSaldosPorAgente(null);
    setClubesExpandidos({});
    setSemanasCierre(null);
    setWeekCierre("");
    setCierreSemana(null);
    api.subordinadosSupervisor(s.id).then(setSubordinados);
    api.movimientosSupervisor(s.id).then(setMovimientos);
    api.migracionHistoricaSupervisor(s.id).then(setMigracion);
    api.saldosPorAgenteSupervisor(s.id).then(setSaldosPorAgente);
    api.semanasCierreSupervisor(s.id).then((r: any[]) => {
      setSemanasCierre(r);
      if (r[0]) {
        const ws = String(r[0].week_start).slice(0, 10);
        setWeekCierre(ws);
        cargarCierreSemana(s.id, ws);
      }
    });
  }

  async function cargarCierreSemana(supervisorId: string, ws: string) {
    if (!ws) return;
    setCargandoCierre(true);
    try {
      setCierreSemana(await api.cierreSemanalSupervisor(supervisorId, ws));
    } catch (err: any) {
      setError(err.message || "No se pudo cargar el cierre de esa semana.");
    } finally {
      setCargandoCierre(false);
    }
  }

  async function aplicarCierre() {
    if (!seleccionado || !weekCierre || !cierreSemana) return;
    const semana = semanasCierre?.find((s) => String(s.week_start).slice(0, 10) === weekCierre);
    const weekEnd = semana ? String(semana.week_end).slice(0, 10) : weekCierre;
    if (
      !confirm(
        `¿Aplicar el cierre de la semana del ${dateShort(weekCierre)} al ${dateShort(weekEnd)}? ` +
          `Esto suma ${usd(cierreSemana.resultadoTotal)} a Fichas reales y ${usd(cierreSemana.rakebackTotal)} a Cuenta corriente. ` +
          `Si te equivocaste se puede desaplicar después desde el botón "Desaplicar".`
      )
    )
      return;
    setAplicandoCierre(true);
    try {
      await api.aplicarCierreSupervisor(seleccionado.id, weekCierre, weekEnd);
      await cargarCierreSemana(seleccionado.id, weekCierre);
      refrescarSeleccionado();
    } catch (err: any) {
      setError(err.message || "No se pudo aplicar el cierre.");
    } finally {
      setAplicandoCierre(false);
    }
  }

  async function onRevertirCierreSupervisor() {
    if (!seleccionado || !cierreSemana?.aplicado) return;
    const motivo = prompt(
      `¿Desaplicar el cierre de la semana del ${dateShort(cierreSemana.aplicado.week_start)} al ${dateShort(cierreSemana.aplicado.week_end)}? ` +
        `Esto resta ${usd(Number(cierreSemana.aplicado.resultado_total))} a Fichas reales y ${usd(Number(cierreSemana.aplicado.rakeback_total))} a Cuenta corriente ` +
        `(el efecto contrario de cuando se aplicó). El saldo propio de cada agente no se toca. Motivo (opcional):`
    );
    if (motivo === null) return; // canceló el prompt
    setRevirtiendoCierre(true);
    try {
      await api.revertirCierreSupervisor(cierreSemana.aplicado.id, motivo || undefined);
      await cargarCierreSemana(seleccionado.id, weekCierre);
      refrescarSeleccionado();
    } catch (err: any) {
      alert(err.message || "No se pudo desaplicar el cierre.");
    } finally {
      setRevirtiendoCierre(false);
    }
  }

  async function toggleOcultoAgente(agentId: string, agentName: string, ocultar: boolean) {
    if (!seleccionado) return;
    // Esto mueve plata de verdad (resta/suma el saldo actual del agente al pool de Uriel, ver
    // repo/supervisores.ts setOcultoSubordinado) -- confirmación antes de aplicar, mismo criterio
    // que "Revertir" acá abajo.
    const mensaje = ocultar
      ? `¿Ocultar a "${agentName}"? Se le va a restar a esta cuenta el saldo ACTUAL de ese agente (fichas + pendiente de rakeback). Se puede deshacer desde "Movimientos manuales" (Revertir) o volviendo a mostrarlo.`
      : `¿Volver a mostrar a "${agentName}"? Se le va a sumar a esta cuenta el saldo ACTUAL de ese agente en este momento (no el que tenía cuando se ocultó).`;
    if (!confirm(mensaje)) return;
    setOcultando(agentId);
    try {
      await api.ocultarAgenteSupervisor(seleccionado.id, agentId, ocultar);
      const frescos = await api.subordinadosSupervisor(seleccionado.id);
      setSubordinados(frescos);
      refrescarSeleccionado();
    } catch (err: any) {
      setError(err.message || "No se pudo actualizar el agente.");
    } finally {
      setOcultando(null);
    }
  }

  function refrescarSeleccionado() {
    if (!seleccionado) return;
    api.supervisorConsolidado(seleccionado.id).then((s: any) => {
      setSeleccionado(s);
      setSupervisores((prev) => (prev ?? []).map((x) => (x.id === s.id ? s : x)));
    });
    api.movimientosSupervisor(seleccionado.id).then(setMovimientos);
    api.saldosPorAgenteSupervisor(seleccionado.id).then(setSaldosPorAgente);
  }

  async function onRevertirMovimiento(id: string) {
    if (!confirm("¿Revertir este movimiento? Aplica el efecto contrario sobre la cuenta.")) return;
    try {
      await api.revertirMovimientoSupervisor(id);
      refrescarSeleccionado();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Supervisores: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!supervisores) return <Loading />;

  // ---- Pantalla (19/10/2026, mockup aprobado): lista ordenada por saldo y cuenta en pestañas ----
  const saldoTotalSup = (s: any) => Number(s.fichas_reales) + Number(s.cuenta_corriente);
  const montoSignoSup = (n: number, centavos = false) => {
    const v = centavos ? Math.round(Math.abs(n) * 100) / 100 : Math.abs(n);
    const txt = centavos
      ? `US$ ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : usd(v);
    return `${n < -0.004 ? "−" : ""}${txt}`;
  };
  const montoMovSup = (m: any) => {
    const a = Number(m.amount);
    const signo = m.type === "DESCARGA" ? "−" : a < 0 ? "−" : a > 0 ? "+" : "";
    return `${signo}${montoSignoSup(Math.abs(a), true).replace("−", "")}`;
  };
  const supervisoresOrdenados = [...(supervisores ?? [])].sort((a, b) => Math.abs(saldoTotalSup(b)) - Math.abs(saldoTotalSup(a)));
  const movsVisibles = (movimientos ?? []).filter((m) => verRevertidos || m.status !== "REVERTIDO");
  const detalleClubesAgente = (s: any) => (
    <>
      <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--gold)" }}>
        {s.agentName} -- saldo actual por club (informativo, en vivo)
      </div>
      <div className="muted" style={{ fontSize: 12, margin: "6px 0 10px", maxWidth: 820 }}>
        Esto es lo que {s.agentName} tiene AHORA en cada club (balance propio + resultado de mesas + rakeback pendiente activo) -- es
        de referencia, no se suma a la cuenta de {seleccionado?.name}: la cuenta consolidada solo cambia con
        Carga/Descarga/Ajuste/Cierre semanal. Por eso el total de acá abajo no tiene por qué coincidir con la fila de arriba.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ margin: 0 }}>
          <thead>
            <tr><th>Club</th><th className="num">Fichas (balance + mesas)</th><th className="num">Rakeback pendiente activo</th><th className="num">Saldo</th></tr>
          </thead>
          <tbody>
            {s.detallePorClub.map((c: any) => (
              <tr key={c.clubId}>
                <td>{c.clubName}</td>
                <td className="num">{usd(Number(c.fichas))}</td>
                <td className="num">{usd(Number(c.pendiente))}</td>
                <td className="num" style={{ fontWeight: 600 }}>{usd(Number(c.saldo))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td>Total individual hoy</td>
              <td className="num">{usd(s.detallePorClub.reduce((acc: number, c: any) => acc + Number(c.fichas), 0))}</td>
              <td className="num">{usd(s.detallePorClub.reduce((acc: number, c: any) => acc + Number(c.pendiente), 0))}</td>
              <td className="num">{usd(s.detallePorClub.reduce((acc: number, c: any) => acc + Number(c.saldo), 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );

  return (
    <div>
      <div className="topbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2>Supervisores</h2>
          <div className="muted">
            Cuenta consolidada: un supervisor con cuenta consolidada activada (ver Administración → editar agente) junta en un
            único saldo todo lo de los agentes que le reportan -- esos agentes dejan de acumular saldo propio.
          </div>
        </div>
        {solicitudes && solicitudes.length === 0 && <span className="pill">Sin solicitudes de retiro</span>}
      </div>

      {solicitudes && solicitudes.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--gold)" }}>
          <h3>Solicitudes de retiro pendientes</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            Lo que piden los supervisores desde "Mi Supervisión". Al marcarla como enviada se
            registra la Descarga de siempre en su historial (misma mecánica que + Carga / Descarga /
            Ajuste) con el link de pago asentado, para que puedan ver el trackeo reflejado en su
            propio historial.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead><tr><th>Supervisor</th><th>Monto solicitado</th><th>Nota</th><th>Fecha</th><th></th></tr></thead>
              <tbody>
                {solicitudes.map((s) => (
                  <SolicitudRetiroRow
                    key={s.id}
                    solicitud={s}
                    clubes={clubes}
                    onDone={() => {
                      refreshSolicitudes();
                      refrescarSeleccionado();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {supervisores.length === 0 ? (
        <div className="panel">
          <div className="muted">
            Todavía no hay ningún supervisor con "Usa cuenta consolidada" activado. Se activa editando un
            agente desde Administración.
          </div>
        </div>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat-card">
              <div className="l">Saldo total de supervisores</div>
              <div className="v">{montoSignoSup(supervisores.reduce((s, x) => s + saldoTotalSup(x), 0))}</div>
              <div className="s">{supervisores.length} cuenta{supervisores.length === 1 ? "" : "s"} consolidada{supervisores.length === 1 ? "" : "s"}</div>
            </div>
            <div className="stat-card">
              <div className="l">Fichas reales</div>
              <div className="v">{montoSignoSup(supervisores.reduce((s, x) => s + Number(x.fichas_reales), 0))}</div>
              <div className="s">suma de las cuentas</div>
            </div>
            <div className="stat-card">
              <div className="l">Cuenta corriente</div>
              <div className="v">{montoSignoSup(supervisores.reduce((s, x) => s + Number(x.cuenta_corriente), 0))}</div>
              <div className="s">suma de las cuentas</div>
            </div>
          </div>

          <div className="panel">
            <div className="ag-table-wrap">
              <table className="saldos-table">
                <thead>
                  <tr><th>Supervisor</th><th className="num">Fichas reales</th><th className="num">Cuenta corriente</th><th className="num">Saldo total</th><th></th></tr>
                </thead>
                <tbody>
                  {supervisoresOrdenados.map((s) => {
                    const total = saldoTotalSup(s);
                    const cantAgentes = s.n_sub;
                    return (
                      <tr
                        key={s.id}
                        className={`row-click ${total > 0 ? "row-pos" : total < 0 ? "row-neg" : ""}`}
                        style={seleccionado?.id === s.id ? { outline: "1px solid var(--accent)", outlineOffset: -1 } : undefined}
                        onClick={() => abrirSupervisor(s)}
                      >
                        <td>
                          <div className="saldo-name">{s.name}</div>
                          <div className="saldo-sub">{cantAgentes != null ? `${cantAgentes} agente${cantAgentes === 1 ? "" : "s"} a cargo · ` : ""}{s.modelo_cuenta === "PREPAGO" ? "Prepago" : s.modelo_cuenta ?? "—"}</div>
                        </td>
                        <td className="num money">{montoSignoSup(Number(s.fichas_reales))}</td>
                        <td className="num money">{montoSignoSup(Number(s.cuenta_corriente))}</td>
                        <td className="num"><span className={`saldo-big ${total > 0 ? "pos" : total < 0 ? "neg" : "neutral"}`}>{montoSignoSup(total)}</span></td>
                        <td style={{ width: 100, textAlign: "right" }}>
                          <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); abrirSupervisor(s); }}>Ver cuenta</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ag-cards">
              {supervisoresOrdenados.map((s) => {
                const total = saldoTotalSup(s);
                return (
                  <div
                    key={s.id}
                    className={`saldo-card ${total > 0 ? "is-pos" : total < 0 ? "is-neg" : ""}`}
                    style={seleccionado?.id === s.id ? { boxShadow: "0 0 0 1px var(--accent)" } : undefined}
                    onClick={() => abrirSupervisor(s)}
                  >
                    <div className="saldo-card-body">
                      <div className="saldo-card-top">
                        <div className="saldo-name">{s.name}</div>
                        <div className={`saldo-big ${total > 0 ? "pos" : total < 0 ? "neg" : "neutral"}`}>{montoSignoSup(total)}</div>
                      </div>
                      <div className="saldo-card-mid">
                        <div className="saldo-sub">{s.n_sub != null ? `${s.n_sub} agente${s.n_sub === 1 ? "" : "s"} · ` : ""}{s.modelo_cuenta === "PREPAGO" ? "Prepago" : s.modelo_cuenta ?? "—"}</div>
                      </div>
                      <div className="saldo-card-foot" style={{ gap: 16 }}>
                        <span>Fichas reales <b>{montoSignoSup(Number(s.fichas_reales))}</b></span>
                        <span>Cuenta corriente <b>{montoSignoSup(Number(s.cuenta_corriente))}</b></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {seleccionado && (
        <div id="cuenta-supervisor">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div className="deals-eyebrow">Cuenta consolidada</div>
                <div style={{ fontSize: 22, fontWeight: 750, letterSpacing: "-0.01em" }}>{seleccionado.name}</div>
                <div className="saldo-sub">
                  {seleccionado.modelo_cuenta === "PREPAGO" ? "Prepago" : seleccionado.modelo_cuenta ?? "—"}
                  {subordinados ? ` · ${subordinados.length} agente${subordinados.length === 1 ? "" : "s"} a cargo` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn" onClick={() => setShowMovimiento(true)}>+ Carga / Descarga / Ajuste</button>
                <button className="icon-btn" title="Cerrar la cuenta" onClick={() => setSeleccionado(null)}>✕</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 28, marginTop: 14, flexWrap: "wrap" }}>
              <div>
                <div className="saldo-sub" style={{ margin: 0 }}>Saldo total</div>
                <div className={`saldo-big ${saldoTotalSup(seleccionado) > 0 ? "pos" : saldoTotalSup(seleccionado) < 0 ? "neg" : "neutral"}`} style={{ fontSize: 30 }}>
                  {montoSignoSup(saldoTotalSup(seleccionado), true)}
                </div>
              </div>
              <div>
                <div className="saldo-sub" style={{ margin: 0 }}>Fichas reales</div>
                <div className="saldo-big" style={{ fontSize: 20 }}>{montoSignoSup(Number(seleccionado.fichas_reales), true)}</div>
              </div>
              <div>
                <div className="saldo-sub" style={{ margin: 0 }}>Cuenta corriente</div>
                <div className="saldo-big" style={{ fontSize: 20 }}>{montoSignoSup(Number(seleccionado.cuenta_corriente), true)}</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="ag-toolbar" style={{ marginBottom: 12 }}>
              <span className="seg tabs-scroll" style={{ overflowX: "auto", maxWidth: "100%" }}>
                <button className={tabDet === "resumen" ? "on" : ""} onClick={() => setTabDet("resumen")}>Resumen</button>
                <button className={tabDet === "cierre" ? "on" : ""} onClick={() => setTabDet("cierre")}>Cierre semanal</button>
                <button className={tabDet === "agentes" ? "on" : ""} onClick={() => setTabDet("agentes")}>Agentes a cargo{subordinados && <span className="n">{subordinados.length}</span>}</button>
                <button className={tabDet === "movs" ? "on" : ""} onClick={() => setTabDet("movs")}>Movimientos{movimientos && <span className="n">{movimientos.length}</span>}</button>
                <button className={tabDet === "origen" ? "on" : ""} onClick={() => setTabDet("origen")}>Origen del saldo{migracion && <span className="n">{migracion.length}</span>}</button>
              </span>
              <span className="ag-toolbar-spacer" />
              {tabDet === "movs" && (
                <label className="switch">
                  <input type="checkbox" checked={verRevertidos} onChange={(e) => setVerRevertidos(e.target.checked)} />
                  <i />
                  Mostrar revertidos{movimientos ? ` (${movimientos.filter((m) => m.status === "REVERTIDO").length})` : ""}
                </label>
              )}
            </div>

            {tabDet === "resumen" && (
              <>
                <h4 style={{ margin: "0 0 4px" }}>Fichas en tiempo real por agente</h4>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Cada Carga/Descarga/Ajuste que se registre con un agente elegido se suma o resta acá, en su fila. El total coincide,
                  centavo a centavo, con el saldo de arriba: es el mismo saldo de {seleccionado.name}, repartido por agente.
                </div>
                {!saldosPorAgente ? (
                  <Loading />
                ) : saldosPorAgente.length === 0 ? (
                  <div className="muted">Ningún agente tiene "Supervisor" = "{seleccionado.name}" todavía.</div>
                ) : (
                  <>
                    <div className="ag-table-wrap">
                      <table className="saldos-table">
                        <thead>
                          <tr><th>Agente</th><th className="num">Fichas en tiempo real</th><th className="num">Cuenta corriente</th><th className="num">Saldo real</th></tr>
                        </thead>
                        <tbody>
                          {saldosPorAgente.map((s) => {
                            const multiClub = (s.detallePorClub?.length ?? 0) > 1;
                            const expandido = !!clubesExpandidos[s.agentId ?? "sin-agente"];
                            const saldo = Number(s.saldoReal);
                            return (
                              <Fragment key={s.agentId ?? "sin-agente"}>
                                <tr
                                  className={saldo > 0.004 ? "row-pos" : saldo < -0.004 ? "row-neg" : ""}
                                  style={{ ...(s.oculto ? { opacity: 0.6 } : {}), ...(multiClub ? { cursor: "pointer" } : {}) }}
                                  onClick={multiClub ? () => setClubesExpandidos((prev) => ({ ...prev, [s.agentId]: !prev[s.agentId] })) : undefined}
                                >
                                  <td>
                                    <div className="saldo-name">
                                      {s.agentName}
                                      {multiClub && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · {s.detallePorClub.length} clubes {expandido ? "▾" : "▸"}</span>}
                                      {s.oculto && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> (oculto)</span>}
                                    </div>
                                  </td>
                                  <td className="num money">{montoSignoSup(Number(s.fichasTiempoReal), true)}</td>
                                  <td className="num money">{montoSignoSup(Number(s.cuentaCorriente), true)}</td>
                                  <td className="num"><span className={`saldo-big ${saldo > 0.004 ? "pos" : saldo < -0.004 ? "neg" : "neutral"}`}>{montoSignoSup(saldo, true)}</span></td>
                                </tr>
                                {multiClub && expandido && (
                                  <tr>
                                    <td colSpan={4} style={{ background: "var(--panel-2)", padding: "10px 16px 14px 36px", borderLeft: "3px solid var(--gold)" }}>
                                      {detalleClubesAgente(s)}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ fontWeight: 700 }}>
                            <td>Total (coincide con el saldo de arriba)</td>
                            <td className="num">{montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.fichasTiempoReal), 0), true)}</td>
                            <td className="num">{montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.cuentaCorriente), 0), true)}</td>
                            <td className="num">{montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.saldoReal), 0), true)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="ag-cards">
                      {saldosPorAgente.map((s) => {
                        const multiClub = (s.detallePorClub?.length ?? 0) > 1;
                        const expandido = !!clubesExpandidos[s.agentId ?? "sin-agente"];
                        const saldo = Number(s.saldoReal);
                        return (
                          <div
                            key={s.agentId ?? "sin-agente"}
                            className={`saldo-card ${saldo > 0.004 ? "is-pos" : saldo < -0.004 ? "is-neg" : ""}`}
                            style={s.oculto ? { opacity: 0.6 } : undefined}
                            onClick={multiClub ? () => setClubesExpandidos((prev) => ({ ...prev, [s.agentId]: !prev[s.agentId] })) : undefined}
                          >
                            <div className="saldo-card-body">
                              <div className="saldo-card-top">
                                <div className="saldo-name">
                                  {s.agentName}
                                  {multiClub && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> · {s.detallePorClub.length} clubes {expandido ? "▾" : "▸"}</span>}
                                  {s.oculto && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> (oculto)</span>}
                                </div>
                                <div className={`saldo-big ${saldo > 0.004 ? "pos" : saldo < -0.004 ? "neg" : "neutral"}`}>{montoSignoSup(saldo)}</div>
                              </div>
                              <div className="saldo-card-foot" style={{ gap: 16 }}>
                                <span>Fichas <b>{montoSignoSup(Number(s.fichasTiempoReal))}</b></span>
                                <span>Cuenta corriente <b>{montoSignoSup(Number(s.cuentaCorriente))}</b></span>
                              </div>
                              {multiClub && expandido && <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10 }}>{detalleClubesAgente(s)}</div>}
                            </div>
                          </div>
                        );
                      })}
                      <div className="muted" style={{ fontSize: 12 }}>
                        Total: fichas {montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.fichasTiempoReal), 0), true)} · cuenta corriente {montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.cuentaCorriente), 0), true)}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {tabDet === "cierre" && (
              <>
                <h4 style={{ margin: "0 0 4px" }}>Cierre semanal de agentes a cargo</h4>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Trae el cierre semanal ya cargado de cada agente a cargo: las fichas ganadas en mesas se
                  suman a Fichas reales, y el rakeback generado se suma a Cuenta corriente -- el saldo propio
                  del agente sigue acumulando igual que siempre, esto es un espejo automático aparte. Se
                  puede aplicar una sola vez por semana.
                </div>
                {!semanasCierre ? (
                  <Loading />
                ) : semanasCierre.length === 0 ? (
                  <div className="muted">Todavía no hay ningún cierre semanal cargado para los agentes a cargo.</div>
                ) : (
                  <>
                    <div className="tb-week-chips" style={{ justifyContent: "flex-start", marginBottom: 10 }}>
                      {semanasCierre.map((s) => {
                        const ws = String(s.week_start).slice(0, 10);
                        return (
                          <button
                            key={ws}
                            className={`chip${weekCierre === ws ? " chip-active" : ""}`}
                            onClick={() => {
                              setWeekCierre(ws);
                              cargarCierreSemana(seleccionado.id, ws);
                            }}
                          >
                            {dateShort(s.week_start)} al {dateShort(s.week_end)}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                      {cierreSemana?.aplicado ? (
                        <>
                          <span className="pill g">Aplicada el {dateShort(cierreSemana.aplicado.created_at)}</span>
                          <button
                            className="btn danger small"
                            disabled={revirtiendoCierre}
                            onClick={onRevertirCierreSupervisor}
                            title="Deshace el efecto de este cierre sobre Fichas reales y Cuenta corriente, y deja la semana libre para volver a aplicarla."
                          >
                            {revirtiendoCierre ? "Desaplicando..." : "Desaplicar"}
                          </button>
                        </>
                      ) : (
                        <span className="pill">Todavía no aplicada</span>
                      )}
                    </div>
                    {cargandoCierre || !cierreSemana ? (
                      <Loading />
                    ) : (
                      <>
                        <div style={{ overflowX: "auto" }}>
                          <table className="saldos-table">
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
                                  <td><div className="saldo-name">{l.agent_name}</div></td>
                                  <td className={`num ${Number(l.result) >= 0 ? "pos" : "neg"}`}>{montoSignoSup(Number(l.result), true)}</td>
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
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                          <button
                            className="btn"
                            disabled={!!cierreSemana.aplicado || aplicandoCierre}
                            onClick={aplicarCierre}
                            title={cierreSemana.aplicado ? "Esta semana ya fue aplicada." : undefined}
                          >
                            {aplicandoCierre ? "Aplicando..." : cierreSemana.aplicado ? "Ya aplicada" : "Aplicar cierre de esta semana a la cuenta"}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {tabDet === "agentes" && (
              <>
                <h4 style={{ margin: "0 0 4px" }}>Agentes a cargo (sin saldo propio)</h4>
                {!subordinados ? (
                  <Loading />
                ) : subordinados.length === 0 ? (
                  <div className="muted">
                    Ningún agente tiene "Supervisor" = "{seleccionado.name}" todavía -- asignalo desde Administración.
                  </div>
                ) : (
                  (() => {
                    const visibles = subordinados.filter((a) => !a.oculto_en_supervisor);
                    const ocultos = subordinados.filter((a) => a.oculto_en_supervisor);
                    const fila = (a: any, oculto: boolean) => (
                      <div
                        key={a.id}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 2px", borderTop: "1px solid var(--border)", opacity: oculto ? 0.6 : 1 }}
                      >
                        <div>
                          <div className="saldo-name">{a.name}</div>
                          <div className="saldo-sub">{a.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"} · {a.active ? "activo" : "inactivo"}</div>
                        </div>
                        <ActionsMenu
                          items={[
                            oculto
                              ? { label: "Mostrar en la cuenta", onClick: () => toggleOcultoAgente(a.id, a.name, false), disabled: ocultando === a.id }
                              : { label: "Ocultar…", onClick: () => toggleOcultoAgente(a.id, a.name, true), disabled: ocultando === a.id },
                          ]}
                        />
                      </div>
                    );
                    return (
                      <>
                        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                          Ocultar a un agente le resta a la cuenta su saldo actual (no lo da de baja); se puede volver a mostrar cuando quieras.
                        </div>
                        {visibles.length === 0 && <div className="muted">Todos los agentes están ocultos ahora mismo.</div>}
                        {visibles.map((a) => fila(a, false))}
                        {ocultos.length > 0 && (
                          <>
                            <label className="switch" style={{ margin: "12px 0 4px" }}>
                              <input type="checkbox" checked={mostrarOcultos} onChange={(e) => setMostrarOcultos(e.target.checked)} />
                              <i />
                              Mostrar ocultos ({ocultos.length})
                            </label>
                            {mostrarOcultos && ocultos.map((a) => fila(a, true))}
                          </>
                        )}
                      </>
                    );
                  })()
                )}
              </>
            )}

            {tabDet === "movs" && (
              <>
                {!movimientos ? (
                  <Loading />
                ) : movimientos.length === 0 ? (
                  <div className="muted">Todavía no hay movimientos cargados.</div>
                ) : (
                  <>
                    <div className="ag-table-wrap">
                      <table className="saldos-table">
                        <thead>
                          <tr><th>Fecha</th><th>Tipo</th><th>Club · agente</th><th className="num">Importe</th><th>Notas</th><th>Estado</th><th></th></tr>
                        </thead>
                        <tbody>
                          {movsVisibles.map((m) => (
                            <tr key={m.id} style={m.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                              <td className="muted">{dateShort(m.occurred_at)}</td>
                              <td><span className={`pill ${m.type === "DESCARGA" ? "a" : m.type === "CARGA" ? "g" : ""}`}>{TIPO_LABEL[m.type] ?? m.type}</span></td>
                              <td>
                                <div className="saldo-name" style={{ fontWeight: 600 }}>{m.club_name}</div>
                                <div className="saldo-sub">{m.agent_name ?? "sin agente"}{m.usdt_real ? " · USDT real" : ""}</div>
                              </td>
                              <td className="num"><span className={`saldo-big ${m.type === "DESCARGA" ? "neg" : Number(m.amount) < 0 ? "neg" : "pos"}`}>{montoMovSup(m)}</span></td>
                              <td className="muted" style={{ fontSize: 12, maxWidth: 260 }} title={m.notes || undefined}>{m.notes ? (m.notes.length > 70 ? `${m.notes.slice(0, 70)}…` : m.notes) : "—"}</td>
                              <td>
                                {m.status === "REVERTIDO" ? <span className="pill r">Revertido</span> : <span className="pill g">Aplicado</span>}
                                {m.payment_link && <> <a className="link-pago" href={m.payment_link} target="_blank" rel="noreferrer">Ver pago ↗</a></>}
                              </td>
                              <td style={{ width: 60, textAlign: "right" }}>
                                {m.status !== "REVERTIDO" && <ActionsMenu items={[{ label: "Revertir", onClick: () => onRevertirMovimiento(m.id), danger: true }]} />}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="ag-cards">
                      {movsVisibles.map((m) => (
                        <div key={m.id} className={`saldo-card ${m.type === "DESCARGA" || Number(m.amount) < 0 ? "is-neg" : "is-pos"}`} style={m.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                          <div className="saldo-card-body">
                            <div className="saldo-card-top">
                              <div className="saldo-name">{TIPO_LABEL[m.type] ?? m.type}</div>
                              <div className={`saldo-big ${m.type === "DESCARGA" || Number(m.amount) < 0 ? "neg" : "pos"}`}>{montoMovSup(m)}</div>
                            </div>
                            <div className="saldo-card-mid">
                              <div className="saldo-sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                {m.status === "REVERTIDO" ? <span className="pill r">Revertido</span> : <span className="pill g">Aplicado</span>}
                                {dateShort(m.occurred_at)} · {m.club_name}{m.agent_name ? ` · ${m.agent_name}` : ""}
                              </div>
                              {m.status !== "REVERTIDO" && <ActionsMenu items={[{ label: "Revertir", onClick: () => onRevertirMovimiento(m.id), danger: true }]} />}
                            </div>
                            {m.notes && <div className="saldo-card-foot"><span style={{ fontSize: 12 }}>{m.notes.length > 90 ? `${m.notes.slice(0, 90)}…` : m.notes}</span></div>}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                      Mostrando {movsVisibles.length} de {movimientos.length}
                      {!verRevertidos && movimientos.length > movsVisibles.length ? ` · ${movimientos.length - movsVisibles.length} revertido${movimientos.length - movsVisibles.length === 1 ? "" : "s"} oculto${movimientos.length - movsVisibles.length === 1 ? "" : "s"}` : ""}.
                    </div>
                  </>
                )}
              </>
            )}

            {tabDet === "origen" && (
              <>
                <h4 style={{ margin: "0 0 4px" }}>Cómo se compone el saldo</h4>
                {!migracion ? (
                  <Loading />
                ) : migracion.length === 0 ? (
                  <div className="muted">Todavía no se migró ningún saldo histórico a esta cuenta.</div>
                ) : (
                  <>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                      Saldo histórico que se trajo de cada agente al activar la cuenta consolidada (una sola vez, al arrancar) --
                      de acá en más el saldo solo cambia con "+ Carga / Descarga / Ajuste" y con el cierre semanal.
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table>
                        <thead><tr><th>Agente</th><th>Club</th><th className="num">Fichas migradas</th><th className="num">Pendiente migrado</th><th>Fecha</th></tr></thead>
                        <tbody>
                          {migracion.map((m) => (
                            <tr key={m.id} title={m.notes || undefined}>
                              <td>{m.agent_name}</td>
                              <td className="muted">{m.club_name ?? "—"}</td>
                              <td className="num">{usd(Number(m.fichas_migradas))}</td>
                              <td className="num">{usd(Number(m.pendiente_migrado))}</td>
                              <td className="muted">{dateShort(m.created_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ fontWeight: 600 }}>
                            <td colSpan={2}>Total</td>
                            <td className="num">{usd(migracion.reduce((s, m) => s + Number(m.fichas_migradas), 0))}</td>
                            <td className="num">{usd(migracion.reduce((s, m) => s + Number(m.pendiente_migrado), 0))}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showMovimiento && seleccionado && (
        <Modal title={`Movimiento — ${seleccionado.name}`} onClose={() => setShowMovimiento(false)}>
          <MovimientoForm
            supervisor={seleccionado}
            clubes={clubes}
            subordinados={subordinados ?? []}
            onDone={() => {
              setShowMovimiento(false);
              refrescarSeleccionado();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function MovimientoForm({
  supervisor,
  clubes,
  subordinados,
  onDone,
}: {
  supervisor: any;
  clubes: any[];
  subordinados: any[];
  onDone: () => void;
}) {
  const [type, setType] = useState<"CARGA" | "DESCARGA" | "AJUSTE">("CARGA");
  const [clubId, setClubId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [amount, setAmount] = useState("");
  const [campoAjuste, setCampoAjuste] = useState<"FICHAS" | "CUENTA_CORRIENTE">("CUENTA_CORRIENTE");
  const [usdtReal, setUsdtReal] = useState(false);
  const [notes, setNotes] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!clubId) return setMsg({ ok: false, text: "El club es obligatorio." });
    if (supervisor.exigir_agente_en_movimientos && !agentId) {
      return setMsg({ ok: false, text: "Este supervisor exige indicar el agente de origen." });
    }
    const amountNum = Number(amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum === 0) return setMsg({ ok: false, text: "Importe inválido." });
    if (type !== "AJUSTE" && amountNum < 0) return setMsg({ ok: false, text: "Para Carga/Descarga el importe va siempre en positivo." });

    setLoading(true);
    try {
      await api.registrarMovimientoSupervisor(supervisor.id, {
        clubId,
        agentId: agentId || null,
        type,
        amount: amountNum,
        campoAjuste: type === "AJUSTE" ? campoAjuste : undefined,
        usdtReal,
        notes: notes.trim() || null,
        paymentLink: paymentLink.trim() || null,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="CARGA">Carga (fichas +, cuenta corriente −)</option>
            <option value="DESCARGA">Descarga (resta primero de cuenta corriente, después de fichas)</option>
            <option value="AJUSTE">Ajuste manual</option>
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
          <label>Agente {supervisor.exigir_agente_en_movimientos ? "" : "(opcional, informativo)"}</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{supervisor.exigir_agente_en_movimientos ? "Elegir..." : "— Ninguno —"}</option>
            {subordinados.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Nunca genera saldo propio para ese agente -- solo queda como dato de a quién correspondía el movimiento.
          </div>
        </div>
        {type === "AJUSTE" && (
          <div className="field">
            <label>Aplicar a</label>
            <select value={campoAjuste} onChange={(e) => setCampoAjuste(e.target.value as any)}>
              <option value="CUENTA_CORRIENTE">Cuenta corriente</option>
              <option value="FICHAS">Fichas reales</option>
            </select>
          </div>
        )}
        <div className="field">
          <label>Importe (USD){type === "AJUSTE" ? " -- puede ser negativo" : ""}</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === "AJUSTE" ? "Ej: -50" : "Ej: 600"} />
        </div>
        {type !== "AJUSTE" && (
          <div className="field">
            <label>
              <input type="checkbox" checked={usdtReal} onChange={(e) => setUsdtReal(e.target.checked)} style={{ marginRight: 6 }} />
              Hubo transferencia real de USDT
            </label>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Esto es solo una reclasificación interna entre fichas y cuenta corriente -- NO toca Wallet Manos salvo
              que tildes esto (además existió una entrada/salida real de USDT: {type === "CARGA" ? "ingreso" : "egreso"} en Wallet Manos por el mismo importe).
            </div>
          </div>
        )}
        <div className="field">
          <label>Observación</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="field">
          <label>Link de pago (opcional)</label>
          <input value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} placeholder="usdt.tx/..." />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar"}</button>
    </form>
  );
}

// Fila de resolución de una solicitud de retiro pendiente (ver panel "Solicitudes de retiro
// pendientes" más arriba) -- mismo mecanismo de siempre (registrarMovimientoSupervisor DESCARGA
// usdtReal=true vía marcarSolicitudRetiroEnviada en repo/supervisores.ts), con el link de pago
// quedando asentado para que el supervisor lo vea en su propio historial.
function SolicitudRetiroRow({
  solicitud,
  clubes,
  onDone,
}: {
  solicitud: any;
  clubes: any[];
  onDone: () => void;
}) {
  const [clubId, setClubId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [subordinados, setSubordinados] = useState<any[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (solicitud.exigir_agente_en_movimientos) {
      api.subordinadosSupervisor(solicitud.supervisor_agent_id).then(setSubordinados);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitud.supervisor_agent_id]);

  async function onEnviar() {
    setMsg(null);
    if (!clubId) return setMsg({ ok: false, text: "Elegí el club." });
    if (solicitud.exigir_agente_en_movimientos && !agentId) {
      return setMsg({ ok: false, text: "Este supervisor exige indicar el agente de origen." });
    }
    if (!paymentLink.trim()) return setMsg({ ok: false, text: "Pegá el link de pago." });
    setEnviando(true);
    try {
      await api.marcarSolicitudRetiroEnviada(solicitud.id, {
        clubId,
        agentId: agentId || null,
        paymentLink: paymentLink.trim(),
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo marcar como enviado." });
    } finally {
      setEnviando(false);
    }
  }

  async function onRechazar() {
    const motivo = prompt(
      `¿Rechazar la solicitud de ${usd(Number(solicitud.amount))} de ${solicitud.supervisor_name}? Motivo (opcional):`
    );
    if (motivo === null) return;
    setRechazando(true);
    try {
      await api.rechazarSolicitudRetiro(solicitud.id, motivo || undefined);
      onDone();
    } catch (err: any) {
      alert(err.message || "No se pudo rechazar la solicitud.");
    } finally {
      setRechazando(false);
    }
  }

  return (
    <tr className="fila-pendiente">
      <td style={{ fontWeight: 600 }}>{solicitud.supervisor_name}</td>
      <td><span className="badge neutral">{usd(Number(solicitud.amount))}</span></td>
      <td className="muted" style={{ fontSize: 12.5 }}>{solicitud.nota || "—"}</td>
      <td className="muted">{dateShort(solicitud.requested_at)}</td>
      <td style={{ minWidth: 380 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)} style={{ fontSize: 12.5 }}>
            <option value="">Club...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {solicitud.exigir_agente_en_movimientos && (
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ fontSize: 12.5 }}>
              <option value="">Agente...</option>
              {(subordinados ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
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
