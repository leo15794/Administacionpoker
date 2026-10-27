import { useEffect, useState, type ReactNode } from "react";
import Cifra from "./Cifra";

// Piezas comunes de las listas con el estilo de la Wallet (23/10/2026, pedido de Leo: "que quede uniforme en todo el sistema"): tarjeta de
// saldo, pestañas con contador, pie con totales y paginación (10 / 25 / 50 / 100 / todos). Los estilos son los `wm-*` de index.css. Las usan
// Wallet (WalletMovimientos.tsx), Administración (Agentes.tsx) y las demás listas a medida que se migran.

export const TAMANOS = [10, 25, 50, 100, 0]; // 0 = todos

function leerTamano(clave: string): number {
  try {
    const raw = localStorage.getItem(clave);
    const v = raw === null ? NaN : (JSON.parse(raw) as number);
    return TAMANOS.includes(v) ? v : 25;
  } catch {
    return 25;
  }
}

export interface Paginado<T> {
  recorte: T[];
  total: number;
  tamano: number;
  setTamano: (n: number) => void;
  pagina: number;
  setPagina: (n: number) => void;
  paginas: number;
  numeros: (number | "…")[];
}

/** Corta `items` en páginas. El tamaño elegido se recuerda en localStorage (`claveTam`); la página vuelve a la 1 cuando cambia algo de `reset`. */
export function usePaginado<T>(items: T[], claveTam: string, reset: unknown[]): Paginado<T> {
  const [tamano, setTamano] = useState<number>(() => leerTamano(claveTam));
  const [pagina, setPagina] = useState(1);
  useEffect(() => {
    try { localStorage.setItem(claveTam, JSON.stringify(tamano)); } catch { /* sin almacenamiento: no pasa nada */ }
  }, [claveTam, tamano]);
  const porPagina = tamano === 0 ? Math.max(items.length, 1) : tamano;
  const paginas = Math.max(1, Math.ceil(items.length / porPagina));
  const pag = Math.min(pagina, paginas);
  const recorte = items.slice((pag - 1) * porPagina, pag * porPagina);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPagina(1); }, [...reset, tamano]);
  const numeros: (number | "…")[] = [];
  for (let i = 1; i <= paginas; i++) if (i === 1 || i === paginas || Math.abs(i - pag) <= 1) numeros.push(i); else if (numeros[numeros.length - 1] !== "…") numeros.push("…");
  return { recorte, total: items.length, tamano, setTamano, pagina: pag, setPagina, paginas, numeros };
}

/** "Mostrando X de Y <unidad>", selector de cantidad por página y botones de página. */
export function WmPaginacion<T>({ p, unidad }: { p: Paginado<T>; unidad: string }) {
  return (
    <div className="wm-pie2">
      <span className="muted">
        Mostrando {p.recorte.length} de {p.total} {unidad}
        <label className="wm-tam">Ver
          <select className="wm-in" value={p.tamano} onChange={(e) => p.setTamano(Number(e.target.value))}>
            {TAMANOS.map((t) => <option key={t} value={t}>{t === 0 ? "Todos" : t}</option>)}
          </select>
        </label>
      </span>
      {p.tamano !== 0 && p.paginas > 1 && (
        <div className="wm-pag">
          <button type="button" className="wm-p" disabled={p.pagina === 1} onClick={() => p.setPagina(p.pagina - 1)}>‹ Anterior</button>
          {p.numeros.map((n, i) => n === "…" ? <span key={`p${i}`} className="wm-p dis">…</span> : <button key={n} type="button" className={`wm-p ${n === p.pagina ? "on" : ""}`} onClick={() => p.setPagina(n)}>{n}</button>)}
          <button type="button" className="wm-p" disabled={p.pagina === p.paginas} onClick={() => p.setPagina(p.pagina + 1)}>Siguiente ›</button>
        </div>
      )}
    </div>
  );
}

export interface WmTab<K extends string> {
  k: K;
  t: ReactNode;
  n?: number;
  title?: string;
}

/** Pestañas con subrayado y contador. */
export function WmTabs<K extends string>({ tabs, actual, onChange }: { tabs: WmTab<K>[]; actual: K; onChange: (k: K) => void }) {
  return (
    <div className="wm-tabs" role="tablist">
      {tabs.map((x) => (
        <button key={x.k} type="button" role="tab" aria-selected={actual === x.k} title={x.title} className={actual === x.k ? "on" : ""} onClick={() => onChange(x.k)}>
          {x.t}{x.n !== undefined && <> <i>{x.n}</i></>}
        </button>
      ))}
    </div>
  );
}

/** Tarjeta grande de arriba: etiqueta, monto grande, línea chica y, a la derecha, lo que se pase (botones o conteos). */
export function WmSaldoCard({ etiqueta, monto, sub, signo, color, children }: { etiqueta: string; monto: ReactNode; sub?: ReactNode; signo?: "pos" | "neg" | ""; color?: string; children?: ReactNode }) {
  return (
    <div className="wm-card wm-saldo">
      <div>
        <div className="wm-lbl">{etiqueta}</div>
        <div className={`wm-big ${signo ?? ""}`} style={color ? { color } : undefined}>{typeof monto === "string" ? <Cifra texto={monto} /> : monto}</div>
        {sub && <div className="muted" style={{ fontSize: 13 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/** Conteos de la derecha de la tarjeta de saldo (CON SALDO 41 · EN US$ 0 49 · ...). */
export function WmConteos({ items }: { items: { etiqueta: string; valor: ReactNode }[] }) {
  return (
    <div className="ag-resumen">
      {items.map((x, i) => <div key={x.etiqueta}><span className="wm-lbl">{x.etiqueta}</span><b>{typeof x.valor === "string" || typeof x.valor === "number" ? <Cifra texto={String(x.valor)} retraso={150 * (i + 1)} /> : x.valor}</b></div>)}
    </div>
  );
}
