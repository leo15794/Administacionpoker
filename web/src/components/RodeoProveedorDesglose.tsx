import { usdCents } from "../fmt";

// Desglose del rodeo de una línea de club de Proveedores con la memoria del proveedor (24/11/2026, pedido de Leo):
// neto del club esa semana → 35% → menos la memoria que venía = lo que entra al cierre; y la memoria que queda.
// Semana negativa: no hay 35% y el neto entero pasa a la memoria.
export interface RodeoProveedorDetalle {
  netoClub: number;
  parte35: number;
  memoriaAnterior: number;
  tapado: number;
  memoriaNueva: number;
  manual: number;
  monto: number;
}

function parse(d: any): RodeoProveedorDetalle | null {
  if (!d) return null;
  const x = typeof d === "string" ? JSON.parse(d) : d;
  if (x.netoClub === undefined || x.parte35 === undefined) return null;
  return x;
}

const n = (x: number) => usdCents(Number(x));

// Texto en una línea (para celdas de tabla).
export function textoRodeoProveedor(d: any): string | null {
  const x = parse(d);
  if (!x) return null;
  if (Math.abs(x.netoClub) < 0.005 && Math.abs(x.memoriaAnterior) < 0.005 && Math.abs(x.manual) < 0.005) return null;
  const partes: string[] = [`Neto del club ${n(x.netoClub)}`];
  if (x.netoClub < 0) partes.push("semana negativa: sin rodeo, pasa a memoria");
  else partes.push(`35% ${n(x.parte35)}`);
  if (x.tapado > 0.004) partes.push(`− memoria ${n(x.tapado)}`);
  if (Math.abs(x.manual) > 0.004) partes.push(`+ cargado a mano ${n(x.manual)}`);
  partes.push(x.memoriaNueva > 0.004 ? `queda memoria ${n(x.memoriaNueva)}` : "sin memoria");
  return partes.join(" · ");
}

export default function RodeoProveedorDesglose({ detalle, compacto }: { detalle: any; compacto?: boolean }) {
  const x = parse(detalle);
  if (!x) return null;
  if (compacto) {
    const t = textoRodeoProveedor(x);
    return t ? <div className="muted" style={{ fontSize: 11.5, marginTop: 2, whiteSpace: "normal" }}>{t}</div> : null;
  }
  const fila = (label: string, valor: string, fuerte?: boolean, tono?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: fuerte ? 700 : 500, color: tono }}>{valor}</span>
    </div>
  );
  return (
    <div style={{ fontSize: 12.5, display: "grid", gap: 3, padding: "8px 10px", borderRadius: 10, background: "var(--panel-2)" }}>
      {fila("Rodeo neto del club", n(x.netoClub))}
      {fila("35% del proveedor", x.netoClub < 0 ? "sin rodeo (semana negativa)" : n(x.parte35))}
      {fila("Memoria que venía", n(x.memoriaAnterior))}
      {x.tapado > 0.004 && fila("Se descuenta de memoria", `− ${n(x.tapado)}`)}
      {Math.abs(x.manual) > 0.004 && fila("Rodeo cargado a mano", n(x.manual))}
      {fila("Rodeo de la semana", n(x.monto), true)}
      {fila("Memoria que queda", n(x.memoriaNueva), true, x.memoriaNueva > 0.004 ? "var(--red)" : undefined)}
    </div>
  );
}
