// Piezas del formulario de pago/cobro unificado (04/11/2026, mockup 68 aprobado por Leo): el mismo
// diseño para Supervisores, Agentes y Proveedores -- importe grande arriba (o la suma de lo
// tildado), filas en tarjetas que se completan solas con lo pendiente al tildarlas, selector
// segmentado y el resumen "antes → después". Cada formulario arma su lógica y usa estas piezas.
import type { ReactNode } from "react";

export const fmtPc = (n: number) => `${n < -0.004 ? "−" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const numPc = (v: string) => Number(String(v).replace(",", "."));

/** Importe a mano (nada tildado): input grande + botones rápidos. */
export function PcImporte({ label, value, onChange, chips }: { label: string; value: string; onChange: (v: string) => void; chips?: { label: string; value: string }[] }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="pc-big" value={value} onChange={(e) => onChange(e.target.value)} placeholder="0,00" inputMode="decimal" autoFocus />
      {chips && chips.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {chips.map((c) => (
            <button key={c.label} type="button" className="chip" onClick={() => onChange(c.value)}>{c.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Con filas tildadas: el total es la suma y no se escribe a mano. */
export function PcTotal({ label, monto, sub }: { label: string; monto: number; sub: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pc-big pc-big-ro"><span>{fmtPc(monto)}</span><small>{sub}</small></div>
    </div>
  );
}

export interface PcFila {
  id: string;
  titulo: ReactNode;
  detalle: ReactNode;
}

/** Filas tildables (agentes o líneas de cierre). Al tildar, el padre completa el importe con lo pendiente. */
export function PcLista({ filas, sel, onToggle, onMonto, completadas }: {
  filas: PcFila[];
  sel: Record<string, string>;
  onToggle: (id: string, on: boolean) => void;
  onMonto: (id: string, v: string) => void;
  completadas?: Record<string, boolean>;
}) {
  return (
    <div className="pc-ags">
      {filas.map((f) => {
        const on = f.id in sel;
        return (
          <div key={f.id} className={`pc-ag ${on ? "on" : ""}`}>
            <input type="checkbox" checked={on} onChange={(e) => onToggle(f.id, e.target.checked)} aria-label="Elegir" />
            <div>
              <b>{f.titulo}</b>
              <small>{f.detalle}</small>
            </div>
            <div>
              <input className="pc-imp" value={on ? sel[f.id] : ""} disabled={!on} placeholder="0,00" inputMode="decimal" onChange={(e) => onMonto(f.id, e.target.value)} />
              {on && completadas?.[f.id] && <div className="pc-fill">completado solo</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PcSeg<T extends string>({ opciones, value, onChange }: { opciones: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="pc-seg" role="radiogroup">
      {opciones.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface PcResumenFila {
  label: string;
  antes?: number;
  despues?: number;
  valor?: ReactNode;
  total?: boolean;
}

export function PcResumen({ filas }: { filas: PcResumenFila[] }) {
  return (
    <div className="pc-res">
      {filas.map((f, i) => (
        <div key={i} className={f.total ? "t" : ""}>
          <span className={f.total ? "" : "muted"}>{f.label}</span>
          <span>
            {f.valor ?? (
              <>
                {fmtPc(f.antes ?? 0)} → <b className={(f.despues ?? 0) < -0.004 ? "neg" : f.total && (f.despues ?? 0) > 0.004 ? "pos" : ""}>{fmtPc(f.despues ?? 0)}</b>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
