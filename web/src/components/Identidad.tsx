import type { ReactNode } from "react";

// Piezas del rediseño "identidad" (06/11/2026, mockup 83 aprobado por Leo: "tiene que ser para todos los lugares"). Las usa cada pantalla
// para no verse como una plantilla genérica: chips de contexto debajo del título, la caja "Para hacer" con lo pendiente de esa pantalla y la
// barra que muestra el tamaño de cada saldo frente al resto. Estilos: bloque "IDENTIDAD" al final de index.css.

export interface ChipContexto {
  texto: ReactNode;
  /** "alerta" = ámbar con punto (algo pendiente); "fuerte" = chip blanco (la semana o el período que se mira) */
  tono?: "alerta" | "fuerte" | "";
  icono?: ReactNode;
  onClick?: () => void;
  title?: string;
}

/** Línea de chips debajo del título de la pantalla: qué se está mirando (semana, cantidad) y si hay algo pendiente. */
export function Contexto({ chips }: { chips: (ChipContexto | null | false | undefined)[] }) {
  const lista = chips.filter(Boolean) as ChipContexto[];
  if (lista.length === 0) return null;
  return (
    <div className="ctx-chips">
      {lista.map((c, i) => {
        const cls = `ctx-chip ${c.tono ?? ""} ${c.onClick ? "click" : ""}`;
        const cont = (
          <>
            {c.tono === "alerta" && <span className="ctx-pd" />}
            {c.icono}
            {c.texto}
          </>
        );
        return c.onClick ? (
          <button key={i} type="button" className={cls} onClick={c.onClick} title={c.title}>{cont}</button>
        ) : (
          <span key={i} className={cls} title={c.title}>{cont}</span>
        );
      })}
    </div>
  );
}

export const IconoSemana = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export interface ItemParaHacer {
  clave: string;
  /** "urgente" = ámbar resaltado; "deuda" = rojo; "info" = acento */
  tipo: "urgente" | "deuda" | "info";
  icono?: ReactNode;
  titulo: ReactNode;
  sub?: ReactNode;
  monto?: ReactNode;
  montoNeg?: boolean;
  accion?: { texto: string; onClick: () => void };
}

/** Caja "Para hacer": lo pendiente de la pantalla, con la acción a mano. Si no hay nada, queda un "Todo al día" chico. */
export function ParaHacer({ items, titulo = "Para hacer", vacio = "Todo al día" }: { items: ItemParaHacer[]; titulo?: string; vacio?: string }) {
  return (
    <div className="wm-card ph-card">
      <div className="ph-t">
        <span><span className="palo r">♦</span> {titulo}</span>
        {items.length > 0 && <span className="ph-cnt">{items.length}</span>}
      </div>
      {items.length === 0 ? (
        <div className="ph-vacio"><span className="ph-ok">✓</span>{vacio}</div>
      ) : (
        items.map((x) => (
          <div key={x.clave} className={`ph-it ${x.tipo === "urgente" ? "hot" : ""}`}>
            <i className={`ph-ic ${x.tipo}`}>{x.icono ?? (x.tipo === "urgente" ? "↓" : x.tipo === "deuda" ? "!" : "◷")}</i>
            <div className="ph-tx"><b>{x.titulo}</b>{x.sub && <small>{x.sub}</small>}</div>
            <div className="ph-m">
              {x.monto != null && <span className={x.montoNeg ? "neg" : ""}>{x.monto}</span>}
              {x.accion && (
                <button type="button" className={`ph-go ${x.tipo === "urgente" ? "" : "s"}`} onClick={x.accion.onClick}>{x.accion.texto}</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** Saldo con una barra detrás que muestra su tamaño frente al mayor de la lista (`max` = mayor valor absoluto). */
export function BarraSaldo({ valor, max, children, className = "" }: { valor: number; max: number; children: ReactNode; className?: string }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(valor) / max) * 100) : 0;
  const tono = valor < -0.004 ? "neg" : valor > 0.004 ? "pos" : "";
  return (
    <span className={`barra-saldo ${className}`}>
      {pct > 0.5 && <span className={`bs-bg ${tono}`} style={{ width: `${Math.max(pct, 6)}%` }} />}
      <span className="bs-v">{children}</span>
    </span>
  );
}

/** Portada de la pantalla: la tarjeta protagonista a la izquierda y "Para hacer" a la derecha (abajo en celular). */
export function Portada({ children, lado }: { children: ReactNode; lado?: ReactNode }) {
  if (!lado) return <>{children}</>;
  return (
    <div className="portada">
      <div className="portada-main">{children}</div>
      {lado}
    </div>
  );
}
