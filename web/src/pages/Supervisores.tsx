import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";
import Loading from "../components/Loading";
import ActionsMenu from "../components/ActionsMenu";
import { generarPdfCuentasAgentes, type ContenidoPdf, type FormatoPdf } from "../pdfCuentasAgentes";
import Ayuda from "../components/Ayuda";

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
  PAGO: "Pago USDT",
  COBRO: "Cobro USDT",
  DESCUENTO: "Descuento",
};
// Salida de plata de la cuenta (Descarga y Pago) vs entrada (Carga y Cobro): define color y signo en el historial.
const esSalidaSup = (m: any): boolean => m.type === "DESCARGA" || m.type === "PAGO" || m.type === "DESCUENTO";

// modo "AGENTES" (20/10/2026, pedido de Leo: "crearia la seccion Agentes"): misma pantalla y mismo motor, pero para
// agentes individuales -- el titular de la cuenta es el propio agente (sin "Agentes a cargo", sin retiros de portal).
export default function Supervisores({ modo = "SUPERVISORES" }: { modo?: "SUPERVISORES" | "AGENTES" }) {
  const agentesModo = modo === "AGENTES";
  const [supervisores, setSupervisores] = useState<any[] | null>(null);
  const [showActivar, setShowActivar] = useState(false);
  const [showDescuento, setShowDescuento] = useState(false);
  // Descargar PDF (sección Agentes): null = cerrado; "todos" = de todas las cuentas; un id = de esa cuenta.
  const [pdfPara, setPdfPara] = useState<string | null>(null);
  // Tipo con el que se abre el formulario de movimiento (botones Cargar / Descargar / + Ajuste de la cuenta de un agente).
  const [movTipoInicial, setMovTipoInicial] = useState<"CARGA" | "DESCARGA" | "AJUSTE" | null>(null);
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
  const [pagoCobro, setPagoCobro] = useState<"PAGO" | "COBRO" | null>(null);
  // Importar saldos de los agentes a cargo (20/10/2026): propuesta por agente + modal.
  const [importables, setImportables] = useState<any[] | null>(null);
  const [showImportar, setShowImportar] = useState(false);
  // Ocultar/mostrar un agente de "Agentes a cargo" (01/10/2026, pedido de Leo, caso Uriel):
  // puramente visual, nunca mueve plata -- ver nota en schema.sql / repo/catalog.ts. Arranca
  // colapsado (false) para no mostrar de entrada una lista larga de ocultos.
  const [mostrarOcultos, setMostrarOcultos] = useState(false);
  const [ocultando, setOcultando] = useState<string | null>(null);
  const [tabDet, setTabDet] = useState<"resumen" | "cierre" | "agentes" | "movs" | "origen">("resumen");
  const [verRevertidos, setVerRevertidos] = useState(false);
  // Desglose por club de cada agente en el cierre semanal (19/10/2026, pedido de Leo: igual que en Mi supervisión).
  const [cierreAbiertos, setCierreAbiertos] = useState<Set<string>>(new Set());

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
    (agentesModo ? api.cuentasAgentes() : api.supervisoresConsolidados()).then(setSupervisores).catch((e) => setError(e.message));
  }

  function refreshSolicitudes() {
    if (agentesModo) return setSolicitudes([]);
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
    setImportables(null);
    api.previsualizarImportacionSaldos(s.id).then(setImportables).catch(() => setImportables([]));
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
          (esWinLose(seleccionado) ? `Esto suma ${usd(cierreSemana.totalCierre)} a Cuenta corriente (el cierre completo de los agentes). ` : `Esto suma ${usd(cierreSemana.resultadoTotal)} a Fichas reales y ${usd(cierreSemana.rakebackTotal)} a Cuenta corriente. `) +
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
        (esWinLose(seleccionado) ? `Esto resta ${usd(Number(cierreSemana.aplicado.rakeback_total))} a Cuenta corriente ` : `Esto resta ${usd(Number(cierreSemana.aplicado.resultado_total))} a Fichas reales y ${usd(Number(cierreSemana.aplicado.rakeback_total))} a Cuenta corriente `) +
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
        No se pudo cargar {agentesModo ? "Agentes" : "Supervisores"}: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!supervisores) return <Loading />;

  // ---- Pantalla (19/10/2026, mockup aprobado): lista ordenada por saldo y cuenta en pestañas ----
  const saldoTotalSup = (s: any) => Number(s.fichas_reales) + Number(s.cuenta_corriente);
  // Supervisor Win/Lose (20/10/2026): una sola cuenta (cuenta corriente), sin fichas reales ni Carga/Descarga.
  const esWinLose = (s: any) => s?.default_system === "WIN_LOSE";
  const montoSignoSup = (n: number, centavos = false) => {
    const v = centavos ? Math.round(Math.abs(n) * 100) / 100 : Math.abs(n);
    const txt = centavos
      ? `US$ ${v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : usd(v);
    return `${n < -0.004 ? "−" : ""}${txt}`;
  };
  const montoMovSup = (m: any) => {
    const a = Number(m.amount);
    const signo = esSalidaSup(m) ? "−" : a < 0 ? "−" : a > 0 ? "+" : "";
    return `${signo}${montoSignoSup(Math.abs(a), true).replace("−", "")}`;
  };
  const supervisoresOrdenados = [...(supervisores ?? [])].sort((a, b) => Math.abs(saldoTotalSup(b)) - Math.abs(saldoTotalSup(a)));
  // Secciones separadas (20/10/2026, pedido de Leo, mockup aprobado): los Prepago (fichas reales + cuenta corriente) y los
  // Win/Lose (solo cuenta corriente) no se mezclan en una misma tabla ni en un mismo total.
  const supervisoresPrepago = supervisoresOrdenados.filter((x) => !esWinLose(x));
  const supervisoresWinLose = supervisoresOrdenados.filter((x) => esWinLose(x));
  const estadoWinLose = (n: number) => (n < -0.004 ? "El grupo nos debe" : n > 0.004 ? "Le debemos" : "Al día");
  const cantAgentesTxt = (n: number | null | undefined) => (n != null ? `${n} agente${n === 1 ? "" : "s"} a cargo` : "");
  // En la sección Agentes no hay agentes a cargo: se muestra el sistema de la cuenta.
  const subTxt = (x: any) => (agentesModo ? (esWinLose(x) ? "Win/Lose" : "Prepago") : cantAgentesTxt(x.n_sub));
  const quien = agentesModo ? "Agente" : "Supervisor";
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
          <h2>{agentesModo ? "Agentes" : "Supervisores"} <Ayuda>{agentesModo
              ? "Cuenta de cada agente individual: el cierre completo de cada semana, los descuentos del cierre, y los pagos y cobros en USDT. Reemplaza a Liquidaciones para los agentes que se activan acá."
              : "Cuenta consolidada: un supervisor con cuenta consolidada activada (ver Administración → editar agente) junta en un único saldo todo lo de los agentes que le reportan -- esos agentes dejan de acumular saldo propio."}</Ayuda></h2>
        </div>
        {agentesModo && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={() => setPdfPara("todos")}>Descargar PDF</button>
            <button className="btn" onClick={() => setShowActivar(true)}>+ Activar cuenta de un agente</button>
          </div>
        )}
        {!agentesModo && solicitudes && solicitudes.length === 0 && <span className="pill">Sin solicitudes de retiro</span>}
      </div>

      {solicitudes && solicitudes.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--gold)" }}>
          <h3>Solicitudes de retiro pendientes <Ayuda>Lo que piden los supervisores desde "Mi Supervisión". Al marcarla como enviada se
            registra la Descarga de siempre en su historial (misma mecánica que + Carga / Descarga /
            Ajuste) con el link de pago asentado, para que puedan ver el trackeo reflejado en su
            propio historial.</Ayuda></h3>
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
            {agentesModo
              ? "Todavía no hay ninguna cuenta de agente. Activá la primera con el botón de arriba."
              : "Todavía no hay ningún supervisor con \"Usa cuenta consolidada\" activado. Se activa editando un agente desde Administración."}
          </div>
        </div>
      ) : (
        <>
          {supervisoresPrepago.length > 0 && (
            <>
              <div style={{ margin: "22px 0 8px", display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 17 }}>{agentesModo ? "Agentes Prepago" : "Supervisores Prepago"}</h3>
                <span className="pill">{supervisoresPrepago.length} cuenta{supervisoresPrepago.length === 1 ? "" : "s"}</span>
              </div>
              <div className="muted" style={{ margin: "0 0 10px", fontSize: 12.5 }}>Fichas reales (lo que compraron sus agentes) y cuenta corriente (rakeback).</div>
              <div className="stat-row">
                <div className="stat-card">
                  <div className="l">Saldo total</div>
                  <div className="v">{montoSignoSup(supervisoresPrepago.reduce((acc, x) => acc + saldoTotalSup(x), 0))}</div>
                  <div className="s">fichas reales + cuenta corriente</div>
                </div>
                <div className="stat-card">
                  <div className="l">Fichas reales</div>
                  <div className="v">{montoSignoSup(supervisoresPrepago.reduce((acc, x) => acc + Number(x.fichas_reales), 0))}</div>
                  <div className="s">suma de las cuentas</div>
                </div>
                <div className="stat-card">
                  <div className="l">Cuenta corriente</div>
                  <div className="v">{montoSignoSup(supervisoresPrepago.reduce((acc, x) => acc + Number(x.cuenta_corriente), 0))}</div>
                  <div className="s">suma de las cuentas</div>
                </div>
              </div>

              <div className="panel">
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr><th>{quien}</th><th className="num">Fichas reales</th><th className="num">Cuenta corriente</th><th className="num">Saldo total</th><th></th></tr>
                    </thead>
                    <tbody>
                      {supervisoresPrepago.map((x) => {
                        const total = saldoTotalSup(x);
                        return (
                          <tr
                            key={x.id}
                            className={`row-click ${total > 0 ? "row-pos" : total < 0 ? "row-neg" : ""}`}
                            style={seleccionado?.id === x.id ? { outline: "1px solid var(--accent)", outlineOffset: -1 } : undefined}
                            onClick={() => abrirSupervisor(x)}
                          >
                            <td>
                              <div className="saldo-name">{x.name}</div>
                              <div className="saldo-sub">{subTxt(x)}</div>
                            </td>
                            <td className="num money">{montoSignoSup(Number(x.fichas_reales))}</td>
                            <td className="num money">{montoSignoSup(Number(x.cuenta_corriente))}</td>
                            <td className="num"><span className={`saldo-big ${total > 0 ? "pos" : total < 0 ? "neg" : "neutral"}`}>{montoSignoSup(total)}</span></td>
                            <td style={{ width: 100, textAlign: "right" }}>
                              <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); abrirSupervisor(x); }}>Ver cuenta</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="ag-cards">
                  {supervisoresPrepago.map((x) => {
                    const total = saldoTotalSup(x);
                    return (
                      <div
                        key={x.id}
                        className={`saldo-card ${total > 0 ? "is-pos" : total < 0 ? "is-neg" : ""}`}
                        style={seleccionado?.id === x.id ? { boxShadow: "0 0 0 1px var(--accent)" } : undefined}
                        onClick={() => abrirSupervisor(x)}
                      >
                        <div className="saldo-card-body">
                          <div className="saldo-card-top">
                            <div className="saldo-name">{x.name}</div>
                            <div className={`saldo-big ${total > 0 ? "pos" : total < 0 ? "neg" : "neutral"}`}>{montoSignoSup(total)}</div>
                          </div>
                          <div className="saldo-card-mid">
                            <div className="saldo-sub">{subTxt(x)}</div>
                          </div>
                          <div className="saldo-card-foot" style={{ gap: 16 }}>
                            <span>Fichas reales <b>{montoSignoSup(Number(x.fichas_reales))}</b></span>
                            <span>Cuenta corriente <b>{montoSignoSup(Number(x.cuenta_corriente))}</b></span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {supervisoresWinLose.length > 0 && (
            <>
              <div style={{ margin: "22px 0 8px", display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 17 }}>{agentesModo ? "Agentes Win/Lose" : "Supervisores Win/Lose"}</h3>
                <span className="pill">{supervisoresWinLose.length} cuenta{supervisoresWinLose.length === 1 ? "" : "s"}</span>
              </div>
              <div className="muted" style={{ margin: "0 0 10px", fontSize: 12.5 }}>{agentesModo ? "Una sola cuenta corriente por agente: el cierre completo de cada semana, que se salda con cobros y pagos en USDT." : "Una sola cuenta: el cierre completo de sus agentes, que se salda con cobros y pagos en USDT."}</div>
              <div className="stat-row">
                <div className="stat-card">
                  <div className="l">Cuenta corriente</div>
                  <div className="v">{montoSignoSup(supervisoresWinLose.reduce((acc, x) => acc + Number(x.cuenta_corriente), 0))}</div>
                  <div className="s">suma de las cuentas</div>
                </div>
                {!agentesModo && (
                  <div className="stat-card">
                    <div className="l">Agentes a cargo</div>
                    <div className="v">{supervisoresWinLose.reduce((acc, x) => acc + Number(x.n_sub ?? 0), 0)}</div>
                    <div className="s">Win/Lose</div>
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr><th>{quien}</th><th className="num">Cuenta corriente</th><th>Estado</th><th></th></tr>
                    </thead>
                    <tbody>
                      {supervisoresWinLose.map((x) => {
                        const cc = Number(x.cuenta_corriente);
                        return (
                          <tr
                            key={x.id}
                            className={`row-click ${cc > 0 ? "row-pos" : cc < 0 ? "row-neg" : ""}`}
                            style={seleccionado?.id === x.id ? { outline: "1px solid var(--accent)", outlineOffset: -1 } : undefined}
                            onClick={() => abrirSupervisor(x)}
                          >
                            <td>
                              <div className="saldo-name">{x.name}</div>
                              <div className="saldo-sub">{subTxt(x)}</div>
                            </td>
                            <td className="num"><span className={`saldo-big ${cc > 0 ? "pos" : cc < 0 ? "neg" : "neutral"}`}>{montoSignoSup(cc)}</span></td>
                            <td className="muted" style={{ fontSize: 12.5 }}>{estadoWinLose(cc)}</td>
                            <td style={{ width: 100, textAlign: "right" }}>
                              <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); abrirSupervisor(x); }}>Ver cuenta</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="ag-cards">
                  {supervisoresWinLose.map((x) => {
                    const cc = Number(x.cuenta_corriente);
                    return (
                      <div
                        key={x.id}
                        className={`saldo-card ${cc > 0 ? "is-pos" : cc < 0 ? "is-neg" : ""}`}
                        style={seleccionado?.id === x.id ? { boxShadow: "0 0 0 1px var(--accent)" } : undefined}
                        onClick={() => abrirSupervisor(x)}
                      >
                        <div className="saldo-card-body">
                          <div className="saldo-card-top">
                            <div className="saldo-name">{x.name}</div>
                            <div className={`saldo-big ${cc > 0 ? "pos" : cc < 0 ? "neg" : "neutral"}`}>{montoSignoSup(cc)}</div>
                          </div>
                          <div className="saldo-card-mid">
                            <div className="saldo-sub">{subTxt(x)} · {estadoWinLose(cc)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {seleccionado && (
        <div id="cuenta-supervisor">
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div className="deals-eyebrow">{agentesModo ? "Cuenta del agente" : "Cuenta consolidada"}</div>
                <div style={{ fontSize: 22, fontWeight: 750, letterSpacing: "-0.01em" }}>{seleccionado.name}</div>
                <div className="saldo-sub">
                  {esWinLose(seleccionado) ? "Win/Lose" : seleccionado.modelo_cuenta === "PREPAGO" ? "Prepago" : seleccionado.modelo_cuenta ?? "—"}
                  {!agentesModo && subordinados ? ` · ${subordinados.length} agente${subordinados.length === 1 ? "" : "s"} a cargo` : ""}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button className="btn" onClick={() => setPagoCobro("PAGO")}>Pagar</button>
                <button className="btn secondary" onClick={() => setPagoCobro("COBRO")}>Cobrar</button>
                {agentesModo && !esWinLose(seleccionado) && (
                  <>
                    <button className="btn" onClick={() => { setMovTipoInicial("CARGA"); setShowMovimiento(true); }}>Cargar</button>
                    <button className="btn" onClick={() => { setMovTipoInicial("DESCARGA"); setShowMovimiento(true); }}>Descargar</button>
                  </>
                )}
                {agentesModo && <button className="btn secondary" onClick={() => setShowDescuento(true)}>+ Descuento</button>}
                {agentesModo && <button className="btn secondary" onClick={() => setPdfPara(seleccionado.id)}>PDF</button>}
                <button className="btn secondary" onClick={() => { setMovTipoInicial(agentesModo ? "AJUSTE" : null); setShowMovimiento(true); }}>
                  {esWinLose(seleccionado) || agentesModo ? "+ Ajuste" : "+ Carga / Descarga / Ajuste"}
                </button>
                <button className="btn secondary" onClick={() => setShowImportar(true)} title={agentesModo ? "Traer a esta cuenta el saldo que el agente tiene hoy" : "Traer a esta cuenta el saldo que ya tienen sus agentes"}>
                  {agentesModo ? "Importar saldo" : "Importar saldos"}{importables && importables.filter((f) => f.estado === "NUEVO").length > 0 ? ` (${importables.filter((f) => f.estado === "NUEVO").length})` : ""}
                </button>
                <button className="icon-btn" title="Cerrar la cuenta" onClick={() => setSeleccionado(null)}>✕</button>
              </div>
            </div>
            {esWinLose(seleccionado) ? (
              <div style={{ marginTop: 14 }}>
                <div className="saldo-sub" style={{ margin: 0 }}>
                  {Number(seleccionado.cuenta_corriente) < -0.004 ? (agentesModo ? "Cuenta corriente · el agente nos debe" : "Cuenta corriente · el grupo nos debe") : Number(seleccionado.cuenta_corriente) > 0.004 ? "Cuenta corriente · le debemos" : "Cuenta corriente"}
                </div>
                <div className={`saldo-big ${Number(seleccionado.cuenta_corriente) > 0 ? "pos" : Number(seleccionado.cuenta_corriente) < 0 ? "neg" : "neutral"}`} style={{ fontSize: 30 }}>
                  {montoSignoSup(Number(seleccionado.cuenta_corriente), true)}
                </div>
              </div>
            ) : (
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
            )}
          </div>

          <div className="panel">
            <div className="ag-toolbar" style={{ marginBottom: 12 }}>
              <span className="seg tabs-scroll" style={{ overflowX: "auto", maxWidth: "100%" }}>
                <button className={tabDet === "resumen" ? "on" : ""} onClick={() => setTabDet("resumen")}>Resumen</button>
                <button className={tabDet === "cierre" ? "on" : ""} onClick={() => setTabDet("cierre")}>Cierre semanal</button>
                {!agentesModo && <button className={tabDet === "agentes" ? "on" : ""} onClick={() => setTabDet("agentes")}>Agentes a cargo{subordinados && <span className="n">{subordinados.length}</span>}</button>}
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
                {agentesModo && !esWinLose(seleccionado) && (() => {
                  const mio = saldosPorAgente?.find((x) => x.agentId === seleccionado.id);
                  const clubesAg: any[] = mio?.detallePorClub ?? [];
                  const totalClubes = Math.round(clubesAg.reduce((acc, c) => acc + Number(c.fichas), 0) * 100) / 100;
                  const desfasado = Math.abs(totalClubes - Number(seleccionado.fichas_reales)) > 0.01;
                  return (
                    <>
                      <h4 style={{ margin: "0 0 4px" }}>Fichas por club <Ayuda>Lo que el agente tiene en cada club: cargas y descargas + resultado de mesas. Suman el total de Fichas reales de arriba.</Ayuda></h4>
                      {!saldosPorAgente ? <Loading /> : clubesAg.length === 0 ? (
                        <div className="muted" style={{ marginBottom: 14 }}>Todavía no tiene fichas en ningún club.</div>
                      ) : (
                        <div className="ag-table-wrap" style={{ marginBottom: 14 }}>
                          <table className="saldos-table">
                            <thead><tr><th>Club</th><th className="num">Cargas y descargas</th><th className="num">Resultado de mesas</th><th className="num">Fichas en el club</th></tr></thead>
                            <tbody>
                              {clubesAg.map((c) => (
                                <tr key={c.clubId} className={Number(c.fichas) > 0.004 ? "row-pos" : Number(c.fichas) < -0.004 ? "row-neg" : ""}>
                                  <td><div className="saldo-name">{c.clubName}</div></td>
                                  <td className="num money">{montoSignoSup(Number(c.balance), true)}</td>
                                  <td className="num money">{montoSignoSup(Number(c.mesas), true)}</td>
                                  <td className="num"><span className={`saldo-big ${Number(c.fichas) > 0.004 ? "pos" : Number(c.fichas) < -0.004 ? "neg" : "neutral"}`}>{montoSignoSup(Number(c.fichas), true)}</span></td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr style={{ fontWeight: 700 }}>
                                <td>Total</td>
                                <td className="num">{montoSignoSup(clubesAg.reduce((acc, c) => acc + Number(c.balance), 0), true)}</td>
                                <td className="num">{montoSignoSup(clubesAg.reduce((acc, c) => acc + Number(c.mesas), 0), true)}</td>
                                <td className="num">{montoSignoSup(totalClubes, true)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                      {saldosPorAgente && desfasado && (
                        <div className="warnbox" style={{ marginBottom: 14 }}>
                          El total por club ({montoSignoSup(totalClubes, true)}) no coincide con Fichas reales de la cuenta ({montoSignoSup(Number(seleccionado.fichas_reales), true)}).
                          Si la cuenta es nueva, falta traer el saldo con "Importar saldo".
                        </div>
                      )}
                    </>
                  );
                })()}
                <h4 style={{ margin: "0 0 4px" }}>{agentesModo ? "Saldo de la cuenta" : esWinLose(seleccionado) ? "Cuenta corriente por agente" : "Fichas en tiempo real por agente"} <Ayuda>{agentesModo
                    ? "Saldo importado + cierres semanales aplicados + descuentos, pagos, cobros y ajustes. Coincide, centavo a centavo, con el saldo de arriba."
                    : `Cada Carga/Descarga/Ajuste que se registre con un agente elegido se suma o resta acá, en su fila. El total coincide, centavo a centavo, con el saldo de arriba: es el mismo saldo de ${seleccionado.name}, repartido por agente.`}</Ayuda></h4>
                {!saldosPorAgente ? (
                  <Loading />
                ) : saldosPorAgente.length === 0 ? (
                  <div className="muted">Ningún agente tiene "Supervisor" = "{seleccionado.name}" todavía.</div>
                ) : (
                  <>
                    <div className="ag-table-wrap">
                      <table className="saldos-table">
                        <thead>
                          <tr><th>Agente</th>{!esWinLose(seleccionado) && <th className="num">Fichas en tiempo real</th>}<th className="num">Cuenta corriente</th>{!esWinLose(seleccionado) && <th className="num">Saldo real</th>}</tr>
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
                                  {!esWinLose(seleccionado) && <td className="num money">{montoSignoSup(Number(s.fichasTiempoReal), true)}</td>}
                                  {esWinLose(seleccionado) ? (
                                    <td className="num"><span className={`saldo-big ${saldo > 0.004 ? "pos" : saldo < -0.004 ? "neg" : "neutral"}`}>{montoSignoSup(Number(s.cuentaCorriente), true)}</span></td>
                                  ) : (
                                    <td className="num money">{montoSignoSup(Number(s.cuentaCorriente), true)}</td>
                                  )}
                                  {!esWinLose(seleccionado) && <td className="num"><span className={`saldo-big ${saldo > 0.004 ? "pos" : saldo < -0.004 ? "neg" : "neutral"}`}>{montoSignoSup(saldo, true)}</span></td>}
                                </tr>
                                {multiClub && expandido && (
                                  <tr>
                                    <td colSpan={esWinLose(seleccionado) ? 2 : 4} style={{ background: "var(--panel-2)", padding: "10px 16px 14px 36px", borderLeft: "3px solid var(--gold)" }}>
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
                            {!esWinLose(seleccionado) && <td className="num">{montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.fichasTiempoReal), 0), true)}</td>}
                            <td className="num">{montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.cuentaCorriente), 0), true)}</td>
                            {!esWinLose(seleccionado) && <td className="num">{montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.saldoReal), 0), true)}</td>}
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
                                {!esWinLose(seleccionado) && <span>Fichas <b>{montoSignoSup(Number(s.fichasTiempoReal))}</b></span>}
                                <span>Cuenta corriente <b>{montoSignoSup(Number(s.cuentaCorriente))}</b></span>
                              </div>
                              {multiClub && expandido && <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 10 }}>{detalleClubesAgente(s)}</div>}
                            </div>
                          </div>
                        );
                      })}
                      <div className="muted" style={{ fontSize: 12 }}>
                        Total: {esWinLose(seleccionado) ? null : <>fichas {montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.fichasTiempoReal), 0), true)} · </>}cuenta corriente {montoSignoSup(saldosPorAgente.reduce((s, a) => s + Number(a.cuentaCorriente), 0), true)}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {tabDet === "cierre" && (
              <>
                <h4 style={{ margin: "0 0 4px" }}>{agentesModo ? "Cierre semanal" : "Cierre semanal de agentes a cargo"} <Ayuda>{esWinLose(seleccionado)
                    ? "Trae el cierre semanal ya cargado de cada agente a cargo: el cierre COMPLETO (resultado de mesas + rakeback + rebate) se suma a Cuenta corriente -- esta cuenta es Win/Lose y no tiene fichas reales. El saldo propio del agente no se toca, esto es un espejo automático aparte. Se puede aplicar una sola vez por semana."
                    : "Trae el cierre semanal ya cargado de cada agente a cargo: las fichas ganadas en mesas se suman a Fichas reales, y el rakeback generado se suma a Cuenta corriente -- el saldo propio del agente sigue acumulando igual que siempre, esto es un espejo automático aparte. Se puede aplicar una sola vez por semana."}</Ayuda></h4>
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
                              setCierreAbiertos(new Set());
                              cargarCierreSemana(seleccionado.id, ws);
                            }}
                          >
                            {dateShort(s.week_start)} al {dateShort(s.week_end)}
                          </button>
                        );
                      })}
                    </div>
                    {cierreSemana?.agentesYaIncluidosEnSaldo?.length > 0 && (
                      <div className="warnbox" style={{ marginBottom: 10 }}>
                        Esta semana no suma el cierre de {cierreSemana.agentesYaIncluidosEnSaldo.join(", ")}: ya está dentro del saldo que se importó de {cierreSemana.agentesYaIncluidosEnSaldo.length === 1 ? "ese agente" : "esos agentes"}.
                      </div>
                    )}
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
                      <span style={{ flex: 1 }} />
                      {cierreSemana?.lineas?.length > 0 && (
                        <a
                          style={{ fontSize: 12.5, color: "var(--accent)", cursor: "pointer" }}
                          onClick={() => {
                            const todas = cierreSemana.lineas.every((l: any) => cierreAbiertos.has(l.agent_id));
                            setCierreAbiertos(todas ? new Set() : new Set(cierreSemana.lineas.map((l: any) => l.agent_id)));
                          }}
                        >
                          {cierreSemana.lineas.every((l: any) => cierreAbiertos.has(l.agent_id)) ? "Contraer todo" : "Expandir todo"}
                        </a>
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
                                {esWinLose(seleccionado) ? (
                                  <>
                                    <th className="num">Resultado de mesas</th>
                                    <th className="num">Rakeback</th>
                                    <th className="num">Rebate y otros</th>
                                    <th className="num">Total</th>
                                  </>
                                ) : (
                                  <>
                                    <th className="num">Fichas ganadas en la semana</th>
                                    <th className="num">Rakeback generado en la semana</th>
                                  </>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {cierreSemana.lineas.map((l: any) => {
                                const abierto = cierreAbiertos.has(l.agent_id);
                                return (
                                  <Fragment key={l.agent_id}>
                                    <tr
                                      className="row-click"
                                      onClick={() =>
                                        setCierreAbiertos((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(l.agent_id)) next.delete(l.agent_id);
                                          else next.add(l.agent_id);
                                          return next;
                                        })
                                      }
                                    >
                                      <td><div className="saldo-name"><span style={{ color: "var(--text-faint)", marginRight: 6 }}>{abierto ? "▾" : "▸"}</span>{l.agent_name}</div></td>
                                      <td className={`num ${Number(l.result) >= 0 ? "pos" : "neg"}`}>{montoSignoSup(Number(l.result), true)}</td>
                                      <td className="num">{usd(Number(l.rakeback))}</td>
                                      {esWinLose(seleccionado) && (
                                        <>
                                          <td className="num">{montoSignoSup(Number(l.total) - Number(l.result) - Number(l.rakeback), true)}</td>
                                          <td className={`num ${Number(l.total) >= 0 ? "pos" : "neg"}`}><b>{montoSignoSup(Number(l.total), true)}</b></td>
                                        </>
                                      )}
                                    </tr>
                                    {abierto && (
                                      <tr>
                                        <td colSpan={esWinLose(seleccionado) ? 5 : 3} style={{ background: "var(--panel-2)", padding: "10px 16px 14px 36px" }}>
                                          {(l.detalle ?? []).length === 0 ? (
                                            <div className="saldo-sub">Sin cierres cargados para este agente en esta semana.</div>
                                          ) : (
                                            <div style={{ overflowX: "auto" }}>
                                              <table style={{ margin: 0 }}>
                                                <thead>
                                                  <tr><th>Club</th><th>Sistema</th><th className="num">Jugadores</th><th className="num">Resultado de mesas</th><th className="num">Rake generado</th><th className="num">% rakeback</th><th className="num">Rakeback</th>{esWinLose(seleccionado) && <><th className="num">Rebate</th><th className="num">Total</th></>}</tr>
                                                </thead>
                                                <tbody>
                                                  {l.detalle.map((d: any) => (
                                                    <tr key={d.club_name}>
                                                      <td>{d.club_name}</td>
                                                      <td className="muted">{d.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                                                      <td className="num muted">{d.jugadores ?? "-"}</td>
                                                      <td className={`num ${Number(d.result) >= 0 ? "pos" : "neg"}`}>{montoSignoSup(Number(d.result), true)}</td>
                                                      <td className="num">{usd(Number(d.rake_total))}</td>
                                                      <td className="num muted">{Math.round(Number(d.rakeback_pct) * 10000) / 100}%</td>
                                                      <td className="num">{usd(Number(d.rakeback))}</td>
                                                      {esWinLose(seleccionado) && (
                                                        <>
                                                          <td className="num">{usd(Number(d.rebate))}</td>
                                                          <td className={`num ${Number(d.total) >= 0 ? "pos" : "neg"}`}><b>{montoSignoSup(Number(d.total), true)}</b></td>
                                                        </>
                                                      )}
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          )}
                                          <div className="saldo-sub" style={{ marginTop: 8 }}>
                                            {esWinLose(seleccionado) ? (
                                              <>Se suma a la cuenta corriente: <b>{montoSignoSup(Number(l.total), true)}</b></>
                                            ) : (
                                              <>Se suma a la cuenta: fichas reales <b>{montoSignoSup(Number(l.result), true)}</b> · cuenta corriente <b>{montoSignoSup(Number(l.rakeback), true)}</b></>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr style={{ fontWeight: 700 }}>
                                <td>Total de la semana</td>
                                <td className="num">{usd(cierreSemana.resultadoTotal)}</td>
                                <td className="num">{usd(cierreSemana.rakebackTotal)}</td>
                                {esWinLose(seleccionado) && (
                                  <>
                                    <td className="num">{montoSignoSup(Number(cierreSemana.totalCierre) - Number(cierreSemana.resultadoTotal) - Number(cierreSemana.rakebackTotal), true)}</td>
                                    <td className="num">{montoSignoSup(Number(cierreSemana.totalCierre), true)}</td>
                                  </>
                                )}
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
                              <td><span className={`pill ${esSalidaSup(m) ? "a" : m.type === "CARGA" || m.type === "COBRO" ? "g" : ""}`}>{TIPO_LABEL[m.type] ?? m.type}</span></td>
                              <td>
                                <div className="saldo-name" style={{ fontWeight: 600 }}>{m.club_name}</div>
                                <div className="saldo-sub">{m.agent_name ?? "sin agente"}{m.usdt_real ? " · USDT real" : ""}</div>
                              </td>
                              <td className="num"><span className={`saldo-big ${esSalidaSup(m) ? "neg" : Number(m.amount) < 0 ? "neg" : "pos"}`}>{montoMovSup(m)}</span></td>
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
                        <div key={m.id} className={`saldo-card ${esSalidaSup(m) || Number(m.amount) < 0 ? "is-neg" : "is-pos"}`} style={m.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                          <div className="saldo-card-body">
                            <div className="saldo-card-top">
                              <div className="saldo-name">{TIPO_LABEL[m.type] ?? m.type}</div>
                              <div className={`saldo-big ${esSalidaSup(m) || Number(m.amount) < 0 ? "neg" : "pos"}`}>{montoMovSup(m)}</div>
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

      {pagoCobro && seleccionado && (
        <Modal title={`${pagoCobro === "PAGO" ? "Pagar a" : "Cobrar a"} ${seleccionado.name}`} onClose={() => setPagoCobro(null)}>
          <PagoCobroForm
            tipo={pagoCobro}
            supervisor={seleccionado}
            subordinados={subordinados ?? []}
            sinAgente={agentesModo}
            onCancel={() => setPagoCobro(null)}
            onParcial={refrescarSeleccionado}
            onDone={() => {
              setPagoCobro(null);
              refrescarSeleccionado();
            }}
          />
        </Modal>
      )}

      {pdfPara && (
        <Modal title={pdfPara === "todos" ? "Descargar PDF — agentes" : `Descargar PDF — ${seleccionado?.name ?? ""}`} onClose={() => setPdfPara(null)}>
          <DescargarPdfForm soloId={pdfPara === "todos" ? null : pdfPara} onClose={() => setPdfPara(null)} />
        </Modal>
      )}

      {showActivar && (
        <Modal title="Activar cuenta de un agente" onClose={() => setShowActivar(false)}>
          <ActivarCuentaForm
            onCancel={() => setShowActivar(false)}
            onDone={(cuenta: any) => {
              setShowActivar(false);
              refresh();
              if (cuenta) abrirSupervisor(cuenta);
            }}
          />
        </Modal>
      )}

      {showDescuento && seleccionado && (
        <Modal title={`Descuento — ${seleccionado.name}`} onClose={() => setShowDescuento(false)}>
          <DescuentoForm
            supervisor={seleccionado}
            semanas={semanasCierre ?? []}
            semanaInicial={weekCierre}
            onCancel={() => setShowDescuento(false)}
            onDone={() => {
              setShowDescuento(false);
              refrescarSeleccionado();
            }}
          />
        </Modal>
      )}

      {showImportar && seleccionado && (
        <Modal title={`Importar saldos — ${seleccionado.name}`} onClose={() => setShowImportar(false)}>
          <ImportarSaldosForm
            supervisor={seleccionado}
            filas={importables}
            onCancel={() => setShowImportar(false)}
            onDone={() => {
              setShowImportar(false);
              refrescarSeleccionado();
              api.migracionHistoricaSupervisor(seleccionado.id).then(setMigracion);
              api.previsualizarImportacionSaldos(seleccionado.id).then(setImportables).catch(() => setImportables([]));
              api.semanasCierreSupervisor(seleccionado.id).then((r: any[]) => {
                setSemanasCierre(r);
                if (weekCierre) cargarCierreSemana(seleccionado.id, weekCierre);
              });
            }}
          />
        </Modal>
      )}

      {showMovimiento && seleccionado && (
        <Modal title={`Movimiento — ${seleccionado.name}`} onClose={() => setShowMovimiento(false)}>
          <MovimientoForm
            supervisor={seleccionado}
            clubes={clubes}
            subordinados={agentesModo ? [] : subordinados ?? []}
            tipoInicial={movTipoInicial}
            sinAgente={agentesModo}
            fichasPorClub={agentesModo ? (saldosPorAgente?.find((x) => x.agentId === seleccionado.id)?.detallePorClub ?? []) : []}
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

// Pagar / Cobrar (19/10/2026, pedido de Leo): USDT real contra la cuenta corriente del supervisor, sin club.
// PAGO = le mandamos USDT (resta de cuenta corriente, egreso de Wallet Manos); COBRO = nos manda USDT (suma a
// cuenta corriente, ingreso a Wallet Manos). Las fichas reales no se tocan. Ver registrarMovimientoSupervisor.
function PagoCobroForm({
  tipo,
  supervisor,
  subordinados,
  sinAgente,
  onDone,
  onParcial,
  onCancel,
}: {
  tipo: "PAGO" | "COBRO";
  supervisor: any;
  subordinados: any[];
  sinAgente?: boolean;
  onDone: () => void;
  onParcial?: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  // Varios agentes en un mismo pago/cobro (23/10/2026, pedido de Leo): agente tildado -> importe de ese agente. Cada uno se
  // registra como un movimiento propio con su etiqueta; todos mueven la misma cuenta corriente del titular.
  const [sel, setSel] = useState<Record<string, string>>({});
  const [paymentLink, setPaymentLink] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Win/Lose: Pagar/Cobrar es de todo el grupo junto, el agente es opcional (20/10/2026, pedido de Leo).
  const winLose = supervisor.default_system === "WIN_LOSE";
  const agenteObligatorio = !!supervisor.exigir_agente_en_movimientos && !winLose && !sinAgente;
  const fichas = Number(supervisor.fichas_reales);
  const cc = Number(supervisor.cuenta_corriente);
  const num = (v: string) => Number(String(v).replace(",", "."));
  const tildados = Object.keys(sel);
  const hayAgentes = tildados.length > 0;
  const montosAgentes = tildados.map((id) => num(sel[id]));
  const monto = hayAgentes ? Math.round(montosAgentes.reduce((t, n) => t + (Number.isFinite(n) && n > 0 ? n : 0), 0) * 100) / 100 : num(amount);
  const montoValido = hayAgentes ? montosAgentes.every((n) => Number.isFinite(n) && n > 0) : Number.isFinite(monto) && monto > 0;
  const signo = tipo === "PAGO" ? -1 : 1;
  const ccNuevo = montoValido ? Math.round((cc + signo * monto) * 100) / 100 : cc;
  const totalAntes = fichas + cc;
  const totalNuevo = fichas + ccNuevo;
  const fmt = (n: number) => `${n < -0.004 ? "−" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!montoValido) return setMsg({ ok: false, text: hayAgentes ? "Cada agente elegido necesita un importe mayor a 0." : "El importe tiene que ser mayor a 0." });
    if (agenteObligatorio && !hayAgentes) {
      return setMsg({ ok: false, text: "Este supervisor exige indicar el agente de origen." });
    }
    setLoading(true);
    // Un movimiento por agente, uno atrás del otro. Si alguno falla, los anteriores ya quedaron registrados: se sacan de la
    // selección y se avisa cuáles, para no repetirlos al reintentar.
    const destinos: (string | null)[] = hayAgentes ? tildados : [null];
    const hechos: string[] = [];
    try {
      for (const id of destinos) {
        await api.registrarMovimientoSupervisor(supervisor.id, {
          type: tipo,
          amount: id ? num(sel[id]) : monto,
          agentId: id,
          notes: notes.trim() || null,
          paymentLink: paymentLink.trim() || null,
        });
        if (id) hechos.push(id);
      }
      onDone();
    } catch (err: any) {
      const nombre = (id: string) => subordinados.find((a) => a.id === id)?.name ?? id;
      if (hechos.length > 0) {
        setSel((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !hechos.includes(id))));
        onParcial?.();
        setMsg({ ok: false, text: `Se registraron: ${hechos.map(nombre).join(", ")}. Falló el siguiente: ${err.message || "error desconocido"}. Los ya registrados se sacaron de la lista.` });
      } else {
        setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="saldo-sub" style={{ marginBottom: 12 }}>
        {tipo === "PAGO"
          ? "Le mandamos USDT: se resta de su cuenta corriente y sale de Wallet Manos."
          : "Nos manda USDT: se suma a su cuenta corriente y entra a Wallet Manos."}
      </div>
      {!hayAgentes && (
      <div className="field">
        <label>Importe (USDT)</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          inputMode="decimal"
          autoFocus
          style={{ fontSize: 24, fontWeight: 750 }}
        />
        {tipo === "PAGO" && (
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {cc > 0.004 && (
              <button type="button" className="chip" onClick={() => setAmount(String(cc))}>
                Pagar todo ({fmt(cc)})
              </button>
            )}
            <button type="button" className="chip" onClick={() => setAmount("500")}>500</button>
            <button type="button" className="chip" onClick={() => setAmount("1000")}>1.000</button>
          </div>
        )}
      </div>
      )}
      {!sinAgente && (
        <div className="field">
          <label>Agentes {agenteObligatorio ? "(elegí al menos uno)" : winLose ? "(opcional: si es de todo el grupo, no tildes ninguno)" : "(opcional: tildá uno o varios y poné el importe de cada uno)"}</label>
          <div className="pc-ags">
            {subordinados.map((a) => {
              const on = a.id in sel;
              const mv = Number(a.cc_agente ?? 0);
              return (
                <div key={a.id} className={`pc-ag ${on ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setSel((prev) => {
                      const n = { ...prev };
                      if (e.target.checked) n[a.id] = ""; else delete n[a.id];
                      return n;
                    })}
                    aria-label={`Elegir ${a.name}`}
                  />
                  <div>
                    <b>{a.name}</b>
                    <small>Su cuenta corriente: <b className={mv < -0.004 ? "neg" : mv > 0.004 ? "pos" : ""}>{fmt(mv)}</b></small>
                  </div>
                  <input
                    className="pc-imp"
                    value={on ? sel[a.id] : ""}
                    disabled={!on}
                    placeholder="0,00"
                    inputMode="decimal"
                    onChange={(e) => setSel((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  />
                </div>
              );
            })}
          </div>
          {hayAgentes && (
            <div className="pc-tot"><span className="muted">{tildados.length} agente{tildados.length === 1 ? "" : "s"} elegido{tildados.length === 1 ? "" : "s"}</span><b>Total {tipo === "PAGO" ? "a pagar" : "a cobrar"}: {fmt(monto)}</b></div>
          )}
        </div>
      )}
      <div className="field">
        <label>Link de pago (opcional)</label>
        <input value={paymentLink} onChange={(e) => setPaymentLink(e.target.value)} placeholder="usdt.tx/..." />
      </div>
      <div className="field">
        <label>Observación</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </div>
      <div className="panel" style={{ margin: "6px 0 12px", padding: "12px 14px", background: "var(--panel-2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
          <span className="muted">Cuenta corriente</span>
          <span>{fmt(cc)} → <b className={ccNuevo < -0.004 ? "neg" : ""}>{fmt(ccNuevo)}</b></span>
        </div>
        {!winLose && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span className="muted">Fichas reales</span>
              <span>{fmt(fichas)} <span className="muted">(sin cambios)</span></span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", borderTop: "1px solid var(--border)", marginTop: 4 }}>
              <b>Saldo total</b>
              <span>{fmt(totalAntes)} → <b className={totalNuevo > 0.004 ? "pos" : totalNuevo < -0.004 ? "neg" : ""}>{fmt(totalNuevo)}</b></span>
            </div>
          </>
        )}
      </div>
      {montoValido && ccNuevo < -0.004 && (
        <div className="warnbox" style={{ marginBottom: 10 }}>
          {tipo === "PAGO" ? "Supera su cuenta corriente: queda en negativo." : "La cuenta corriente queda en negativo."}
        </div>
      )}
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancelar</button>
        <button className="btn" disabled={loading || !montoValido}>
          {loading ? "Guardando..." : `Confirmar ${tipo === "PAGO" ? "pago" : "cobro"}${tildados.length > 1 ? "s (" + tildados.length + ")" : ""}`}
        </button>
      </div>
    </form>
  );
}

// Descargar PDF de las cuentas de agentes (sección Agentes, 20/10/2026, pedido de Leo): se elige qué baja (cierre
// semanal, estado de cuenta o todo junto), de qué semana, de qué agentes y si va todo en un solo PDF o uno por agente.
function DescargarPdfForm({ soloId, onClose }: { soloId: string | null; onClose: () => void }) {
  const [datos, setDatos] = useState<any | null>(null);
  const [semana, setSemana] = useState("");
  const [contenido, setContenido] = useState<ContenidoPdf>("TODO");
  const [formato, setFormato] = useState<FormatoPdf>(soloId ? "UNO" : "UNO");
  const [elegidos, setElegidos] = useState<Record<string, boolean> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    api.pdfDatosCuentasAgentes(semana || undefined)
      .then((d: any) => {
        if (!vivo) return;
        setDatos(d);
        if (!semana && d.semana) setSemana(d.semana);
        setElegidos((prev) => prev ?? Object.fromEntries(d.cuentas.map((c: any) => [c.agentId, soloId ? c.agentId === soloId : true])));
      })
      .catch((e: any) => vivo && setMsg({ ok: false, text: e.message || "No se pudieron cargar los datos." }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semana]);

  if (!datos || !elegidos) return msg ? <div className="error">{msg.text}</div> : <Loading />;

  const lista = datos.cuentas.filter((c: any) => !soloId || c.agentId === soloId);
  const sel = lista.filter((c: any) => elegidos[c.agentId]);
  const necesitaSemana = contenido !== "ESTADO";

  async function descargar() {
    setMsg(null);
    setLoading(true);
    try {
      const n = await generarPdfCuentasAgentes(sel, datos.semana ?? semana, datos.semanaFin ?? semana, contenido, formato);
      setMsg({ ok: true, text: n === 1 ? "PDF generado." : `${n} PDFs generados.` });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo generar el PDF." });
    } finally {
      setLoading(false);
    }
  }

  const opcion = (v: ContenidoPdf, t: string, d: string) => (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", cursor: "pointer" }}>
      <input type="radio" name="contenidoPdf" checked={contenido === v} onChange={() => setContenido(v)} style={{ marginTop: 3 }} />
      <span><b>{t}</b><div className="muted" style={{ fontSize: 12 }}>{d}</div></span>
    </label>
  );

  return (
    <div>
      <div className="field">
        <label>Qué descargar</label>
        {opcion("CIERRE", "Cierre semanal", "Valores del cierre por club, descuentos y efecto en la cuenta.")}
        {opcion("ESTADO", "Estado de cuenta", "Saldo actual, fichas por club y últimos movimientos.")}
        {opcion("TODO", "Todo junto", "El cierre de la semana y el estado de cuenta en el mismo PDF.")}
      </div>
      {necesitaSemana && (
        <div className="field">
          <label>Semana del cierre</label>
          <select value={semana} onChange={(e) => setSemana(e.target.value)}>
            {datos.semanas.map((w: any) => (
              <option key={w.week_start} value={w.week_start}>{dateShort(w.week_start)} al {dateShort(w.week_end)}</option>
            ))}
          </select>
        </div>
      )}
      {!soloId && (
        <>
          <div className="field">
            <label>
              Agentes ({sel.length} de {lista.length}){" "}
              <a style={{ cursor: "pointer", fontSize: 12, color: "var(--accent)" }} onClick={() => setElegidos(Object.fromEntries(lista.map((c: any) => [c.agentId, sel.length !== lista.length])))}>
                {sel.length === lista.length ? "Ninguno" : "Todos"}
              </a>
            </label>
            <div style={{ display: "grid", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {lista.map((c: any) => (
                <label key={c.agentId} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!elegidos[c.agentId]} onChange={(e) => setElegidos({ ...elegidos, [c.agentId]: e.target.checked })} />
                  {c.name} <span className="muted" style={{ fontSize: 12 }}>· {c.sistema === "WIN_LOSE" ? "Win/Lose" : "Prepago"}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Formato</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={`chip ${formato === "UNO" ? "chip-active" : ""}`} onClick={() => setFormato("UNO")}>Un solo PDF con todos</button>
              <button type="button" className={`chip ${formato === "POR_AGENTE" ? "chip-active" : ""}`} onClick={() => setFormato("POR_AGENTE")}>Un PDF por agente</button>
            </div>
          </div>
        </>
      )}
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn secondary" onClick={onClose}>Cerrar</button>
        <button className="btn" disabled={loading || sel.length === 0} onClick={descargar}>{loading ? "Generando..." : "Descargar PDF"}</button>
      </div>
    </div>
  );
}

// Activar la cuenta de un agente individual (sección Agentes, 20/10/2026): lista los agentes que todavía no tienen
// cuenta (activos, sin supervisor y sin agentes a cargo). No mueve plata: el saldo se trae después con "Importar saldo".
function ActivarCuentaForm({ onDone, onCancel }: { onDone: (cuenta: any) => void; onCancel: () => void }) {
  const [agentes, setAgentes] = useState<any[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [filtro, setFiltro] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    api.agentesSinCuenta().then(setAgentes).catch((e) => setMsg({ ok: false, text: e.message }));
  }, []);
  if (!agentes) return msg ? <div className="error">{msg.text}</div> : <Loading />;
  const f = filtro.trim().toLowerCase();
  const visibles = agentes.filter((a) => !f || a.name.toLowerCase().includes(f));
  async function activar() {
    setMsg(null);
    setLoading(true);
    try {
      onDone(await api.activarCuentaAgente(agentId));
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo activar la cuenta." });
    } finally {
      setLoading(false);
    }
  }
  return (
    <div>
      <div className="saldo-sub" style={{ marginBottom: 12 }}>
        Elegí el agente. Su cuenta arranca en cero y no cambia nada de lo que ya tiene; después, con "Importar saldo", se trae lo que tiene hoy.
        Los agentes que dependen de un supervisor no aparecen: ya están en la cuenta de su supervisor.
      </div>
      <div className="field">
        <label>Buscar</label>
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Nombre del agente" autoFocus />
      </div>
      <div className="field">
        <label>Agente ({visibles.length})</label>
        <select size={8} value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ width: "100%" }}>
          {visibles.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.default_system === "WIN_LOSE" || a.account_type === "WIN_LOSE" ? "Win/Lose" : "Prepago"}</option>)}
        </select>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancelar</button>
        <button className="btn" disabled={loading || !agentId} onClick={activar}>{loading ? "Activando..." : "Activar cuenta"}</button>
      </div>
    </div>
  );
}

// Descuento del cierre (sección Agentes, 20/10/2026): adelanto de fichas, venta, ticket, etc. Baja la cuenta corriente
// del agente (lo que se le dio a cuenta) y queda como movimiento propio, con concepto y semana opcional.
const CONCEPTOS_DESCUENTO = ["Adelanto de fichas", "Venta", "Ticket", "Otro"];
function DescuentoForm({
  supervisor,
  semanas,
  semanaInicial,
  onDone,
  onCancel,
}: {
  supervisor: any;
  semanas: any[];
  semanaInicial: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [concepto, setConcepto] = useState(CONCEPTOS_DESCUENTO[0]);
  const [detalle, setDetalle] = useState("");
  const [amount, setAmount] = useState("");
  const [semana, setSemana] = useState(semanaInicial || "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const monto = Number(String(amount).replace(",", "."));
  const montoValido = Number.isFinite(monto) && monto > 0;
  const cc = Number(supervisor.cuenta_corriente);
  const ccNuevo = montoValido ? Math.round((cc - monto) * 100) / 100 : cc;
  const fmt = (n: number) => `${n < -0.004 ? "−" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!montoValido) return setMsg({ ok: false, text: "El importe tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.registrarMovimientoSupervisor(supervisor.id, {
        type: "DESCUENTO",
        amount: monto,
        concepto: concepto === "Otro" && detalle.trim() ? detalle.trim() : concepto,
        semana: semana || null,
        notes: concepto !== "Otro" && detalle.trim() ? detalle.trim() : null,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el descuento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="saldo-sub" style={{ marginBottom: 12 }}>
        Lo que se le dio al agente a cuenta (adelanto de fichas, venta, ticket...): se resta de su cuenta corriente y no mueve Wallet.
      </div>
      <div className="field">
        <label>Concepto</label>
        <select value={concepto} onChange={(e) => setConcepto(e.target.value)}>
          {CONCEPTOS_DESCUENTO.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Importe (USD)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" inputMode="decimal" autoFocus style={{ fontSize: 24, fontWeight: 750 }} />
      </div>
      <div className="field">
        <label>Semana del cierre (opcional)</label>
        <select value={semana} onChange={(e) => setSemana(e.target.value)}>
          <option value="">— Sin semana —</option>
          {semanas.map((w) => {
            const ws = String(w.week_start).slice(0, 10);
            return <option key={ws} value={ws}>{dateShort(w.week_start)} al {dateShort(w.week_end)}</option>;
          })}
        </select>
      </div>
      <div className="field">
        <label>{concepto === "Otro" ? "Detalle del concepto" : "Observación"}</label>
        <input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Opcional" />
      </div>
      <div className="panel" style={{ margin: "6px 0 12px", padding: "12px 14px", background: "var(--panel-2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="muted">Cuenta corriente</span>
          <span>{fmt(cc)} → <b className={ccNuevo < -0.004 ? "neg" : ""}>{fmt(ccNuevo)}</b></span>
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancelar</button>
        <button className="btn" disabled={loading || !montoValido}>{loading ? "Guardando..." : "Confirmar descuento"}</button>
      </div>
    </form>
  );
}

// Importar saldos (20/10/2026, pedido de Leo): trae a la cuenta del supervisor lo que cada agente a cargo ya tiene hoy.
// Prepago: fichas (balance + mesas Prepago) y rakeback pendiente. Win/Lose: lo que muestra "Resumen por agente".
// Un agente ya importado no se repite; uno que ya opera en la cuenta no se puede importar (se duplicaría).
function ImportarSaldosForm({
  supervisor,
  filas,
  onDone,
  onCancel,
}: {
  supervisor: any;
  filas: any[] | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const winLose = supervisor.default_system === "WIN_LOSE";
  const [elegidos, setElegidos] = useState<Record<string, boolean> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (filas && !elegidos) setElegidos(Object.fromEntries(filas.map((f) => [f.agentId, f.estado === "NUEVO"])));
  }, [filas, elegidos]);

  if (!filas || !elegidos) return <Loading />;

  const fmt = (n: number) => `${n < -0.004 ? "−" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const sel = filas.filter((f) => elegidos[f.agentId] && f.estado === "NUEVO");
  const totalFichas = Math.round(sel.reduce((s, f) => s + Number(f.fichas), 0) * 100) / 100;
  const totalCc = Math.round(sel.reduce((s, f) => s + Number(f.cuentaCorriente), 0) * 100) / 100;
  const fichasAntes = Number(supervisor.fichas_reales);
  const ccAntes = Number(supervisor.cuenta_corriente);
  const hayNuevos = filas.some((f) => f.estado === "NUEVO");

  async function confirmar() {
    setMsg(null);
    setLoading(true);
    try {
      await api.importarSaldosSupervisor(supervisor.id, sel.map((f) => f.agentId));
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo importar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="saldo-sub" style={{ marginBottom: 12 }}>
        {winLose
          ? "Cada agente entra con lo que hoy figura en su Resumen por agente (negativo = el agente nos debe). Los cierres semanales ya cargados quedan incluidos en ese saldo y no se vuelven a sumar."
          : "Cada agente entra con sus fichas (balance + mesas Prepago) y su rakeback pendiente de hoy. Los cierres semanales ya cargados quedan incluidos y no se vuelven a sumar."}
      </div>
      {filas.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>Este supervisor no tiene agentes activos a cargo.</div>
      ) : (
        <div className="ag-table-wrap" style={{ marginBottom: 12 }}>
          <table className="ag-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>Agente</th>
                {!winLose && <th className="num">Fichas reales</th>}
                <th className="num">Cuenta corriente</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const nuevo = f.estado === "NUEVO";
                return (
                  <tr key={f.agentId} style={nuevo ? undefined : { opacity: 0.7 }}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={!nuevo}
                        checked={nuevo && !!elegidos[f.agentId]}
                        onChange={(e) => setElegidos({ ...elegidos, [f.agentId]: e.target.checked })}
                      />
                    </td>
                    <td><b>{f.agentName}</b></td>
                    {!winLose && <td className="num" style={{ whiteSpace: "nowrap" }}>{fmt(Number(nuevo ? f.fichas : f.importado?.fichas ?? f.fichas))}</td>}
                    <td style={{ whiteSpace: "nowrap" }} className={`num ${Number(nuevo ? f.cuentaCorriente : f.importado?.cuentaCorriente ?? 0) < -0.004 ? "neg" : ""}`}>
                      {fmt(Number(nuevo ? f.cuentaCorriente : f.importado?.cuentaCorriente ?? f.cuentaCorriente))}
                    </td>
                    <td>
                      {f.estado === "NUEVO" && <span className="muted">Sin importar{f.semanaCorte ? ` · incluye hasta la semana del ${dateShort(f.semanaCorte)}` : ""}</span>}
                      {f.estado === "IMPORTADO" && <span className="muted">Ya importado{f.importado ? ` el ${dateShort(f.importado.fecha)}` : ""}</span>}
                      {f.estado === "OPERA_EN_CUENTA" && <span className="neg" title={f.motivo ?? ""}>Ya opera en la cuenta</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sel.length > 0 && (
        <div className="panel" style={{ margin: "6px 0 12px", padding: "12px 14px", background: "var(--panel-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
            <span className="muted">Cuenta corriente</span>
            <span>{fmt(ccAntes)} → <b className={ccAntes + totalCc < -0.004 ? "neg" : ""}>{fmt(Math.round((ccAntes + totalCc) * 100) / 100)}</b></span>
          </div>
          {!winLose && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span className="muted">Fichas reales</span>
              <span>{fmt(fichasAntes)} → <b>{fmt(Math.round((fichasAntes + totalFichas) * 100) / 100)}</b></span>
            </div>
          )}
        </div>
      )}
      {filas.some((f) => f.estado === "OPERA_EN_CUENTA") && (
        <div className="warnbox" style={{ marginBottom: 10 }}>
          Los agentes marcados "Ya opera en la cuenta" ya tienen cierres o movimientos acá: importarlos duplicaría su saldo.
        </div>
      )}
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn secondary" onClick={onCancel}>{hayNuevos ? "Cancelar" : "Cerrar"}</button>
        {hayNuevos && (
          <button className="btn" disabled={loading || sel.length === 0} onClick={confirmar}>
            {loading ? "Importando..." : `Importar ${sel.length} agente${sel.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}

function MovimientoForm({
  supervisor,
  clubes,
  subordinados,
  tipoInicial,
  sinAgente,
  fichasPorClub,
  onDone,
}: {
  supervisor: any;
  clubes: any[];
  subordinados: any[];
  tipoInicial?: "CARGA" | "DESCARGA" | "AJUSTE" | null;
  sinAgente?: boolean;
  fichasPorClub?: any[];
  onDone: () => void;
}) {
  const winLose = supervisor?.default_system === "WIN_LOSE"; // Win/Lose: solo Ajuste de cuenta corriente (sin fichas)
  const [type, setType] = useState<"CARGA" | "DESCARGA" | "AJUSTE">(winLose ? "AJUSTE" : tipoInicial ?? "CARGA");
  const [clubId, setClubId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [amount, setAmount] = useState("");
  const [campoAjuste, setCampoAjuste] = useState<"FICHAS" | "CUENTA_CORRIENTE">("CUENTA_CORRIENTE");
  // Cuenta de agente: una Descarga casi siempre es un pago real en USDT, así que arranca tildado (se ve el efecto en Wallet abajo).
  const [usdtReal, setUsdtReal] = useState(!!sinAgente && tipoInicial === "DESCARGA");
  const [notes, setNotes] = useState("");
  const [paymentLink, setPaymentLink] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const fichasClub = (id: string) => Number((fichasPorClub ?? []).find((c) => c.clubId === id)?.fichas ?? 0);
  const fmtUsd = (n: number) => `${n < -0.004 ? "−" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const montoNum = Number(String(amount).replace(",", "."));
  const montoOk = Number.isFinite(montoNum) && montoNum !== 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!clubId) return setMsg({ ok: false, text: "El club es obligatorio." });
    if (!sinAgente && supervisor.exigir_agente_en_movimientos && !agentId) {
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
            {!winLose && <option value="CARGA">{sinAgente ? "Carga (fichas +)" : "Carga (fichas +, cuenta corriente −)"}</option>}
            {!winLose && <option value="DESCARGA">{sinAgente ? "Descarga (fichas −)" : "Descarga (resta primero de cuenta corriente, después de fichas)"}</option>}
            <option value="AJUSTE">Ajuste manual</option>
          </select>
        </div>
        <div className="field">
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}{sinAgente ? ` · ${fmtUsd(fichasClub(c.id))} en fichas` : ""}</option>)}
          </select>
        </div>
        {!sinAgente && (
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
        )}
        {type === "AJUSTE" && (
          <div className="field">
            <label>Aplicar a</label>
            <select value={campoAjuste} onChange={(e) => setCampoAjuste(e.target.value as any)}>
              <option value="CUENTA_CORRIENTE">Cuenta corriente</option>
              {!winLose && <option value="FICHAS">Fichas reales</option>}
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
      {sinAgente && clubId && montoOk && (() => {
        // Misma regla que el servidor: Carga = fichas +, Descarga = fichas −; sin USDT real el otro lado es la cuenta corriente.
        const signoFichas = type === "CARGA" ? 1 : type === "DESCARGA" ? -1 : campoAjuste === "FICHAS" ? Math.sign(montoNum) : 0;
        const dFichas = type === "AJUSTE" ? (campoAjuste === "FICHAS" ? montoNum : 0) : signoFichas * Math.abs(montoNum);
        const dCc = type === "AJUSTE" ? (campoAjuste === "CUENTA_CORRIENTE" ? montoNum : 0) : usdtReal ? 0 : -dFichas;
        const fichasAntes = Number(supervisor.fichas_reales);
        const ccAntes = Number(supervisor.cuenta_corriente);
        const club = clubes.find((c) => c.id === clubId);
        return (
          <div className="panel" style={{ margin: "6px 0 12px", padding: "12px 14px", background: "var(--panel-2)" }}>
            {dFichas !== 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span className="muted">Fichas reales</span>
                  <span>{fmtUsd(fichasAntes)} → <b>{fmtUsd(fichasAntes + dFichas)}</b></span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span className="muted">{club?.name}</span>
                  <span>{fmtUsd(fichasClub(clubId))} → <b>{fmtUsd(fichasClub(clubId) + dFichas)}</b></span>
                </div>
              </>
            )}
            {dCc !== 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span className="muted">Cuenta corriente</span>
                <span>{fmtUsd(ccAntes)} → <b>{fmtUsd(ccAntes + dCc)}</b></span>
              </div>
            )}
            {type !== "AJUSTE" && usdtReal && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span className="muted">Wallet Manos</span>
                <span><b>{type === "CARGA" ? "+" : "−"}{fmtUsd(Math.abs(montoNum))}</b></span>
              </div>
            )}
          </div>
        );
      })()}
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
  // Supervisor Win/Lose: el retiro se asienta como un Pago contra su cuenta corriente, sin club ni agente.
  const esWL = solicitud.supervisor_default_system === "WIN_LOSE";

  useEffect(() => {
    if (solicitud.exigir_agente_en_movimientos && !esWL) {
      api.subordinadosSupervisor(solicitud.supervisor_agent_id).then(setSubordinados);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitud.supervisor_agent_id]);

  async function onEnviar() {
    setMsg(null);
    if (!esWL && !clubId) return setMsg({ ok: false, text: "Elegí el club." });
    if (!esWL && solicitud.exigir_agente_en_movimientos && !agentId) {
      return setMsg({ ok: false, text: "Este supervisor exige indicar el agente de origen." });
    }
    if (!paymentLink.trim()) return setMsg({ ok: false, text: "Pegá el link de pago." });
    setEnviando(true);
    try {
      await api.marcarSolicitudRetiroEnviada(solicitud.id, {
        clubId: esWL ? null : clubId,
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
          {!esWL && (
            <select value={clubId} onChange={(e) => setClubId(e.target.value)} style={{ fontSize: 12.5 }}>
              <option value="">Club...</option>
              {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {solicitud.exigir_agente_en_movimientos && !esWL && (
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
