import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { usd } from "../fmt";
import { exportCsv } from "../csv";

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

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen financiero</h2>
          <div className="muted">
            Todas las ganancias generadas y todos los ingresos/egresos que se contabilizan en el sistema — Wallet/Caja,
            cierres semanales de agentes, jugadores bancados y comisiones por referido — filtrable por día, semana o mes.
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field">
            <label>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field">
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <button className="btn secondary small" onClick={() => { setDesde(hoyIso()); setHasta(hoyIso()); }}>Hoy</button>
          <button className="btn secondary small" onClick={() => { setDesde(inicioDeSemana()); setHasta(hoyIso()); }}>Esta semana</button>
          <button className="btn secondary small" onClick={() => { setDesde(inicioDeMes()); setHasta(hoyIso()); }}>Este mes</button>
          <button className="btn secondary small" onClick={() => { setDesde(haceDias(30)); setHasta(hoyIso()); }}>Últimos 30 días</button>
        </div>
      </div>

      {error && (
        <div className="error">
          No se pudo cargar el resumen: {error}
          <div style={{ marginTop: 10 }}>
            <button className="btn secondary small" onClick={refresh}>Reintentar</button>
          </div>
        </div>
      )}

      {cargando && !data ? (
        <div className="muted">Cargando...</div>
      ) : data ? (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <div className="panel" style={{ flex: "1 1 200px" }}>
              <div className="muted">Ingresos Wallet/Caja</div>
              <div className="pos" style={{ fontSize: 20, fontWeight: 700 }}>{usd(data.totales.walletIngresos)}</div>
            </div>
            <div className="panel" style={{ flex: "1 1 200px" }}>
              <div className="muted">Egresos Wallet/Caja</div>
              <div className="neg" style={{ fontSize: 20, fontWeight: 700 }}>{usd(data.totales.walletEgresos)}</div>
            </div>
            <div className="panel" style={{ flex: "1 1 200px" }}>
              <div className="muted">Neto Wallet/Caja</div>
              <div className={Number(data.totales.walletNeto) >= 0 ? "pos" : "neg"} style={{ fontSize: 20, fontWeight: 700 }}>
                {usd(data.totales.walletNeto)}
              </div>
            </div>
            <div
              className="panel row-click"
              style={{ flex: "1 1 200px" }}
              onClick={() => nav("/dashboard/cierres")}
              title="Ver el historial de Cierres"
            >
              <div className="muted">Ganancia cierres semanales</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{usd(data.totales.gananciaCierres)}</div>
            </div>
            <div className="panel" style={{ flex: "1 1 200px" }}>
              <div className="muted">Ganancia bancados</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{usd(data.totales.gananciaBancados)}</div>
            </div>
            <div className="panel" style={{ flex: "1 1 200px" }}>
              <div className="muted">Comisiones acreditadas / pagadas</div>
              <div style={{ fontSize: 16 }}>
                {usd(data.totales.comisionesAcreditadas)} <span className="muted">/</span> {usd(data.totales.comisionesPagadas)}
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="topbar" style={{ marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>Desglose por período</h4>
              <div style={{ display: "flex", gap: 6 }}>
                <button className={`btn small ${granularidad === "dia" ? "" : "secondary"}`} onClick={() => setGranularidad("dia")}>Día</button>
                <button className={`btn small ${granularidad === "semana" ? "" : "secondary"}`} onClick={() => setGranularidad("semana")}>Semana</button>
                <button className={`btn small ${granularidad === "mes" ? "" : "secondary"}`} onClick={() => setGranularidad("mes")}>Mes</button>
              </div>
            </div>
            {serie.length === 0 ? (
              <div className="muted">No hay movimientos en este rango.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table-compact">
                  <thead>
                    <tr>
                      <th>Período</th>
                      <th>Ingresos Wallet</th>
                      <th>Egresos Wallet</th>
                      <th>Neto Wallet</th>
                      <th>Ganancia cierres</th>
                      <th>Ganancia bancados</th>
                      <th>Comisiones acreditadas</th>
                      <th>Comisiones pagadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serie.map((f: any) => (
                      <tr key={f.periodo}>
                        <td>{labelPeriodo(f.periodo, granularidad)}</td>
                        <td className="pos">{usd(f.walletIngresos)}</td>
                        <td className="neg">{usd(f.walletEgresos)}</td>
                        <td className={f.walletIngresos - f.walletEgresos >= 0 ? "pos" : "neg"}>
                          {usd(f.walletIngresos - f.walletEgresos)}
                        </td>
                        <td
                          className={granularidad === "semana" && f.gananciaCierres !== 0 ? "row-click" : undefined}
                          onClick={
                            granularidad === "semana" && f.gananciaCierres !== 0
                              ? () => nav(`/dashboard/cierres?week=${f.periodo}`)
                              : undefined
                          }
                          title={granularidad === "semana" && f.gananciaCierres !== 0 ? "Ver esa semana en Cierres" : undefined}
                        >
                          {usd(f.gananciaCierres)}
                        </td>
                        <td>{usd(f.gananciaBancados)}</td>
                        <td className="muted">{usd(f.comisionesAcreditadas)}</td>
                        <td className="muted">{usd(f.comisionesPagadas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="topbar" style={{ marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>Detalle de cada movimiento</h4>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
                  <option value="TODAS">Todas las categorías</option>
                  {Object.entries(CATEGORIA_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <button className="btn secondary small" onClick={exportar} disabled={eventosFiltrados.length === 0}>
                  Exportar CSV
                </button>
              </div>
            </div>
            {eventosFiltrados.length === 0 ? (
              <div className="muted">No hay movimientos para este filtro.</div>
            ) : (
              <div style={{ maxHeight: 480, overflowY: "auto", overflowX: "auto" }}>
                <table className="table-compact">
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Categoría</th><th>Origen</th><th>Tipo</th><th>Monto</th><th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventosFiltrados.map((e: any) => (
                      <tr
                        key={`${e.categoria}_${e.id}`}
                        className={e.enlace ? "row-click" : undefined}
                        onClick={e.enlace ? () => nav(e.enlace) : undefined}
                        title={e.enlace ? "Ver en Cierres" : undefined}
                      >
                        <td className="muted">{new Date(e.fecha + "T00:00:00").toLocaleDateString("es-AR")}</td>
                        <td><span className="badge neutral">{CATEGORIA_LABEL[e.categoria] ?? e.categoria}</span></td>
                        <td className="muted">{e.subcategoria}</td>
                        <td className="muted">{e.tipo}</td>
                        <td className={Number(e.monto) >= 0 ? "pos" : "neg"}>{usd(e.monto)}</td>
                        <td className="muted">{e.detalle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
