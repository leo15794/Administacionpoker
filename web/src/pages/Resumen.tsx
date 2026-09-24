import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import Modal from "../components/Modal";
import MovimientosHistorial from "../components/MovimientosHistorial";

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

  function cargar() {
    return api.resumen().then(setData).catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargar();
  }, []);

  function empezarEdicionFichas(b: any) {
    setEditandoFichasId(b.id);
    setEditandoFichasValor(String(Number(b.amount).toFixed(2)));
  }

  async function guardarFichas(b: any) {
    const nuevoValor = Number(editandoFichasValor);
    if (!Number.isFinite(nuevoValor)) {
      alert("Valor inválido.");
      return;
    }
    const delta = nuevoValor - Number(b.amount);
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
        observation: `Ajuste manual de fichas (PREPAGO, editado a mano en Resumen): ${usd(b.amount)} → ${usd(nuevoValor)}.`,
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
    .filter((b: any) => Number(b.amount) !== 0)
    .filter((b: any) => pasaFiltroSigno(Number(b.amount), filtroSigno))
    .filter((b: any) => filtroSistema === "todos" || b.system === filtroSistema)
    .filter((b: any) => {
      const q = filtro.trim().toLowerCase();
      if (!q) return true;
      return b.agent_name.toLowerCase().includes(q) || b.club_name.toLowerCase().includes(q);
    })
    .sort((a: any, b: any) => Number(b.amount) - Number(a.amount));

  // Win/Lose vs Prepago para los KPIs "Agentes nos deben"/"Debemos a agentes" (24/09/2026,
  // pedido de Leo) -- se calcula acá mismo desde data.balances (ya trae `system`, ver
  // repo/ledger.ts listAllBalances) en vez de pedirle otro campo al backend.
  const nosDebenWinLose = data.balances.filter((b: any) => Number(b.amount) < 0 && b.system === "WIN_LOSE").reduce((s: number, b: any) => s - Number(b.amount), 0);
  const nosDebenPrepago = data.balances.filter((b: any) => Number(b.amount) < 0 && b.system === "PREPAGO").reduce((s: number, b: any) => s - Number(b.amount), 0);
  const debemosWinLose = data.balances.filter((b: any) => Number(b.amount) > 0 && b.system === "WIN_LOSE").reduce((s: number, b: any) => s + Number(b.amount), 0);
  const debemosPrepago = data.balances.filter((b: any) => Number(b.amount) > 0 && b.system === "PREPAGO").reduce((s: number, b: any) => s + Number(b.amount), 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen ejecutivo</h2>
          <div className="muted">Calculado en vivo desde el ledger — no desde celdas fijas. Hacé click en un club o en un saldo para ver el detalle.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div
          className="kpi-card row-click"
          onClick={() => nav("/dashboard/cierres")}
          title={
            data.kpis.gananciaSemanaInicio
              ? `Semana ${dateShort(data.kpis.gananciaSemanaInicio)} - ${dateShort(data.kpis.gananciaSemanaFin)} — suma de la Ganancia Neta de cada club (ver Resumen por club), calculada en vivo desde los cierres cargados, ir a Cierres`
              : "Todavía no hay ningún cierre semanal real cargado"
          }
        >
          <div className="label">Ganancia de la semana</div>
          <div className="value pos">{data.kpis.gananciaSemana != null ? usd(data.kpis.gananciaSemana) : "—"}</div>
          {data.kpis.gananciaSemanaWinLose != null && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Win/Lose {usd(data.kpis.gananciaSemanaWinLose)} · Prepago {usd(data.kpis.gananciaSemanaPrepago)}
            </div>
          )}
        </div>
        <div
          className="kpi-card row-click"
          onClick={() => nav("/dashboard/cierres")}
          title={
            data.kpis.gananciaSemanaInicio
              ? `Semana ${dateShort(data.kpis.gananciaSemanaInicio)} - ${dateShort(data.kpis.gananciaSemanaFin)} — suma del rake total de esa semana, ir a Cierres`
              : "Todavía no hay ningún cierre semanal real cargado"
          }
        >
          <div className="label">Rake de la semana</div>
          <div className="value">{data.kpis.rakeSemana != null ? usd(data.kpis.rakeSemana) : "—"}</div>
          {data.kpis.rakeSemanaWinLose != null && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Win/Lose {usd(data.kpis.rakeSemanaWinLose)} · Prepago {usd(data.kpis.rakeSemanaPrepago)}
            </div>
          )}
        </div>
        <div
          className={`kpi-card row-click${filtroSigno === "nosDeben" ? " kpi-active" : ""}`}
          onClick={() => irAKpi("nosDeben")}
          title="Ver el detalle de saldos por agente y club que arma este total"
        >
          <div className="label">Agentes nos deben</div>
          <div className="value neg">{usd(data.kpis.agentesNosDeben)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Win/Lose {usd(nosDebenWinLose)} · Prepago {usd(nosDebenPrepago)}
          </div>
        </div>
        <div
          className={`kpi-card row-click${filtroSigno === "debemos" ? " kpi-active" : ""}`}
          onClick={() => irAKpi("debemos")}
          title="Ver el detalle de saldos por agente y club que arma este total"
        >
          <div className="label">Debemos a agentes</div>
          <div className="value pos">{usd(data.kpis.debemosAAgentes)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Win/Lose {usd(debemosWinLose)} · Prepago {usd(debemosPrepago)}
          </div>
        </div>
        <div className="kpi-card row-click" onClick={() => nav("/dashboard/wallet")} title="Ir a Wallet — historial completo de movimientos">
          <div className="label">Saldo Wallet</div>
          <div className="value">{usd(data.kpis.saldoWallet)}</div>
        </div>
        <div className="kpi-card row-click" onClick={() => nav("/dashboard/garantias")} title="Ir a Garantías">
          <div className="label">Garantías pendientes</div>
          <div className="value">{usd(data.kpis.garantiasPendientes)}</div>
        </div>
        <div className="kpi-card row-click" onClick={() => nav("/dashboard/adelantos")} title="Ir a Adelantos de rakeback">
          <div className="label">Adelantos de rakeback</div>
          <div className="value">{usd(data.kpis.adelantosPendientes)}</div>
        </div>
        <div
          className="kpi-card row-click"
          onClick={() => nav("/dashboard/adelantos")}
          title="Agentes nos deben + adelantos de rakeback pendientes — comparable contra la fila 'Nos debe' de la planilla"
        >
          <div className="label">Total nos deben (con adelantos)</div>
          <div className="value neg">{usd(Number(data.kpis.agentesNosDeben) + Number(data.kpis.adelantosPendientes))}</div>
        </div>
        <div
          className="kpi-card row-click"
          onClick={() => nav("/dashboard/garantias")}
          title="Debemos a agentes + garantías pendientes — comparable contra la fila 'Debemos' de la planilla"
        >
          <div className="label">Total debemos (con garantías)</div>
          <div className="value pos">{usd(Number(data.kpis.debemosAAgentes) + Number(data.kpis.garantiasPendientes))}</div>
        </div>
        <div
          className="kpi-card row-click"
          onClick={() => document.getElementById("panel-saldo-por-club")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          title="Ver el saldo neto por club"
        >
          <div className="label">Clubes activos</div>
          <div className="value">{data.kpis.clubesActivos}</div>
        </div>
        <div className="kpi-card row-click" onClick={() => nav("/dashboard/agentes")} title="Ir a Agentes">
          <div className="label">Agentes activos</div>
          <div className="value">{data.kpis.agentesActivos}</div>
        </div>
      </div>
      <div className="muted" style={{ marginTop: -10, marginBottom: 20, fontSize: 12 }}>
        "Ganancia de la semana" / "Rake de la semana" salen de la última semana con cierres REALES cargados (no cuenta las semanas reconstruidas sin desglose, ver Cierres) — si viene vacío es porque la última semana cargada es una de esas. "Agentes nos deben" / "Debemos a agentes" son saldo de fichas y saldo pendiente por agente+club, neteado (un solo saldo por agente+club, como una cuenta corriente real). Sumando Adelantos/Garantías se arma el total comparable contra la planilla — aun así puede quedar una diferencia chica cuando un mismo agente+club tiene a la vez una fila "debemos" y una "nos debe" en la planilla (ej. debe fichas pero tiene un pago pendiente): la planilla suma bruto por fila y nosotros neteamos, que es lo correcto para un saldo real. Hacé click en cualquier KPI para ver su detalle.
      </div>

      {data.historicoSemanal && data.historicoSemanal.length > 1 && (
        <div className="panel">
          <h3 style={{ marginBottom: 4 }}>Tendencia de ganancia</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            Últimas {data.historicoSemanal.length} semanas con cierres reales cargados — mismo dato que "Ganancia de la semana", semana a semana.
          </div>
          <TendenciaGanancia semanas={data.historicoSemanal} />
        </div>
      )}

      <div className="panel" id="panel-saldo-por-club">
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
        <table>
          <thead>
            <tr><th>Club</th><th>Agentes con saldo</th><th>Saldo neto</th></tr>
          </thead>
          <tbody>
            {data.porClub.map((c: any) => (
              <tr key={c.club_id} className="row-click" onClick={() => setDetalle({ title: `Movimientos — ${c.club}`, clubId: c.club_id })}>
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
                    fichas: b.amount,
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
          Saldo Win/Lose {usd(balancesFiltrados.filter((b: any) => b.system === "WIN_LOSE").reduce((s: number, b: any) => s + Number(b.amount), 0))}
          {" · "}
          Fichas Prepago {usd(balancesFiltrados.filter((b: any) => b.system === "PREPAGO").reduce((s: number, b: any) => s + Number(b.amount), 0))}
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
                  {/* Fichas 100% editable a mano SOLO para PREPAGO (pedido de Leo: "por temas
                      internos") -- guarda un AJUSTE por la diferencia, nunca pisa el número
                      directo, así queda auditado (ver guardarFichas() arriba). */}
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
                      <span className={`badge ${Number(b.amount) > 0 ? "pos" : "neg"}`}>{usd(b.amount)}</span>
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

// Gráfico de barras chico, en SVG puro (sin librerías nuevas) — muestra la ganancia neta de
// cada una de las últimas semanas "limpias" para que la tendencia se vea de un vistazo, en vez
// de tener que ir semana por semana a Cierres. Positivo = degradé de la marca, negativo = rojo
// (mismos colores que el resto de la app), con el eje cero marcado cuando hace falta.
function TendenciaGanancia({ semanas }: { semanas: { week_start: string; week_end: string; ganancia: number }[] }) {
  const width = 100; // % — se escala solo con el contenedor
  const height = 120;
  const gap = 3;
  const barW = (width - gap * (semanas.length - 1)) / semanas.length;
  const valores = semanas.map((s) => Number(s.ganancia));
  const max = Math.max(...valores, 0);
  const min = Math.min(...valores, 0);
  const rango = max - min || 1;
  const zeroY = height - ((0 - min) / rango) * height;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="ganancia-pos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c6ffc" />
            <stop offset="100%" stopColor="#4f7cff" />
          </linearGradient>
        </defs>
        {min < 0 && max > 0 && (
          <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="var(--border-strong)" strokeWidth={0.4} />
        )}
        {valores.map((v, i) => {
          const x = i * (barW + gap);
          const barH = (Math.abs(v) / rango) * height;
          const y = v >= 0 ? zeroY - barH : zeroY;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 1.5)}
              rx={1.5}
              fill={v >= 0 ? "url(#ganancia-pos)" : "#f43f5e"}
            >
              <title>
                {dateShort(semanas[i].week_start)} al {dateShort(semanas[i].week_end)}: {usd(v)}
              </title>
            </rect>
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }} className="muted">
        <span>{dateShort(semanas[0].week_start)}</span>
        <span>{dateShort(semanas[semanas.length - 1].week_end)}</span>
      </div>
    </div>
  );
}
