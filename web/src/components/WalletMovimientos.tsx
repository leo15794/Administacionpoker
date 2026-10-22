import { useEffect, useMemo, useState, type ReactNode } from "react";
import { exportCsv } from "../csv";
import ActionsMenu from "./ActionsMenu";

// Saldo y movimientos de la Wallet (22/10/2026, pedido de Leo, inspirado en una referencia que trajo): saldo con los botones de ingreso y egreso,
// y abajo la lista de movimientos con pestañas, buscador, período, persona y más filtros, totales de lo filtrado y paginación (10 / 25 / 50 / 100 / todos).
// Todo se filtra en el navegador sobre los movimientos que ya trae la pantalla (hasta 600).
const LABEL: Record<string, string> = {
  CARGA: "Carga", DESCARGA: "Descarga", COBRO: "Cobro", PAGO: "Pago", COBRO_RAKEBACK: "Cobro de rakeback",
  PAGO_RAKEBACK: "Pago de rakeback", ADELANTO_RAKEBACK: "Adelanto de rakeback", AJUSTE: "Ajuste", AJUSTE_TESORERIA: "Movimiento manual",
};
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const TAMANOS = [10, 25, 50, 100, 0]; // 0 = todos
const CLAVE_TAM = "dp_wallet_tamano";
const CLAVE_PERIODO = "dp_wallet_periodo";

type Periodo = "hoy" | "7d" | "mes" | "mespasado" | "todo";
const PERIODOS: { k: Periodo; t: string }[] = [
  { k: "hoy", t: "Hoy" }, { k: "7d", t: "Últimos 7 días" }, { k: "mes", t: "Este mes" }, { k: "mespasado", t: "Mes pasado" }, { k: "todo", t: "Todo el historial" },
];

const esRev = (m: any) => (m.status ?? m.movimiento_status) === "REVERTIDO";
const esReversion = (m: any) => /^Reversi[oó]n de ajuste/.test(m.observation || "");
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const nf = (n: number | string, d = 2) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const loc = (iso: string) => new Date(iso); // hora local del navegador
const fechaTxt = (iso: string) => { const d = loc(iso); return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`; };
const horaTxt = (iso: string) => loc(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/** Separa "persona" y "concepto" de cada movimiento (los manuales son texto libre: lo que no se reconoce queda como título tal cual). */
function partes(m: any): { persona: string; concepto: string } {
  if (m.source !== "ajuste") return { persona: m.agent_name || "Agente", concepto: LABEL[m.type] ?? m.type };
  const o = String(m.observation || "").trim();
  if (esReversion(m)) {
    const x = o.match(/Original: "(Supervisor .+?) — (\w+)/i);
    return x ? { persona: x[1], concepto: `Reversión de ${x[2].toLowerCase()}` } : { persona: "Reversión", concepto: "Reversión de un movimiento" };
  }
  const s = o.match(/^(Supervisor .+?) — (carga|descarga|cobro|pago)\b/i);
  if (s) return { persona: s[1], concepto: cap(s[2]) };
  return { persona: o.length > 70 ? `${o.slice(0, 68)}…` : o || "Movimiento manual", concepto: "Movimiento manual" };
}

function enPeriodo(iso: string, p: Periodo): boolean {
  if (p === "todo") return true;
  const d = new Date(iso); const ahora = new Date();
  if (p === "hoy") return d.toDateString() === ahora.toDateString();
  if (p === "7d") return ahora.getTime() - d.getTime() <= 7 * 86400000;
  const mes = p === "mes" ? ahora.getMonth() : (ahora.getMonth() + 11) % 12;
  const anio = p === "mes" || ahora.getMonth() > 0 ? ahora.getFullYear() : ahora.getFullYear() - 1;
  return d.getMonth() === mes && d.getFullYear() === anio;
}

function leer<T>(clave: string, def: T): T {
  try {
    const v = localStorage.getItem(clave);
    return v === null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}

export default function WalletMovimientos({ titulo, saldo, movimientos, totalMovimientos, borrando, onRevertir, onNuevo }: {
  titulo: ReactNode;
  saldo: number;
  movimientos: any[];
  totalMovimientos: number;
  borrando: string | null;
  onRevertir: (m: any) => void;
  onNuevo: (dir: "INGRESO" | "EGRESO") => void;
}) {
  const [tab, setTab] = useState<"todos" | "ingresos" | "egresos" | "reversiones">("todos");
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>(() => leer(CLAVE_PERIODO, "mes" as Periodo));
  const [persona, setPersona] = useState("");
  const [tipo, setTipo] = useState("");
  const [minimo, setMinimo] = useState("");
  const [maximo, setMaximo] = useState("");
  const [masFiltros, setMasFiltros] = useState(false);
  const [orden, setOrden] = useState<"desc" | "asc">("desc");
  const [tamano, setTamano] = useState<number>(() => leer(CLAVE_TAM, 25));
  const [pagina, setPagina] = useState(1);

  useEffect(() => { try { localStorage.setItem(CLAVE_TAM, JSON.stringify(tamano)); } catch { /* sin almacenamiento */ } }, [tamano]);
  useEffect(() => { try { localStorage.setItem(CLAVE_PERIODO, JSON.stringify(periodo)); } catch { /* sin almacenamiento */ } }, [periodo]);

  const filas = useMemo(() => movimientos.map((m) => ({ m, p: partes(m) })), [movimientos]);
  const personas = useMemo(() => [...new Set(filas.map((f) => f.p.persona))].sort((a, b) => a.localeCompare(b)), [filas]);
  const tipos = useMemo(() => [...new Set(filas.map((f) => f.p.concepto))].sort(), [filas]);

  // Filtros comunes a todas las pestañas (para que los contadores de las pestañas reflejen período, búsqueda, persona, etc.).
  const base = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const min = minimo ? Number(minimo.replace(",", ".")) : null;
    const max = maximo ? Number(maximo.replace(",", ".")) : null;
    return filas.filter(({ m, p }) =>
      enPeriodo(m.occurred_at, periodo) &&
      (!persona || p.persona === persona) &&
      (!tipo || p.concepto === tipo) &&
      (min === null || Number(m.amount) >= min) &&
      (max === null || Number(m.amount) <= max) &&
      (!q || `${p.persona} ${p.concepto} ${m.observation ?? ""} ${m.created_by ?? ""}`.toLowerCase().includes(q))
    );
  }, [filas, busca, periodo, persona, tipo, minimo, maximo]);

  const cuentas = {
    todos: base.length,
    ingresos: base.filter(({ m }) => m.direction === "INGRESO" && !esRev(m) && !esReversion(m)).length,
    egresos: base.filter(({ m }) => m.direction === "EGRESO" && !esRev(m) && !esReversion(m)).length,
    reversiones: base.filter(({ m }) => esRev(m) || esReversion(m)).length,
  };
  const visibles = useMemo(() => {
    const l = base.filter(({ m }) =>
      tab === "todos" ? true : tab === "reversiones" ? esRev(m) || esReversion(m) : (tab === "ingresos" ? m.direction === "INGRESO" : m.direction === "EGRESO") && !esRev(m) && !esReversion(m)
    );
    return l.sort((a, b) => (orden === "desc" ? 1 : -1) * (new Date(b.m.occurred_at).getTime() - new Date(a.m.occurred_at).getTime()));
  }, [base, tab, orden]);

  const vigentes = visibles.filter(({ m }) => !esRev(m));
  const ing = vigentes.filter(({ m }) => m.direction === "INGRESO").reduce((a, { m }) => a + Number(m.amount), 0);
  const egr = vigentes.filter(({ m }) => m.direction === "EGRESO").reduce((a, { m }) => a + Number(m.amount), 0);
  const neto = ing - egr;

  const porPagina = tamano === 0 ? Math.max(visibles.length, 1) : tamano;
  const paginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  const pag = Math.min(pagina, paginas);
  const recorte = visibles.slice((pag - 1) * porPagina, pag * porPagina);
  useEffect(() => { setPagina(1); }, [tab, busca, periodo, persona, tipo, minimo, maximo, tamano]);

  const numeros: (number | "…")[] = [];
  for (let i = 1; i <= paginas; i++) if (i === 1 || i === paginas || Math.abs(i - pag) <= 1) numeros.push(i); else if (numeros[numeros.length - 1] !== "…") numeros.push("…");

  function exportar() {
    exportCsv("wallet.csv", visibles.map(({ m, p }) => ({
      fecha: m.occurred_at, direccion: m.direction, monto: m.amount, persona: p.persona, concepto: p.concepto,
      estado: esRev(m) ? "REVERTIDO" : esReversion(m) ? "REVERSION" : "APLICADO",
      origen: m.source === "ajuste" ? "Ajuste / historial" : "Movimiento de agente", cargado_por: m.created_by ?? "",
    })));
  }
  const hayFiltros = !!(busca || persona || tipo || minimo || maximo || periodo !== "todo");

  return (
    <div className="wm">
      <div className="topbar">
        <div>{titulo}<div className="muted" style={{ fontSize: 13 }}>Control de movimientos · USDT</div></div>
        <button className="btn secondary" onClick={exportar} disabled={visibles.length === 0} title="Exporta lo que estás viendo con los filtros aplicados">⬇ Exportar CSV</button>
      </div>

      <div className="wm-card wm-saldo">
        <div>
          <div className="wm-lbl">SALDO NETO</div>
          <div className={`wm-big ${saldo >= 0 ? "pos" : "neg"}`}>{nf(saldo)} <small>USDT</small></div>
          <div className="muted" style={{ fontSize: 12.5 }}>Saldo de todos los movimientos ({totalMovimientos})</div>
        </div>
        <div className="wm-btns">
          <button className="wm-b in" onClick={() => onNuevo("INGRESO")}>＋ Registrar ingreso</button>
          <button className="wm-b out" onClick={() => onNuevo("EGRESO")}>− Registrar egreso</button>
        </div>
      </div>

      <div className="wm-card">
        <div className="wm-cab">
          <div className="wm-h">Movimientos <span className="wm-n">{base.length}</span></div>
          <div className="wm-fil">
            <input className="wm-in" placeholder="Buscar persona o concepto..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select className="wm-in" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} aria-label="Período">
              {PERIODOS.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}
            </select>
            <select className="wm-in" value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona">
              <option value="">Todas las personas</option>
              {personas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" className={`wm-in wm-btn ${masFiltros || tipo || minimo || maximo ? "on" : ""}`} onClick={() => setMasFiltros((v) => !v)}>⚲ Más filtros ▾</button>
          </div>
        </div>
        {masFiltros && (
          <div className="wm-mas">
            <label>Tipo<select className="wm-in" value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label>Monto desde<input className="wm-in" inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="0" /></label>
            <label>Monto hasta<input className="wm-in" inputMode="decimal" value={maximo} onChange={(e) => setMaximo(e.target.value)} placeholder="Sin tope" /></label>
            <button type="button" className="btn secondary small" onClick={() => { setTipo(""); setMinimo(""); setMaximo(""); setPersona(""); setBusca(""); setPeriodo("todo"); }}>Limpiar filtros</button>
          </div>
        )}
        <div className="wm-tabs" role="tablist">
          {(["todos", "ingresos", "egresos", "reversiones"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {cap(k)} <i>{cuentas[k]}</i>
            </button>
          ))}
        </div>

        <div className="wm-th">
          <span>PERSONA / CONCEPTO</span>
          <button type="button" className="wm-ord" onClick={() => setOrden((o) => (o === "desc" ? "asc" : "desc"))}>FECHA Y HORA {orden === "desc" ? "↓" : "↑"}</button>
          <span>TIPO</span>
          <span style={{ textAlign: "right" }}>IMPORTE</span>
          <span />
        </div>
        {recorte.length === 0 ? (
          <div className="muted" style={{ padding: "26px 8px" }}>No hay movimientos con estos filtros.{hayFiltros && periodo !== "todo" ? " Probá con “Todo el historial”." : ""}</div>
        ) : (
          recorte.map(({ m, p }) => {
            const ing1 = m.direction === "INGRESO"; const r = esRev(m); const rv = esReversion(m);
            return (
              <div key={m.id} className={`wm-fila ${r ? "rev" : ""}`}>
                <div className="wm-pers">
                  <span className={`wm-ic ${ing1 ? "in" : "out"}`}>{ing1 ? "↓" : "↑"}</span>
                  <div title={m.created_by ? `Cargado por ${m.created_by}` : undefined}><b>{p.persona}</b><span>{p.concepto}</span></div>
                </div>
                <div className="wm-fh"><b>{fechaTxt(m.occurred_at)}</b><span>{horaTxt(m.occurred_at)}</span></div>
                <div>
                  {r ? <span className="wm-pill gris">Revertido</span> : rv ? <span className="wm-pill neutro">Reversión</span> : <span className={`wm-pill ${ing1 ? "in" : "out"}`}>{ing1 ? "Ingreso" : "Egreso"}</span>}
                </div>
                <div className={`wm-imp ${ing1 ? "in" : "out"}`}>{ing1 ? "+" : "−"}{nf(m.amount)} <small>USDT</small></div>
                <div>
                  {!r && (
                    <ActionsMenu items={[{ label: borrando === m.id ? "Revirtiendo..." : "Revertir…", onClick: () => onRevertir(m), disabled: borrando === m.id, danger: true }]} title="Más acciones" />
                  )}
                </div>
              </div>
            );
          })
        )}

        <div className="wm-pie">
          <div className="wm-tot">
            <span>Ingresos <b className="in">+{nf(ing)}</b></span>
            <span>Egresos <b className="out">−{nf(egr)}</b></span>
            <span>Neto <b className={neto >= 0 ? "in" : "out"}>{neto >= 0 ? "+" : "−"}{nf(Math.abs(neto))}</b></span>
            <small>de los movimientos filtrados · USDT</small>
          </div>
        </div>
        <div className="wm-pie2">
          <span className="muted">
            Mostrando {recorte.length} de {visibles.length} movimientos
            <label className="wm-tam">Ver
              <select className="wm-in" value={tamano} onChange={(e) => setTamano(Number(e.target.value))}>
                {TAMANOS.map((t) => <option key={t} value={t}>{t === 0 ? "Todos" : t}</option>)}
              </select>
            </label>
          </span>
          {tamano !== 0 && paginas > 1 && (
            <div className="wm-pag">
              <button type="button" className="wm-p" disabled={pag === 1} onClick={() => setPagina(pag - 1)}>‹ Anterior</button>
              {numeros.map((n, i) => n === "…" ? <span key={`p${i}`} className="wm-p dis">…</span> : <button key={n} type="button" className={`wm-p ${n === pag ? "on" : ""}`} onClick={() => setPagina(n)}>{n}</button>)}
              <button type="button" className="wm-p" disabled={pag === paginas} onClick={() => setPagina(pag + 1)}>Siguiente ›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
