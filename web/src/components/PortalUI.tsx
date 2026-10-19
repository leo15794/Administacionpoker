import type { ReactNode } from "react";
import { usdCents, dateShort } from "../fmt";
import { TIPO_LABEL } from "./MovimientosHistorial";

// (19/10/2026, pedido de Leo: "programá los 3 portales" -- mockups aprobados) Piezas compartidas
// por los portales de agente, supervisor y proveedor (Mi cuenta / Mi supervisión / Mi proveedor):
// tarjeta principal, tarjetas chicas, pestañas (en celular) y filas/tarjetas en vez de tablas.
// Solo presentación -- los datos y endpoints de cada portal no cambian.

export const colorSigno = (n: number) => (n < 0 ? "var(--red)" : "var(--green)");

/** "-US$ 1.234,56" con el signo siempre pegado al monto. */
export function montoSigno(n: number) {
  return `${n < 0 ? "−" : ""}${usdCents(Math.abs(n))}`;
}

/** Ícono + nombre legible de cada tipo de movimiento (antes se veía el nombre interno en crudo). */
export function tipoVisual(type: string): { glyph: string; cls: string; label: string } {
  const label = TIPO_LABEL[type] ?? type;
  switch (type) {
    case "CARGA": return { glyph: "+", cls: "g", label };
    case "DESCARGA": return { glyph: "−", cls: "r", label };
    case "COBRO":
    case "COBRO_RAKEBACK": return { glyph: "↙", cls: "n", label };
    case "PAGO":
    case "PAGO_RAKEBACK": return { glyph: "↗", cls: "g", label };
    case "AJUSTE": return { glyph: "±", cls: "gold", label };
    case "TICKET_PROMOCIONAL": return { glyph: "★", cls: "gold", label };
    case "TRANSFERENCIA_ENTRE_CLUBES": return { glyph: "⇄", cls: "n", label };
    case "ADELANTO_FICHAS":
    case "ADELANTO_RAKEBACK": return { glyph: "◔", cls: "gold", label };
    case "CIERRE_SEMANAL": return { glyph: "∑", cls: "n", label };
    default: return { glyph: "·", cls: "n", label };
  }
}

export function PortalTop({ hero, minis }: { hero: ReactNode; minis: ReactNode[] }) {
  return (
    <div className="pt-top" style={{ ["--n" as any]: Math.max(minis.length, 1) }}>
      {hero}
      {minis.length > 0 && <div className="pt-minis">{minis}</div>}
    </div>
  );
}

export function PortalHero({
  label,
  amount,
  color,
  foot,
  cta,
}: {
  label: string;
  amount: string;
  color: string;
  foot?: ReactNode;
  cta?: { label: string; onClick: () => void };
}) {
  return (
    <div className="tb-hero pt-hero">
      <div className="tb-hero-label">{label}</div>
      <div className="tb-hero-amount" style={{ color }}>{amount}</div>
      {foot && <div className="tb-hero-foot">{foot}</div>}
      {cta && (
        <button className="btn pt-cta" onClick={cta.onClick}>
          {cta.label}
        </button>
      )}
    </div>
  );
}

export function PortalMini({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="pt-kmini">
      <div className="l">{label}</div>
      <div className="v" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

/** Pestañas: solo se ven en celular (en escritorio se muestra todo a la vez, en dos columnas). */
export function PortalTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <div className="tabs cargar-tabs pt-tabs">
      {tabs.map((t) => (
        <button key={t.key} className={value === t.key ? "active" : ""} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count !== undefined ? ` ${t.count}` : ""}
        </button>
      ))}
    </div>
  );
}

export function PortalCols({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="pt-cols">
      <div className="pt-col">{left}</div>
      <div className="pt-col">{right}</div>
    </div>
  );
}

/** Un bloque de contenido: pestaña en celular, panel en escritorio. */
export function PortalPane({ activa, titulo, children }: { activa: boolean; titulo: string; children: ReactNode }) {
  return (
    <section className={`pt-pane${activa ? " activa" : ""}`}>
      <h3 className="pt-h">{titulo}</h3>
      {children}
    </section>
  );
}

export function PortalEmpty({ children }: { children: ReactNode }) {
  return <div className="pt-empty">{children}</div>;
}

/** Tarjeta con acento a la izquierda según el signo: semana de cierre, club con saldo, agente. */
export function PortalCard({
  titulo,
  monto,
  izq,
  der,
  rev,
  barra,
}: {
  titulo: ReactNode;
  monto: number;
  izq?: ReactNode;
  der?: ReactNode;
  rev?: boolean;
  barra?: ReactNode;
}) {
  return (
    <div className={`pt-card${monto < 0 ? " ng" : ""}${rev ? " rev" : ""}`}>
      <div className="b">
        <div className="t1">
          <span className="n">{titulo}</span>
          <span className="amt" style={{ color: colorSigno(monto) }}>{montoSigno(monto)}</span>
        </div>
        {(izq || der) && (
          <div className="t2">
            <span>{izq}</span>
            <span>{der}</span>
          </div>
        )}
        {barra}
      </div>
    </div>
  );
}

/** Barra divergente (cero al centro): crece a la derecha si es positivo y a la izquierda si es negativo. */
export function BarraDivergente({ monto, max }: { monto: number; max: number }) {
  const w = max > 0 ? (Math.abs(monto) / max) * 50 : 0;
  return (
    <div className="pt-bar">
      <span className="cero" />
      <i style={monto < 0 ? { right: "50%", width: `${w}%`, background: "var(--red)" } : { left: "50%", width: `${w}%`, background: "var(--green)" }} />
    </div>
  );
}

/** Fila de movimiento: ícono, título, detalle y monto a la derecha. */
export function MovRow({
  type,
  titulo,
  detalle,
  monto,
  obs,
  atenuada,
  extra,
}: {
  type: string;
  titulo?: string;
  detalle: string;
  monto: number;
  obs?: string | null;
  atenuada?: boolean;
  extra?: ReactNode;
}) {
  const v = tipoVisual(type);
  return (
    <div className={`mov-row${atenuada ? " revertido" : ""}`}>
      <div className={`mov-ic ${v.cls}`}>{v.glyph}</div>
      <div className="mov-mid">
        <div className="mov-l1">{titulo ?? v.label} {extra}</div>
        <div className="mov-l2">{detalle}</div>
        {obs && <div className="mov-obs">{obs}</div>}
      </div>
      <div className="mov-amt" style={monto < 0 ? { color: "var(--red)" } : undefined}>{montoSigno(monto)}</div>
    </div>
  );
}

/** Lista de solicitudes de retiro/pago propias (supervisor y proveedor): estado + link de pago. */
export function SolicitudesRetiro({ items }: { items: any[] | null }) {
  if (!items) return <div className="muted">Cargando...</div>;
  if (items.length === 0) {
    return (
      <PortalEmpty>
        Todavía no pediste ningún retiro. Cuando pidas uno vas a ver acá si está pendiente de envío, enviado (con el link para
        trackearlo) o rechazado.
      </PortalEmpty>
    );
  }
  return (
    <div>
      {items.map((s: any) => (
        <div key={s.id} className={`pt-card${s.estado === "PENDIENTE" ? " pend" : ""}`}>
          <div className="b">
            <div className="t1">
              <span className="n">{usdCents(Number(s.amount))}</span>
              <span>
                {s.estado === "PENDIENTE" && <span className="pill a">Pendiente de envío</span>}
                {s.estado === "ENVIADO" && <span className="pill g">Enviado el {dateShort(s.resuelto_at)}</span>}
                {s.estado === "RECHAZADO" && <span className="pill r" title={s.resolucion_nota || undefined}>Rechazada</span>}
              </span>
            </div>
            <div className="t2">
              <span>{dateShort(s.requested_at)}{s.nota ? ` · ${s.nota}` : ""}</span>
              <span>
                {s.payment_link ? (
                  <a className="link-pago" href={s.payment_link} target="_blank" rel="noreferrer">Ver pago ↗</a>
                ) : null}
              </span>
            </div>
            {s.estado === "RECHAZADO" && s.resolucion_nota && <div className="mov-obs">{s.resolucion_nota}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
