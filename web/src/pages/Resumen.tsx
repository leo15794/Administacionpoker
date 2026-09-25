import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import Modal from "../components/Modal";
import MovimientosHistorial from "../components/MovimientosHistorial";

// ================================================================================================
// Resumen ejecutivo -- rediseño visual/UX (25/09/2026, pedido de Leo: "mejorar visualmente y a
// nivel UX el dashboard... sin tocar las funciones que tiene"). TODA la lógica de acá abajo
// (filtros, cálculos, fórmulas, llamadas a la API, qué hace cada click) es EXACTAMENTE la misma
// que ya existía -- lo único que cambió es cómo se agrupa y se dibuja. Ver el comentario
// "PENDIENTE PARA UNA PRÓXIMA ETAPA" más abajo para lo que sí necesitaría backend nuevo.
// ================================================================================================

// Qué par agente+club cuenta para cada KPI, con el mismo signo que usa el balance: positivo =
// a favor del agente (le debemos), negativo = a favor nuestro (nos debe). Se usa tanto para las
// KPIs de arriba como para el filtro por signo de la tabla de abajo, así "hacer click en la KPI"
// y "ver el detalle que la compone" son siempre la misma cuenta.
type FiltroSigno = "todos" | "nosDeben" | "debemos";
// Win/Lose vs Prepago (24/09/2026, pedido de Leo: "faltaria hacerlo para los agentes") -- mismo
// criterio que el filtro por signo, aplicado a la tabla de saldos por agente+club.
type FiltroSistema = "todos" | "WIN_LOSE" | "PREPAGO";

function pasaFiltroSigno(amount: number, signo: FiltroSigno) {
  if (signo === "nosDeben") return amount < 0;
  if (signo === "debemos") return amount > 0;
  return true;
}

// "Fichas" que se ve para un balance PREPAGO (24/09/2026, aclaración de Leo: el número de
// Fichas mostrado tiene que SER la fórmula, no solo tenerla al lado como referencia) --
// balances.amount (lo único que hoy mueven Cargado/Descargado/ajustes manuales) + Fichas
// ganadas en mesas (b.total_fichas_ganadas_mesas, el resultado de mesas de los cierres PREPAGO,
// que nunca tocó el balance real -- ver repo/closings.ts). Para Win/Lose no cambia nada, sigue
// siendo el balance tal cual.
function fichasTotal(b: any): number {
  if (b.system === "PREPAGO") return Number(b.amount) + Number(b.total_fichas_ganadas_mesas || 0);
  return Number(b.amount);
}

// Variación vs. el período anterior -- SOLO se calcula cuando hay un dato histórico real para
// compararlo (ver historicoSemanal más abajo). Nunca se inventa: si no hay semana anterior
// "limpia" cargada, devuelve null y el componente de arriba simplemente no muestra flecha.
function variacionPct(actual: number, anterior: number | null | undefined): number | null {
  if (anterior == null || !Number.isFinite(anterior) || anterior === 0) return null;
  return (actual - anterior) / Math.abs(anterior);
}

function formatearHoraActualizacion(d: Date) {
  const hoy = new Date();
  const esHoy = d.toDateString() === hoy.toDateString();
  const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return esHoy ? `Hoy ${hora}` : `${dateShort(d.toISOString())} ${hora}`;
}

const OPCIONES_PERIODO = ["Esta semana", "Hoy", "Semana anterior", "Este mes", "Mes anterior", "Personalizado"];

export default function Resumen() {
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [filtroSigno, setFiltroSigno] = useState<FiltroSigno>("todos");
  const [filtroSistema, setFiltroSistema] = useState<FiltroSistema>("todos");
  const [detalle, setDetalle] = useState<{ title: string; agentId?: string; clubId?: string } | null>(null);
  const tablaSaldosRef = useRef<HTMLDivElement>(null);
  // Edición manual de Fichas (24/09/2026, pedido de Leo, SOLO PREPAGO): "por temas internos" el
  // número de Fichas tiene que poder pisarse a mano. Se implementa como un AJUSTE de ledger por
  // la diferencia (nunca se pisa balances.amount directo) -- así queda auditado como cualquier
  // otro movimiento, ver POST /movements.
  const [editandoFichasId, setEditandoFichasId] = useState<string | null>(null);
  const [editandoFichasValor, setEditandoFichasValor] = useState("");
  const [guardandoFichas, setGuardandoFichas] = useState(false);
  const [actualizadoEn, setActualizadoEn] = useState<Date | null>(null);
  const [infoAbierta, setInfoAbierta] = useState(false);
  // Filtro de período global (25/09/2026, pedido de Leo) -- PREPARADO VISUALMENTE nada más: el
  // backend de /dashboard/resumen hoy siempre calcula sobre "la última semana con cierres
  // reales" y los saldos/pendientes son la foto ACTUAL (no admiten recortar por fecha todavía).
  // Cambiar esto para que recalcule de verdad es tarea de una próxima etapa (ver nota debajo del
  // selector) -- se deja preparado en vez de mentir con un filtro que no hace nada visible.
  const [periodoGlobal, setPeriodoGlobal] = useState("Esta semana");

  function cargar() {
    return api
      .resumen()
      .then((r: any) => {
        setData(r);
        setActualizadoEn(new Date());
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargar();
  }, []);

  function empezarEdicionFichas(b: any) {
    setEditandoFichasId(b.id);
    setEditandoFichasValor(String(fichasTotal(b).toFixed(2)));
  }

  async function guardarFichas(b: any) {
    const nuevoValor = Number(editandoFichasValor);
    if (!Number.isFinite(nuevoValor)) {
      alert("Valor inválido.");
      return;
    }
    // El delta se aplica sobre balances.amount (lo único editable) -- "Fichas ganadas en mesas"
    // es histórico, no se puede tocar a mano, así que el ajuste absorbe toda la diferencia entre
    // el total mostrado (fichasTotal) y el nuevo valor que se quiere ver.
    const totalActual = fichasTotal(b);
    const delta = nuevoValor - totalActual;
    setEditandoFichasId(null);
    if (Math.abs(delta) < 0.005) return;
    setGuardandoFichas(true);
    try {
      await api.crearMovimiento({
        type: "AJUSTE",
        clubId: b.club_id,
        agentId: b.agent_id,
        amount: delta,
        occurredAt: new Date().toISOString(),
        observation: `Ajuste manual de fichas (PREPAGO, editado a mano en Resumen): ${usd(totalActual)} → ${usd(nuevoValor)}.`,
      });
      await cargar();
    } catch (e: any) {
      alert(e.message || "No se pudo guardar el ajuste.");
    } finally {
      setGuardandoFichas(false);
    }
  }

  if (error) return <div className="error">No se pudo cargar el resumen: {error}</div>;
  if (!data) return <div className="muted">Cargando...</div>;

  // Puente: hacer click en una KPI de arriba lleva directo al detalle que la compone — para
  // "Agentes nos deben"/"Debemos a agentes" es filtrar por signo la misma tabla de saldos de
  // abajo (nunca hace falta ir a buscarla aparte); para Wallet/Garantías/Agentes es navegar
  // directo a esa sección, que ya tiene su propio historial de movimientos.
  function irAKpi(signo: FiltroSigno) {
    setFiltroSigno(signo);
    tablaSaldosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const balancesFiltrados = data.balances
    .filter((b: any) => fichasTotal(b) !== 0)
    .filter((b: any) => pasaFiltroSigno(fichasTotal(b), filtroSigno))
    .filter((b: any) => filtroSistema === "todos" || b.system === filtroSistema)
    .filter((b: any) => {
      const q = filtro.trim().toLowerCase();
      if (!q) return true;
      return b.agent_name.toLowerCase().includes(q) || b.club_name.toLowerCase().includes(q);
    })
    .sort((a: any, b: any) => fichasTotal(b) - fichasTotal(a));

  // Win/Lose vs Prepago para los KPIs "Agentes nos deben"/"Debemos a agentes" (24/09/2026,
  // pedido de Leo) -- se calcula acá mismo desde data.balances (ya trae `system`, ver
  // repo/ledger.ts listAllBalances) en vez de pedirle otro campo al backend. Para PREPAGO usa
  // fichasTotal (balance + fichas ganadas en mesas) -- para WIN_LOSE es lo mismo que antes.
  // OJO: esto es solo el desglose Win/Lose vs Prepago que se muestra abajo de la KPI -- el total
  // grande de arriba (data.kpis.agentesNosDeben/debemosAAgentes) sigue viniendo del backend sin
  // este ajuste, puede no coincidir con la suma de estos dos mientras eso no se actualice.
  const nosDebenWinLose = data.balances.filter((b: any) => fichasTotal(b) < 0 && b.system === "WIN_LOSE").reduce((s: number, b: any) => s - fichasTotal(b), 0);
  const nosDebenPrepago = data.balances.filter((b: any) => fichasTotal(b) < 0 && b.system === "PREPAGO").reduce((s: number, b: any) => s - fichasTotal(b), 0);
  const debemosWinLose = data.balances.filter((b: any) => fichasTotal(b) > 0 && b.system === "WIN_LOSE").reduce((s: number, b: any) => s + fichasTotal(b), 0);
  const debemosPrepago = data.balances.filter((b: any) => fichasTotal(b) > 0 && b.system === "PREPAGO").reduce((s: number, b: any) => s + fichasTotal(b), 0);

  // "Por cobrar" / "Por pagar" (25/09/2026) -- exactamente los mismos totales que ya se
  // mostraban como "Total nos deben (con adelantos)" / "Total debemos (con garantías)", solo
  // que ahora son las tarjetas principales de "Resumen financiero" en vez de dos tarjetas más
  // en el medio de la grilla. Mismo cálculo, mismo destino de click.
  const porCobrar = Number(data.kpis.agentesNosDeben) + Number(data.kpis.adelantosPendientes);
  const porPagar = Number(data.kpis.debemosAAgentes) + Number(data.kpis.garantiasPendientes);

  // Variación de la Ganancia semanal vs. la semana anterior -- sale de historicoSemanal (ya
  // viene del backend, últimas hasta 8 semanas "limpias" en orden ascendente). El Rake NO tiene
  // esa misma serie histórica todavía (ver nota en EvolucionGananciaRake más abajo), así que acá
  // solo se calcula para Ganancia -- no se inventa una variación de Rake sin datos reales.
  const historico = (data.historicoSemanal ?? []) as { week_start: string; week_end: string; ganancia: number }[];
  const gananciaAnterior = historico.length >= 2 ? Number(historico[historico.length - 2].ganancia) : null;
  const variacionGanancia = data.kpis.gananciaSemana != null ? variacionPct(Number(data.kpis.gananciaSemana), gananciaAnterior) : null;

  const walletEstado = Number(data.kpis.saldoWallet) > 0 ? "pos" : Number(data.kpis.saldoWallet) < 0 ? "neg" : "neutral";
  const walletTexto = walletEstado === "pos" ? "Saldo positivo" : walletEstado === "neg" ? "Saldo negativo" : "Sin saldo";

  return (
    <div>
      <div className="dash-header">
        <div>
          <h2 style={{ marginBottom: 4 }}>Resumen</h2>
          <div className="muted">Estado financiero y operativo de DigiPlayers.</div>
        </div>
        <div className="dash-header-right">
          <div>
            <label className="muted" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, display: "block", marginBottom: 6 }}>
              Período
            </label>
            <select className="period-select" value={periodoGlobal} onChange={(e) => setPeriodoGlobal(e.target.value)} title="Filtro de período (preparado visualmente -- ver nota abajo del header)">
              {OPCIONES_PERIODO.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          {actualizadoEn && (
            <div className="dash-updated-at">
              Última actualización
              <strong>{formatearHoraActualizacion(actualizadoEn)}</strong>
            </div>
          )}
        </div>
      </div>
      {periodoGlobal !== "Esta semana" && (
        <div className="warning" style={{ marginTop: -14, marginBottom: 18 }}>
          El filtro de período todavía no recalcula las métricas de abajo (quedó preparado visualmente, pendiente para una próxima etapa de backend -- ver comentario en Resumen.tsx). Los números siguen siendo "Esta semana" / la foto actual.
        </div>
      )}

      {/* ============================== Resumen financiero ============================== */}
      <div className="dash-section">
        <div className="dash-section-title">Resumen financiero</div>
        <div className="dash-section-subtitle">Calculado en vivo desde el ledger — no desde celdas fijas.</div>
      </div>

      <div className="kpi-hero-grid">
        <div
          className="kpi-hero-card row-click"
          onClick={() => nav("/dashboard/cierres")}
          title={
            data.kpis.gananciaSemanaInicio
              ? `Semana ${dateShort(data.kpis.gananciaSemanaInicio)} - ${dateShort(data.kpis.gananciaSemanaFin)} — suma de la Ganancia Neta de cada club (ver Resumen por club), calculada en vivo desde los cierres cargados, ir a Cierres`
              : "Todavía no hay ningún cierre semanal real cargado"
          }
        >
          <div className="kpi-hero-label">Ganancia semanal</div>
          <div className={`kpi-hero-amount ${data.kpis.gananciaSemana == null ? "neutral" : Number(data.kpis.gananciaSemana) > 0 ? "pos" : Number(data.kpis.gananciaSemana) < 0 ? "neg" : "neutral"}`}>
            {data.kpis.gananciaSemana != null ? usd(data.kpis.gananciaSemana) : "—"}
          </div>
          <div className="kpi-hero-sub" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
            {variacionGanancia != null && (
              <span className={`kpi-trend ${variacionGanancia >= 0 ? "up" : "down"}`}>
                {variacionGanancia >= 0 ? "↑" : "↓"} {Math.abs(variacionGanancia * 100).toFixed(1)}% vs semana anterior
              </span>
            )}
            {data.kpis.gananciaSemanaWinLose != null && (
              <span>Win/Lose {usd(data.kpis.gananciaSemanaWinLose)} · Prepago {usd(data.kpis.gananciaSemanaPrepago)}</span>
            )}
          </div>
        </div>

        <div
          className="kpi-hero-card row-click"
          onClick={() => nav("/dashboard/cierres")}
          title={
            data.kpis.gananciaSemanaInicio
              ? `Semana ${dateShort(data.kpis.gananciaSemanaInicio)} - ${dateShort(data.kpis.gananciaSemanaFin)} — suma del rake total de esa semana, ir a Cierres`
              : "Todavía no hay ningún cierre semanal real cargado"
          }
        >
          <div className="kpi-hero-label">Rake semanal</div>
          <div className="kpi-hero-amount neutral">{data.kpis.rakeSemana != null ? usd(data.kpis.rakeSemana) : "—"}</div>
          <div className="kpi-hero-sub" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
            {data.kpis.rakeSemanaWinLose != null && (
              <span>Win/Lose {usd(data.kpis.rakeSemanaWinLose)} · Prepago {usd(data.kpis.rakeSemanaPrepago)}</span>
            )}
          </div>
        </div>

        <div className="kpi-hero-card row-click" onClick={() => nav("/dashboard/wallet")} title="Ir a Wallet — historial completo de movimientos">
          <div className="kpi-hero-label">Saldo Wallet</div>
          <div className={`kpi-hero-amount ${walletEstado}`}>{usd(data.kpis.saldoWallet)}</div>
          <div className="kpi-hero-sub">
            <span className={`status-pill ${walletEstado}`}>{walletTexto}</span>
          </div>
        </div>

        <div
          className={`kpi-hero-card row-click${filtroSigno === "nosDeben" ? " kpi-active" : ""}`}
          onClick={() => nav("/dashboard/adelantos")}
          title="Agentes nos deben + adelantos de rakeback pendientes — comparable contra la fila 'Nos debe' de la planilla. Click para ver Adelantos."
        >
          <div className="kpi-hero-label">Por cobrar</div>
          <div className="kpi-hero-amount pos">{usd(porCobrar)}</div>
          <div className="kpi-hero-sub">Incluye adelantos</div>
        </div>

        <div
          className={`kpi-hero-card row-click${filtroSigno === "debemos" ? " kpi-active" : ""}`}
          onClick={() => nav("/dashboard/garantias")}
          title="Debemos a agentes + garantías pendientes — comparable contra la fila 'Debemos' de la planilla. Click para ver Garantías."
        >
          <div className="kpi-hero-label">Por pagar</div>
          <div className="kpi-hero-amount neg">{usd(porPagar)}</div>
          <div className="kpi-hero-sub">Incluye garantías</div>
        </div>
      </div>

      <button className="info-trigger" onClick={() => setInfoAbierta(true)} style={{ marginTop: 14 }}>
        ⓘ Cómo se calculan estos números
      </button>
      {infoAbierta && (
        <Modal title="Cómo se calculan estos números" onClose={() => setInfoAbierta(false)}>
          <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
            "Ganancia de la semana" / "Rake de la semana" salen de la última semana con cierres REALES cargados (no cuenta las semanas reconstruidas sin desglose, ver Cierres) — si viene vacío es porque la última semana cargada es una de esas. "Agentes nos deben" / "Debemos a agentes" son saldo de fichas y saldo pendiente por agente+club, neteado (un solo saldo por agente+club, como una cuenta corriente real). Sumando Adelantos/Garantías se arma el total comparable contra la planilla ("Por cobrar" / "Por pagar") — aun así puede quedar una diferencia chica cuando un mismo agente+club tiene a la vez una fila "debemos" y una "nos debe" en la planilla (ej. debe fichas pero tiene un pago pendiente): la planilla suma bruto por fila y nosotros neteamos, que es lo correcto para un saldo real. Hacé click en cualquier KPI para ver su detalle.
          </div>
        </Modal>
      )}

      {/* ============================== Operación ============================== */}
      <div className="dash-section">
        <div className="dash-section-title">Operación</div>
      </div>
      <div className="kpi-sub-grid">
        <div
          className="kpi-sub-card row-click"
          onClick={() => document.getElementById("panel-saldo-por-club")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          title="Ver el saldo neto por club"
        >
          <div className="kpi-sub-label">Clubes activos</div>
          <div className="kpi-sub-value">{data.kpis.clubesActivos}</div>
        </div>
        <div className="kpi-sub-card row-click" onClick={() => nav("/dashboard/agentes")} title="Ir a Agentes">
          <div className="kpi-sub-label">Agentes activos</div>
          <div className="kpi-sub-value">{data.kpis.agentesActivos}</div>
        </div>
      </div>

      {/* ============================== Pendientes financieros ============================== */}
      <div className="dash-section">
        <div className="dash-section-title">Pendientes financieros</div>
        <div className="dash-section-subtitle">Desglose de lo que ya está sumado en "Por cobrar" / "Por pagar" de arriba.</div>
      </div>
      <div className="pending-grid">
        <div className={`pending-card row-click${filtroSigno === "nosDeben" ? " kpi-active" : ""}`} onClick={() => irAKpi("nosDeben")} title="Ver el detalle de saldos por agente y club que arma este total">
          <div className="pending-label">Agentes nos deben</div>
          <div className="pending-value pos">{usd(data.kpis.agentesNosDeben)}</div>
          <div className="pending-hint">Win/Lose {usd(nosDebenWinLose)} · Prepago {usd(nosDebenPrepago)}</div>
        </div>
        <div className="pending-card row-click" onClick={() => nav("/dashboard/adelantos")} title="Ir a Adelantos de rakeback">
          <div className="pending-label">Adelantos de rakeback</div>
          <div className="pending-value pos">{usd(data.kpis.adelantosPendientes)}</div>
        </div>
        <div className={`pending-card row-click${filtroSigno === "debemos" ? " kpi-active" : ""}`} onClick={() => irAKpi("debemos")} title="Ver el detalle de saldos por agente y club que arma este total">
          <div className="pending-label">Debemos a agentes</div>
          <div className="pending-value neg">{usd(data.kpis.debemosAAgentes)}</div>
          <div className="pending-hint">Win/Lose {usd(debemosWinLose)} · Prepago {usd(debemosPrepago)}</div>
        </div>
        <div className="pending-card row-click" onClick={() => nav("/dashboard/garantias")} title="Ir a Garantías">
          <div className="pending-label">Garantías pendientes</div>
          <div className="pending-value neg">{usd(data.kpis.garantiasPendientes)}</div>
        </div>
      </div>

      {/* ============================== Gráfico de evolución ============================== */}
      {historico.length > 1 && (
        <div className="panel" style={{ marginTop: 34 }}>
          <EvolucionGananciaRake semanas={historico} />
        </div>
      )}

      {/* ============================== Saldo por club ============================== */}
      <div className="panel" id="panel-saldo-por-club" style={{ marginTop: historico.length > 1 ? 20 : 34 }}>
        <div className="topbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Saldo neto por club</h3>
          <button
            className="btn secondary small"
            onClick={() =>
              exportCsv(
                "saldo_por_club.csv",
                data.porClub.map((c: any) => ({ club: c.club, agentes_con_saldo: c.agentes, saldo_neto: c.saldo_neto }))
              )
            }
          >
            Exportar CSV
          </button>
        </div>
        <SaldoPorClubBarras porClub={data.porClub} onClickClub={(clubId, club) => setDetalle({ title: `Movimientos — ${club}`, clubId })} />
      </div>

      {data.porClubPorSistema && data.porClubPorSistema.length > 0 && (
        <SaldoPorClubPorSistema porClubPorSistema={data.porClubPorSistema} onClickClub={(clubId, club) => setDetalle({ title: `Movimientos — ${club}`, clubId })} />
      )}

      {data.resultadoPorClub && data.resultadoPorClub.length > 0 && (
        <div className="panel">
          <div className="topbar" style={{ marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0 }}>Resultado por club</h3>
              {data.kpis.gananciaSemanaInicio && (
                <div className="muted" style={{ marginTop: 2 }}>
                  Semana {dateShort(data.kpis.gananciaSemanaInicio)} al {dateShort(data.kpis.gananciaSemanaFin)} — misma semana que "Ganancia/Rake de la semana"
                </div>
              )}
            </div>
            <button
              className="btn secondary small"
              onClick={() =>
                exportCsv(
                  "resultado_por_club.csv",
                  data.resultadoPorClub.map((c: any) => ({
                    club: c.club_name,
                    rake: c.rake_total,
                    ganancia_nuestra: c.ganancia,
                    cierre_agentes: c.cierre_agentes,
                  }))
                )
              }
            >
              Exportar CSV
            </button>
          </div>
          <table>
            <thead>
              <tr><th>Club</th><th>Rake</th><th>Ganancia nuestra</th><th>Cierre agentes</th></tr>
            </thead>
            <tbody>
              {data.resultadoPorClub.map((c: any) => (
                <tr key={c.club_id}>
                  <td>{c.club_name}</td>
                  <td>{usd(c.rake_total)}</td>
                  <td>{usd(c.ganancia)}</td>
                  <td><span className={`badge ${Number(c.cierre_agentes) >= 0 ? "pos" : "neg"}`}>{usd(c.cierre_agentes)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.resultadoPorClub && data.resultadoPorClub.length > 0 && (
        <ResultadoPorClubPorSistema resultadoPorClub={data.resultadoPorClub} />
      )}

      <div className="panel" ref={tablaSaldosRef}>
        <div className="topbar" style={{ marginBottom: 14, alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0 }}>Saldos por agente y club</h3>
            <div className="muted" style={{ marginTop: 2 }}>Positivo = a favor del agente</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="search-input"
              placeholder="Buscar agente o club..."
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <button
              className="btn secondary small"
              onClick={() =>
                exportCsv(
                  "saldos_por_agente_y_club.csv",
                  balancesFiltrados.map((b: any) => ({
                    agente: b.agent_name,
                    club: b.club_name,
                    sistema: b.system,
                    cierre_ultima_semana: b.system === "WIN_LOSE" ? b.ultimo_cierre_monto : "",
                    cargado: b.system === "PREPAGO" ? b.total_cargado : "",
                    descargado: b.system === "PREPAGO" ? b.total_descargado : "",
                    fichas_ganadas_mesas: b.system === "PREPAGO" ? b.total_fichas_ganadas_mesas : "",
                    fichas: fichasTotal(b),
                  }))
                )
              }
            >
              Exportar CSV
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`chip${filtroSigno === "todos" ? " chip-active" : ""}`} onClick={() => setFiltroSigno("todos")}>
            Todos
          </button>
          <button className={`chip${filtroSigno === "nosDeben" ? " chip-active" : ""}`} onClick={() => setFiltroSigno("nosDeben")}>
            Nos deben
          </button>
          <button className={`chip${filtroSigno === "debemos" ? " chip-active" : ""}`} onClick={() => setFiltroSigno("debemos")}>
            Debemos
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`chip${filtroSistema === "todos" ? " chip-active" : ""}`} onClick={() => setFiltroSistema("todos")}>
            Todos los sistemas
          </button>
          <button className={`chip${filtroSistema === "WIN_LOSE" ? " chip-active" : ""}`} onClick={() => setFiltroSistema("WIN_LOSE")}>
            Win/Lose
          </button>
          <button className={`chip${filtroSistema === "PREPAGO" ? " chip-active" : ""}`} onClick={() => setFiltroSistema("PREPAGO")}>
            Prepago
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Saldo Win/Lose {usd(balancesFiltrados.filter((b: any) => b.system === "WIN_LOSE").reduce((s: number, b: any) => s + fichasTotal(b), 0))}
          {" · "}
          Fichas Prepago {usd(balancesFiltrados.filter((b: any) => b.system === "PREPAGO").reduce((s: number, b: any) => s + fichasTotal(b), 0))}
        </div>
        <table>
          <thead>
            <tr><th>Agente</th><th>Club</th><th>Sistema</th><th>Cierre última semana</th><th>Cargado</th><th>Descargado</th><th>Fichas ganadas en mesas</th><th>Fichas</th></tr>
          </thead>
          <tbody>
            {balancesFiltrados.map((b: any) => (
              <tr
                key={b.id}
                className="row-click"
                onClick={() => setDetalle({ title: `${b.agent_name} — ${b.club_name}`, agentId: b.agent_id, clubId: b.club_id })}
              >
                <td>{b.agent_name}</td>
                <td>{b.club_name}</td>
                <td><span className="badge neutral">{b.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</span></td>
                <td>
                  {/* Solo Win/Lose (24/09/2026, pedido de Leo: "Todos los agentes WIN/LOSE en su
                      resumen deberia aparecer el cierre final de la semana") -- el cierre de la
                      última semana cerrada de ESTE agente+club, puramente informativo: el Saldo
                      de al lado ya lo tiene sumado y sigue moviéndose solo con lo que pase la
                      semana que viene (pagos/cobros/retiros), este número no. */}
                  {b.system === "WIN_LOSE" && b.ultimo_cierre_monto !== null ? (
                    <span title={`Semana ${dateShort(b.ultimo_cierre_week_start)} - ${dateShort(b.ultimo_cierre_week_end)}`}>
                      <span className={`badge ${Number(b.ultimo_cierre_monto) > 0 ? "pos" : Number(b.ultimo_cierre_monto) < 0 ? "neg" : "neutral"}`}>
                        {usd(b.ultimo_cierre_monto)}
                      </span>
                      <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{dateShort(b.ultimo_cierre_week_end)}</span>
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {/* Cargado/Descargado (24/09/2026, pedido de Leo: "3 columnas... la suma y la
                      resta de eso") -- solo tiene sentido para PREPAGO: ahí CARGA y DESCARGA son
                      los ÚNICOS movimientos que tocan el balance (ver repo/closings.ts y
                      repo/rakebackPendiente.ts), así que Cargado - Descargado = Saldo siempre.
                      Para WIN_LOSE el balance también incluye el cierre semanal -- mostrar estas
                      columnas ahí confundiría más de lo que aclara, así que se dejan vacías. */}
                  {b.system === "PREPAGO" ? <span className="badge pos">{usd(b.total_cargado)}</span> : <span className="muted">—</span>}
                </td>
                <td>
                  {b.system === "PREPAGO" ? <span className="badge neg">{usd(-Math.abs(Number(b.total_descargado)))}</span> : <span className="muted">—</span>}
                </td>
                <td>
                  {/* Fichas ganadas en mesas (24/09/2026, pedido de Leo): "Cargado - Descargado +
                      Fichas ganadas en las mesas = Fichas". Solo informativo -- referencia para
                      saber qué compone el número de Fichas, que abajo se puede editar a mano. */}
                  {b.system === "PREPAGO" ? (
                    <span className={`badge ${Number(b.total_fichas_ganadas_mesas) >= 0 ? "pos" : "neg"}`}>
                      {usd(b.total_fichas_ganadas_mesas)}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {/* Fichas = balance + fichas ganadas en mesas para PREPAGO (24/09/2026,
                      aclaración de Leo: el número mostrado TIENE que ser la suma de las 3
                      columnas, no solo tenerla al lado de referencia -- ver fichasTotal() arriba).
                      100% editable a mano SOLO para PREPAGO (pedido de Leo: "por temas internos")
                      -- guarda un AJUSTE por la diferencia sobre el balance real, nunca pisa el
                      número directo, así queda auditado (ver guardarFichas() arriba). */}
                  {b.system === "PREPAGO" && editandoFichasId === b.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="number"
                        step="0.01"
                        autoFocus
                        value={editandoFichasValor}
                        onChange={(e) => setEditandoFichasValor(e.target.value)}
                        style={{ width: 100 }}
                      />
                      <button className="btn small" disabled={guardandoFichas} onClick={() => guardarFichas(b)}>
                        Guardar
                      </button>
                      <button className="btn secondary small" disabled={guardandoFichas} onClick={() => setEditandoFichasId(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className={`badge ${fichasTotal(b) > 0 ? "pos" : "neg"}`}>{usd(fichasTotal(b))}</span>
                      {b.system === "PREPAGO" && (
                        <button
                          className="btn secondary small"
                          title="Editar fichas a mano"
                          onClick={() => empezarEdicionFichas(b)}
                        >
                          ✎
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detalle && (
        <Modal title={detalle.title} onClose={() => setDetalle(null)} wide>
          <MovimientosHistorial agentId={detalle.agentId} clubId={detalle.clubId} />
        </Modal>
      )}
    </div>
  );
}

// "Saldo neto por club" (25/09/2026) -- ordenado de mayor a menor saldo ABSOLUTO (antes: alfabético
// por nombre, ver la query original en repo/dashboard.ts que sigue trayendo el mismo orden; el
// reordenamiento es 100% client-side, no toca el backend) con una barra horizontal proporcional
// al saldo de cada club, para que salte a la vista cuál concentra más plata sin leer cada número.
function SaldoPorClubBarras({ porClub, onClickClub }: { porClub: any[]; onClickClub: (clubId: string, club: string) => void }) {
  const ordenado = [...porClub].sort((a, b) => Math.abs(Number(b.saldo_neto)) - Math.abs(Number(a.saldo_neto)));
  const maxAbs = Math.max(...ordenado.map((c) => Math.abs(Number(c.saldo_neto))), 1);
  if (ordenado.length === 0) return <div className="muted">Sin clubes.</div>;
  return (
    <div>
      {ordenado.map((c) => {
        const saldo = Number(c.saldo_neto);
        const signo = saldo > 0 ? "pos" : saldo < 0 ? "neg" : "neutral";
        const anchoPct = Math.max((Math.abs(saldo) / maxAbs) * 100, saldo === 0 ? 0 : 2);
        return (
          <div key={c.club_id} className="club-balance-row" onClick={() => onClickClub(c.club_id, c.club)}>
            <div className="club-balance-name">{c.club}</div>
            <div className="club-balance-agentes">{c.agentes} agente{Number(c.agentes) === 1 ? "" : "s"}</div>
            <div className="club-balance-bar-wrap">
              <div className="club-balance-bar-track">
                <div className={`club-balance-bar-fill ${signo}`} style={{ width: `${anchoPct}%` }} />
              </div>
              <span className={`club-balance-amount ${signo === "neutral" ? "muted" : signo}`}>{usd(saldo)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// "Saldo neto por club" separado por sistema (24/09/2026, pedido de Leo: "necesito que los
// separes en resumen", extendido a Operación > Resumen). El sistema de un balance no viene
// guardado ahí (ver repo/dashboard.ts porClubPorSistema) -- se resuelve en vivo, así que un
// club sin ningún balance con ese sistema simplemente no tiene fila ahí (no se inventa un 0).
function SaldoPorClubPorSistema({
  porClubPorSistema,
  onClickClub,
}: {
  porClubPorSistema: any[];
  onClickClub: (clubId: string, club: string) => void;
}) {
  const winLose = porClubPorSistema.filter((c) => c.system === "WIN_LOSE");
  const prepago = porClubPorSistema.filter((c) => c.system === "PREPAGO");
  function Tabla({ titulo, filas }: { titulo: string; filas: any[] }) {
    return (
      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>{titulo}</h3>
        {filas.length === 0 ? (
          <div className="muted">Sin saldos con este sistema.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Club</th><th>Agentes con saldo</th><th>Saldo neto</th></tr>
            </thead>
            <tbody>
              {filas.map((c: any) => (
                <tr key={c.club_id} className="row-click" onClick={() => onClickClub(c.club_id, c.club)}>
                  <td>{c.club}</td>
                  <td>{c.agentes}</td>
                  <td>
                    <span className={`badge ${Number(c.saldo_neto) > 0 ? "pos" : Number(c.saldo_neto) < 0 ? "neg" : "neutral"}`}>
                      {usd(c.saldo_neto)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  return (
    <div>
      <Tabla titulo="Saldo neto por club — Win/Lose" filas={winLose} />
      <Tabla titulo="Saldo neto por club — Prepago" filas={prepago} />
    </div>
  );
}

// "Resultado por club" separado por sistema (24/09/2026, pedido de Leo). Solo se puede separar
// lo que es atribuible a un agente puntual (rake, ganancia por rake, cierre) -- lo que es del
// CLUB entero (rodeo, ventas, tasa fija, override de Tiny) queda afuera de estas dos tablas, ya
// que no tiene sentido partirlo a la mitad; sigue estando en la tabla "Resultado por club" de
// arriba (el total real). Por eso la suma de estas dos tablas NO da exacto el total de esa
// tabla en clubes con esos "otros ingresos" -- no es un error.
function ResultadoPorClubPorSistema({ resultadoPorClub }: { resultadoPorClub: any[] }) {
  function Tabla({ titulo, sufijo }: { titulo: string; sufijo: "win_lose" | "prepago" }) {
    const filas = resultadoPorClub.filter((c) => Number(c[`rake_total_${sufijo}`]) !== 0 || Number(c[`cierre_agentes_${sufijo}`]) !== 0);
    return (
      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>{titulo}</h3>
        {filas.length === 0 ? (
          <div className="muted">Sin cierres con este sistema esta semana.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Club</th><th>Rake</th><th>Ganancia nuestra</th><th>Cierre agentes</th></tr>
            </thead>
            <tbody>
              {filas.map((c: any) => (
                <tr key={c.club_id}>
                  <td>{c.club_name}</td>
                  <td>{usd(c[`rake_total_${sufijo}`])}</td>
                  <td>{usd(c[`ganancia_${sufijo}`])}</td>
                  <td><span className={`badge ${Number(c[`cierre_agentes_${sufijo}`]) >= 0 ? "pos" : "neg"}`}>{usd(c[`cierre_agentes_${sufijo}`])}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  return (
    <div>
      <Tabla titulo="Resultado por club — Win/Lose" sufijo="win_lose" />
      <Tabla titulo="Resultado por club — Prepago" sufijo="prepago" />
      <div className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 16 }}>
        "Ganancia nuestra" acá es solo la parte atribuible al rake de cada agente — el rodeo del club, ventas y tasa fija (si el club los tiene) quedan afuera de este desglose y siguen en el total de "Resultado por club" de arriba.
      </div>
    </div>
  );
}

// Gráfico de evolución "Ganancia y Rake — últimas N semanas" (25/09/2026, pedido de Leo).
// SVG puro, sin librerías nuevas (mismo criterio que el gráfico de barras que reemplaza).
//
// PENDIENTE PARA UNA PRÓXIMA ETAPA (backend): hoy /dashboard/resumen -> historicoSemanal solo
// trae { week_start, week_end, ganancia } por semana (ver routes/dashboard.ts), NUNCA trajo el
// rake semana a semana -- ese dato jamás se calculó ni se guardó separado por semana, salvo el
// de LA semana actual (data.kpis.rakeSemana, un solo número). Así que la serie de Rake acá abajo
// NO se puede dibujar con datos reales todavía sin tocar esa consulta (agregarle
// SUM(wc.rake_total) al SELECT) -- lo que el pedido original decía explícitamente que había que
// dejar pendiente en vez de inventar. Por eso el gráfico dibuja SOLO la línea de Ganancia (dato
// 100% real) y deja la de Rake marcada como "próximamente" en la leyenda, en vez de fabricar
// una curva con datos que no existen. El selector de período limita a 4 u 8 semanas -- son las
// únicas cantidades que la consulta actual (LIMIT 8) puede cubrir con datos reales; "12 semanas"
// queda deshabilitado con la misma nota, ya que ampliar el LIMIT también es cambio de backend.
function EvolucionGananciaRake({ semanas }: { semanas: { week_start: string; week_end: string; ganancia: number }[] }) {
  const [periodo, setPeriodo] = useState<4 | 8 | 12>(Math.min(8, semanas.length) as 4 | 8);
  const visibles = semanas.slice(Math.max(0, semanas.length - periodo));

  const width = 100;
  const height = 130;
  const valores = visibles.map((s) => Number(s.ganancia));
  const max = Math.max(...valores, 0);
  const min = Math.min(...valores, 0);
  const rango = max - min || 1;
  const paso = visibles.length > 1 ? width / (visibles.length - 1) : 0;
  const puntoY = (v: number) => height - ((v - min) / rango) * height;
  const puntos = valores.map((v, i) => [i * paso, puntoY(v)] as const);
  const path = puntos.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const zeroY = puntoY(0);

  return (
    <div>
      <div className="chart-toolbar">
        <div>
          <h3 style={{ margin: 0, marginBottom: 4 }}>Ganancia y Rake — últimas {periodo} semanas</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            Datos reales de los cierres semanales cargados. La línea de Rake semana a semana todavía no está disponible (ver nota en el código, es tarea de backend).
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {([4, 8, 12] as const).map((n) => {
            const disponible = n <= semanas.length;
            return (
              <button
                key={n}
                className={`chip${periodo === n ? " chip-active" : ""}`}
                disabled={!disponible}
                title={disponible ? undefined : "Requiere ampliar el backend (hoy trae máximo 8 semanas) — pendiente para una próxima etapa"}
                onClick={() => disponible && setPeriodo(n)}
                style={!disponible ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
              >
                {n} semanas
              </button>
            );
          })}
        </div>
      </div>

      <div className="chart-legend">
        <span className="chart-legend-item"><span className="chart-legend-dot" style={{ background: "var(--accent-2)" }} />Ganancia</span>
        <span className="chart-legend-item" style={{ opacity: 0.5 }}><span className="chart-legend-dot" style={{ background: "var(--text-faint)" }} />Rake (próximamente)</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ overflow: "visible", marginTop: 10 }}>
        <defs>
          <linearGradient id="evol-ganancia-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-2)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {min < 0 && max > 0 && <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="var(--border-strong)" strokeWidth={0.35} />}
        {puntos.length > 1 && (
          <path d={`${path} L ${puntos[puntos.length - 1][0]} ${height} L ${puntos[0][0]} ${height} Z`} fill="url(#evol-ganancia-area)" stroke="none" />
        )}
        {puntos.length > 1 && <path d={path} fill="none" stroke="var(--accent-2)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {puntos.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={1.6} fill="var(--accent-2)" stroke="var(--panel)" strokeWidth={0.6}>
            <title>
              Semana {dateShort(visibles[i].week_start)} al {dateShort(visibles[i].week_end)}
              {"\n"}Ganancia: {usd(valores[i])}
              {"\n"}Rake: no disponible todavía (pendiente de backend)
            </title>
          </circle>
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="muted">
        <span>{dateShort(visibles[0].week_start)}</span>
        <span>{dateShort(visibles[visibles.length - 1].week_end)}</span>
      </div>
    </div>
  );
}
