import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { usd, usdCents } from "../fmt";
import { exportCsv } from "../csv";
import GananciasPorPeriodo from "./GananciasPorPeriodo";
import Loading from "../components/Loading";
import ActionsMenu from "../components/ActionsMenu";

// Resumen financiero (18/09/2026, pedido explícito de Leo): "un resumen de todas las
// ganancias, cada ingreso y cada egreso que se contabiliza, filtrable por día/semana/mes, para
// ver el desglose de cómo se va contabilizando todo". Junta en un solo lugar lo que ya existía
// repartido en varias pantallas (Wallet/Tesorería, Cierres, Jugadores bancados, Comisiones por
// referido) — ver repo/resumenFinanciero.ts para el detalle de qué junta y por qué cada
// categoría se muestra por separado (nunca se suman entre sí: "ganancia generada" y "plata que
// entró/salió de verdad" responden preguntas distintas).

type Granularidad = "dia" | "semana" | "mes";

const CATEGORIA_LABEL: Record<string, string> = {
  WALLET: "Wallet / Caja",
  CIERRE_SEMANAL: "Cierre semanal (agentes)",
  BANCADO: "Jugadores bancados",
  COMISION_REFERIDO: "Comisión por referido",
  TEAMBACK_AFFILIATES: "TeamBack Afiliados",
};

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}
function haceDias(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function inicioDeMes() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function inicioDeSemana() {
  const d = new Date();
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

function labelPeriodo(periodo: string, gran: Granularidad) {
  if (gran === "mes") {
    const [y, m] = periodo.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  }
  if (gran === "semana") {
    const ini = new Date(periodo + "T00:00:00");
    const fin = new Date(ini);
    fin.setDate(fin.getDate() + 6);
    return `${ini.toLocaleDateString("es-AR")} al ${fin.toLocaleDateString("es-AR")}`;
  }
  return new Date(periodo + "T00:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export default function ResumenFinanciero() {
  const nav = useNavigate();
  // Unificado con "Ganancias por período" (02/10/2026, pedido de Leo: "que quede todo adentro
  // de resumen financiero") -- antes era un ítem de menú aparte con su propia cuenta de
  // "ganancia operativa" que podía no coincidir con esta pantalla; ahora vive acá como una
  // segunda pestaña, y su cálculo reusa literalmente esta misma cuenta (ver
  // computeGananciaCierresYBancadosPorSemanas en repo/resumenFinanciero.ts).
  const [tab, setTab] = useState<"resumen" | "periodos">("resumen");
  const [desde, setDesde] = useState(inicioDeMes());
  const [hasta, setHasta] = useState(hoyIso());
  const [granularidad, setGranularidad] = useState<Granularidad>("dia");
  const [filtroCategoria, setFiltroCategoria] = useState<string>("TODAS");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  function refresh() {
    setCargando(true);
    setError("");
    api
      .resumenFinanciero(desde, hasta)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta]);

  const serie = useMemo(() => {
    if (!data) return [];
    return granularidad === "dia" ? data.porDia : granularidad === "semana" ? data.porSemana : data.porMes;
  }, [data, granularidad]);

  const eventosFiltrados = useMemo(() => {
    if (!data) return [];
    return filtroCategoria === "TODAS" ? data.eventos : data.eventos.filter((e: any) => e.categoria === filtroCategoria);
  }, [data, filtroCategoria]);

  function exportar() {
    if (!data) return;
    exportCsv(
      `resumen_financiero_${desde}_a_${hasta}.csv`,
      eventosFiltrados.map((e: any) => ({
        fecha: e.fecha,
        categoria: CATEGORIA_LABEL[e.categoria] ?? e.categoria,
        subcategoria: e.subcategoria,
        tipo: e.tipo,
        monto: e.monto,
        detalle: e.detalle,
      }))
    );
  }

  // ---- Pantalla (19/10/2026, mockup aprobado): ganancia de cierres primero, rangos en chips, tarjetas en celu ----
  const [rangoCustom, setRangoCustom] = useState(false);
  const [verTodosPeriodos, setVerTodosPeriodos] = useState(false);
  const [limiteEventos, setLimiteEventos] = useState(25);
  const cls = (n: number) => (n > 0.004 ? "pos" : n < -0.004 ? "neg" : "neutral");
  const usdSigno = (n: number) => `${n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;
  const diaMesCorto = (s: string) => {
    const [, m, d] = String(s).slice(0, 10).split("-");
    return `${d}/${m}`;
  };
  const presets: { key: string; label: string; desde: string; hasta: string }[] = [
    { key: "hoy", label: "Hoy", desde: hoyIso(), hasta: hoyIso() },
    { key: "semana", label: "Esta semana", desde: inicioDeSemana(), hasta: hoyIso() },
    { key: "mes", label: "Este mes", desde: inicioDeMes(), hasta: hoyIso() },
    { key: "30", label: "Últimos 30 días", desde: haceDias(30), hasta: hoyIso() },
  ];
  const presetActivo = presets.find((p) => p.desde === desde && p.hasta === hasta)?.key ?? null;
  const hayBancadosOComisiones =
    data && (Number(data.totales.gananciaBancados) !== 0 || Number(data.totales.comisionesAcreditadas) !== 0 || Number(data.totales.comisionesPagadas) !== 0);
  const columnasExtraPeriodo =
    serie.some((f: any) => Number(f.gananciaBancados) !== 0) || serie.some((f: any) => Number(f.comisionesAcreditadas) !== 0 || Number(f.comisionesPagadas) !== 0);
  const hayBancadosPorClub = !!data?.porClub?.some((c: any) => Number(c.gananciaBancados) !== 0);
  const hayTeamback = serie.some((f: any) => Number(f.gananciaTeamback ?? 0) !== 0);
  const serieVisible = verTodosPeriodos ? serie : serie.slice(0, 7);
  const abrirPeriodo = (f: any) => (granularidad === "semana" && f.gananciaCierres !== 0 ? () => nav(`/dashboard/cierres?week=${f.periodo}`) : undefined);
  const eventosVisibles = eventosFiltrados.slice(0, limiteEventos);
  const cantPorCategoria = (cat: string) => (data ? data.eventos.filter((e: any) => cat === "TODAS" || e.categoria === cat).length : 0);

  return (
    <div>
      <div className="topbar" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2>Resumen financiero</h2>
          <div className="muted">
            Todas las ganancias generadas y todos los ingresos/egresos que se contabilizan en el sistema — Wallet/Caja,
            cierres semanales de agentes, jugadores bancados y comisiones por referido — filtrable por día, semana o mes.
          </div>
        </div>
        {tab === "resumen" && (
          <ActionsMenu
            title="Más acciones"
            items={[
              { label: "Exportar CSV del detalle", onClick: exportar, disabled: !data || eventosFiltrados.length === 0 },
              { label: "Recargar", onClick: refresh },
            ]}
          />
        )}
      </div>

      <div className="ag-toolbar" style={{ marginBottom: 10 }}>
        <span className="seg">
          <button className={tab === "resumen" ? "on" : ""} onClick={() => setTab("resumen")}>Resumen</button>
          <button className={tab === "periodos" ? "on" : ""} onClick={() => setTab("periodos")}>Ganancias por período</button>
        </span>
        <span className="ag-toolbar-spacer" />
        {tab === "resumen" && (
          <div className="tb-week-chips rf-rango">
            {presets.map((p) => (
              <button
                key={p.key}
                className={`chip${presetActivo === p.key ? " chip-active" : ""}`}
                onClick={() => { setDesde(p.desde); setHasta(p.hasta); setRangoCustom(false); }}
              >
                {p.label}
              </button>
            ))}
            <button className={`chip${presetActivo === null || rangoCustom ? " chip-active" : ""}`} onClick={() => setRangoCustom((v) => !v)}>
              {diaMesCorto(desde)} – {diaMesCorto(hasta)} ✎
            </button>
          </div>
        )}
      </div>

      {tab === "periodos" && <GananciasPorPeriodo />}

      {tab === "resumen" && (
      <>
      {rangoCustom && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field">
              <label>Desde</label>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="field">
              <label>Hasta</label>
              <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error">
          No se pudo cargar el resumen: {error}
          <div style={{ marginTop: 10 }}>
            <button className="btn secondary small" onClick={refresh}>Reintentar</button>
          </div>
        </div>
      )}

      {cargando && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div
            className="panel row-click"
            style={{ padding: 16 }}
            onClick={() => nav("/dashboard/cierres")}
            title="Ver el historial de Cierres"
          >
            <div className="deals-eyebrow">Ganancia de cierres semanales · {diaMesCorto(desde)} al {diaMesCorto(hasta)}</div>
            <div className={`saldo-big ${cls(Number(data.totales.gananciaCierres))}`} style={{ fontSize: 32 }}>
              {(() => { const n = Number(data.desgloseCierres?.gananciaNeta ?? data.totales.gananciaCierres); return `${n < -0.004 ? "−" : ""}${usdCents(Math.abs(n))}`; })()}
            </div>
            {data.desgloseCierres && (
              <div className="saldo-sub">
                ingresos {usd(data.desgloseCierres.totalIngresos)} − egresos {usd(data.desgloseCierres.totalEgresos)}
                {data.porClub ? ` · ${data.porClub.length} club${data.porClub.length === 1 ? "" : "es"}` : ""}
              </div>
            )}
          </div>

          <div className="stat-row">
            <div className="stat-card">
              <div className="l">Neto Wallet / Caja</div>
              <div className={`v ${cls(Number(data.totales.walletNeto))}`}>{usdSigno(Number(data.totales.walletNeto))}</div>
              <div className="s">ingresos {usd(data.totales.walletIngresos)} · egresos {usd(data.totales.walletEgresos)}</div>
            </div>
            {Number(data.totales.gananciaTeamback ?? 0) !== 0 && (
              <div className="stat-card row-click" onClick={() => nav("/teamback")} title="Ver TeamBack Afiliados">
                <div className="l">Ganancia TeamBack Afiliados</div>
                <div className={`v ${cls(Number(data.totales.gananciaTeamback))}`}>{usdCents(Number(data.totales.gananciaTeamback))}</div>
                <div className="s">rake × 80% − liquidado a los jugadores</div>
              </div>
            )}
            {hayBancadosOComisiones && (
              <>
                <div className="stat-card">
                  <div className="l">Ganancia bancados</div>
                  <div className="v">{usd(data.totales.gananciaBancados)}</div>
                </div>
                <div className="stat-card">
                  <div className="l">Comisiones por referido</div>
                  <div className="v">{usd(data.totales.comisionesAcreditadas)}</div>
                  <div className="s">acreditadas / pagadas: {usd(data.totales.comisionesAcreditadas)} / {usd(data.totales.comisionesPagadas)}</div>
                </div>
              </>
            )}
          </div>
          {!hayBancadosOComisiones && (
            <div className="saldo-sub" style={{ margin: "-4px 0 14px" }}>Bancados y comisiones por referido: sin movimiento en el rango.</div>
          )}

          {data.desgloseCierres && (data.desgloseCierres.ingresos.length > 0 || data.desgloseCierres.egresos.length > 0) && (
            <>
              <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
                Cómo se compone la ganancia de cierres: todo lo que sumó y todo lo que restó, sumado entre todos los clubes y semanas del
                rango elegido. Para el desglose de un club y una semana puntual, tocá esa fila en "Detalle de cada movimiento".
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginBottom: 14 }}>
                <div className="panel" style={{ margin: 0, padding: "14px 16px" }}>
                  <div className="deals-eyebrow">Qué generó ingresos</div>
                  {data.desgloseCierres.ingresos.map((f: any) => (
                    <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>{f.label}</span><b className="pos">{usd(f.monto)}</b>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0" }}><b>Total ingresos</b><b className="pos">{usd(data.desgloseCierres.totalIngresos)}</b></div>
                </div>
                <div className="panel" style={{ margin: 0, padding: "14px 16px" }}>
                  <div className="deals-eyebrow">Qué generó egresos</div>
                  {data.desgloseCierres.egresos.map((f: any) => (
                    <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <span>{f.label}</span><b className="neg">{usd(f.monto)}</b>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0" }}><b>Total egresos</b><b className="neg">{usd(data.desgloseCierres.totalEgresos)}</b></div>
                </div>
              </div>
            </>
          )}

          <div className="rf-grid">
            {data.porClub && data.porClub.length > 0 && (
              <div className="panel" style={{ margin: 0 }}>
                <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Ganancia por club</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Cierres + bancados, sumada en el rango. No incluye Wallet/Caja ni comisiones por referido porque no están atadas a un club. Tocá un club para ver su resumen.
                </div>
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr>
                        <th>Club</th><th className="num">Semanas</th>
                        {hayBancadosPorClub && <><th className="num">Cierres</th><th className="num">Bancados</th></>}
                        <th className="num">Ganancia</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.porClub.map((c: any) => (
                        <tr key={c.clubId} className="row-click" onClick={() => nav(`/dashboard/resumen-club?club=${c.clubId}`)} title="Ver el resumen de este club">
                          <td><div className="saldo-name">{c.clubName}</div></td>
                          <td className="num muted">{c.semanas}</td>
                          {hayBancadosPorClub && <><td className={`num ${c.gananciaCierres >= 0 ? "pos" : "neg"}`}>{usd(c.gananciaCierres)}</td><td className="num">{usd(c.gananciaBancados)}</td></>}
                          <td className="num"><span className={`saldo-big ${cls(Number(c.gananciaTotal))}`}>{usdSigno(Number(c.gananciaTotal))}</span></td>
                          <td style={{ width: 30, color: "var(--text-faint)" }}>›</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ag-cards">
                  {data.porClub.map((c: any) => (
                    <div key={c.clubId} className={`saldo-card ${Number(c.gananciaTotal) > 0 ? "is-pos" : Number(c.gananciaTotal) < 0 ? "is-neg" : ""}`} onClick={() => nav(`/dashboard/resumen-club?club=${c.clubId}`)}>
                      <div className="saldo-card-body">
                        <div className="saldo-card-top">
                          <div className="saldo-name">{c.clubName}</div>
                          <div className={`saldo-big ${cls(Number(c.gananciaTotal))}`}>{usdSigno(Number(c.gananciaTotal))}</div>
                        </div>
                        <div className="saldo-card-mid">
                          <div className="saldo-sub">
                            {c.semanas} semana{c.semanas === 1 ? "" : "s"} con cierres{hayBancadosPorClub ? ` · bancados ${usd(c.gananciaBancados)}` : ""}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="panel" style={{ margin: 0 }}>
              <div className="ag-toolbar" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>Desglose por período</h3>
                <span className="ag-toolbar-spacer" />
                <span className="seg">
                  <button className={granularidad === "dia" ? "on" : ""} onClick={() => setGranularidad("dia")}>Día</button>
                  <button className={granularidad === "semana" ? "on" : ""} onClick={() => setGranularidad("semana")}>Semana</button>
                  <button className={granularidad === "mes" ? "on" : ""} onClick={() => setGranularidad("mes")}>Mes</button>
                </span>
              </div>
              {serie.length === 0 ? (
                <div className="muted">No hay movimientos en este rango.</div>
              ) : (
                <>
                  <div className="ag-table-wrap">
                    <table className="saldos-table">
                      <thead>
                        <tr>
                          <th>Período</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Neto Wallet</th><th className="num">Cierres</th>
                          {hayTeamback && <th className="num">TeamBack</th>}
                          {columnasExtraPeriodo && <><th className="num">Bancados</th><th className="num">Comis. acreditadas</th><th className="num">Comis. pagadas</th></>}
                        </tr>
                      </thead>
                      <tbody>
                        {serieVisible.map((f: any) => {
                          const neto = f.walletIngresos - f.walletEgresos;
                          return (
                            <tr key={f.periodo} className={abrirPeriodo(f) ? "row-click" : undefined} onClick={abrirPeriodo(f)} title={abrirPeriodo(f) ? "Ver esa semana en Cierres" : undefined}>
                              <td><div className="saldo-name">{labelPeriodo(f.periodo, granularidad)}</div></td>
                              <td className="num money pos">{usd(f.walletIngresos)}</td>
                              <td className="num money neg">{usd(f.walletEgresos)}</td>
                              <td className="num"><span className={`saldo-big ${cls(neto)}`}>{usdSigno(neto)}</span></td>
                              <td className="num money">{f.gananciaCierres ? usd(f.gananciaCierres) : "—"}</td>
                              {hayTeamback && <td className="num money pos">{Number(f.gananciaTeamback) ? usdCents(f.gananciaTeamback) : "—"}</td>}
                              {columnasExtraPeriodo && <><td className="num">{usd(f.gananciaBancados)}</td><td className="num muted">{usd(f.comisionesAcreditadas)}</td><td className="num muted">{usd(f.comisionesPagadas)}</td></>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="ag-cards">
                    {serieVisible.map((f: any) => {
                      const neto = f.walletIngresos - f.walletEgresos;
                      return (
                        <div key={f.periodo} className={`saldo-card ${neto > 0 ? "is-pos" : neto < 0 ? "is-neg" : ""}`} onClick={abrirPeriodo(f)}>
                          <div className="saldo-card-body">
                            <div className="saldo-card-top">
                              <div className="saldo-name">{labelPeriodo(f.periodo, granularidad)}</div>
                              <div className={`saldo-big ${cls(neto)}`}>{usdSigno(neto)}</div>
                            </div>
                            <div className="saldo-card-foot" style={{ gap: 14 }}>
                              <span>Ingresos <b className="pos">{usd(f.walletIngresos)}</b></span>
                              <span>Egresos <b className="neg">{usd(f.walletEgresos)}</b></span>
                              {f.gananciaCierres !== 0 && <span>Cierres <b>{usd(f.gananciaCierres)}</b></span>}
                              {Number(f.gananciaTeamback) !== 0 && <span>TeamBack <b className="pos">{usdCents(f.gananciaTeamback)}</b></span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {serie.length > 7 && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                      Mostrando {serieVisible.length} de {serie.length} ·{" "}
                      <a style={{ cursor: "pointer" }} onClick={() => setVerTodosPeriodos((v) => !v)}>{verTodosPeriodos ? "ver menos" : "ver todos"}</a>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <div className="ag-toolbar" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Detalle de cada movimiento</h3>
              <span className="ag-toolbar-spacer" />
              <span className="seg tabs-scroll" style={{ overflowX: "auto", maxWidth: "100%" }}>
                <button className={filtroCategoria === "TODAS" ? "on" : ""} onClick={() => { setFiltroCategoria("TODAS"); setLimiteEventos(25); }}>Todas<span className="n">{cantPorCategoria("TODAS")}</span></button>
                {Object.entries(CATEGORIA_LABEL).filter(([k]) => cantPorCategoria(k) > 0).map(([k, v]) => (
                  <button key={k} className={filtroCategoria === k ? "on" : ""} onClick={() => { setFiltroCategoria(k); setLimiteEventos(25); }}>{v}<span className="n">{cantPorCategoria(k)}</span></button>
                ))}
              </span>
              <button className="btn secondary small" onClick={exportar} disabled={eventosFiltrados.length === 0}>Exportar CSV</button>
            </div>
            {eventosFiltrados.length === 0 ? (
              <div className="muted">No hay movimientos para este filtro.</div>
            ) : (
              <>
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr><th>Fecha</th><th>Categoría</th><th>Origen · detalle</th><th className="num">Monto</th></tr>
                    </thead>
                    <tbody>
                      {eventosVisibles.map((e: any) => (
                        <tr
                          key={`${e.categoria}_${e.id}`}
                          className={e.enlace ? "row-click" : undefined}
                          onClick={e.enlace ? () => nav(e.enlace) : undefined}
                          title={e.enlace ? "Ver el desglose (qué sumó y qué restó)" : undefined}
                        >
                          <td className="muted">{new Date(e.fecha + "T00:00:00").toLocaleDateString("es-AR")}</td>
                          <td><span className="pill">{CATEGORIA_LABEL[e.categoria] ?? e.categoria}</span></td>
                          <td>
                            <div className="saldo-name" style={{ fontWeight: 600 }}>{e.subcategoria}</div>
                            <div className="saldo-sub" title={e.detalle}>{e.detalle}</div>
                          </td>
                          <td className="num"><span className={`saldo-big ${cls(Number(e.monto))}`}>{Number(e.monto) < 0 ? "−" : "+"}{e.categoria === "TEAMBACK_AFFILIATES" ? usdCents(Math.abs(Number(e.monto))) : usd(Math.abs(Number(e.monto)))}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ag-cards">
                  {eventosVisibles.map((e: any) => (
                    <div
                      key={`${e.categoria}_${e.id}`}
                      className={`saldo-card ${Number(e.monto) >= 0 ? "is-pos" : "is-neg"}`}
                      onClick={e.enlace ? () => nav(e.enlace) : undefined}
                    >
                      <div className="saldo-card-body">
                        <div className="saldo-card-top">
                          <div className="saldo-name" style={{ fontWeight: 600 }}>{String(e.subcategoria).replace("Ajuste manual — ", "")}</div>
                          <div className={`saldo-big ${cls(Number(e.monto))}`}>{Number(e.monto) < 0 ? "−" : "+"}{e.categoria === "TEAMBACK_AFFILIATES" ? usdCents(Math.abs(Number(e.monto))) : usd(Math.abs(Number(e.monto)))}</div>
                        </div>
                        <div className="saldo-card-mid">
                          <div className="saldo-sub">{new Date(e.fecha + "T00:00:00").toLocaleDateString("es-AR")} · {CATEGORIA_LABEL[e.categoria] ?? e.categoria}</div>
                        </div>
                        {e.detalle && <div className="saldo-card-foot"><span style={{ fontSize: 12 }}>{e.detalle.length > 90 ? `${e.detalle.slice(0, 90)}…` : e.detalle}</span></div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                  Mostrando {eventosVisibles.length} de {eventosFiltrados.length}
                  {eventosFiltrados.length > limiteEventos && (
                    <> · <a style={{ cursor: "pointer" }} onClick={() => setLimiteEventos((n) => n + 25)}>ver 25 más</a></>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
      </>
      )}
    </div>
  );
}
