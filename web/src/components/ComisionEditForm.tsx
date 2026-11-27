import { useState } from "react";
import { PcSeg } from "./PagoPiezas";

// Editar o quitar la comisión de un pago/cobro (27/11/2026, mockup 100) -- la usan Proveedores y Socios. Cambia el % o quién la
// paga; quien llama decide a qué endpoint va (pago de Supervisores o de Proveedores). 0 o vacío = sin comisión.
const fmt = (n: number) => `US$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function comisionDesdeConcepto(entry: any): { pct: number; importe: number; quien: "NOSOTROS" | "ELLOS" } {
  const c = String(entry?.concept ?? "");
  return {
    pct: Number((c.match(/Comisión ([\d.,]+)%/)?.[1] ?? "0").replace(",", ".")),
    importe: Number((c.match(/US\$ ([\d.,]+)/)?.[1] ?? "0").replace(/\./g, "").replace(",", ".")),
    quien: Number(entry?.amount) < 0 ? "ELLOS" : "NOSOTROS",
  };
}

export default function ComisionEditForm({
  descripcion,
  importe,
  pctInicial,
  quienInicial,
  nota,
  onGuardar,
  onCancel,
}: {
  descripcion: string;
  importe: number;
  pctInicial: number;
  quienInicial: "NOSOTROS" | "ELLOS";
  nota: string;
  onGuardar: (pct: number, quien: "NOSOTROS" | "ELLOS") => Promise<void>;
  onCancel: () => void;
}) {
  const [pct, setPct] = useState(pctInicial ? String(pctInicial).replace(".", ",") : "");
  const [quien, setQuien] = useState<"NOSOTROS" | "ELLOS">(quienInicial);
  const [msg, setMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const pctNum = pct.trim() === "" ? 0 : Number(pct.replace(",", "."));
  const pctOk = Number.isFinite(pctNum) && pctNum >= 0 && pctNum < 100;
  const nueva = pctOk ? Math.round(((importe * pctNum) / 100) * 100) / 100 : 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!pctOk) return setMsg("El % de comisión tiene que estar entre 0 y 100.");
    if (pctNum === pctInicial && quien === quienInicial) return onCancel();
    setGuardando(true);
    try {
      await onGuardar(pctNum, quien);
    } catch (err: any) {
      setMsg(err.message || "No se pudo guardar.");
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 12 }}>{descripcion}</div>
      <div className="form-grid">
        <div className="field">
          <label>% comisión (0 = sin comisión)</label>
          <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" placeholder="Ej. 2" />
          {importe > 0 && pctOk && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>= {fmt(nueva)}</div>}
        </div>
        <div className="field">
          <label>¿Quién la paga?</label>
          <PcSeg opciones={[{ value: "NOSOTROS", label: "Nosotros" }, { value: "ELLOS", label: "Nos la pagan" }]} value={quien} onChange={setQuien} />
        </div>
      </div>
      <div className="warnbox" style={{ marginBottom: 10 }}>{nota}</div>
      {msg && <div className="error">{msg}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancelar</button>
        <button className="btn" disabled={guardando}>{guardando ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </form>
  );
}
