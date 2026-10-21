import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { PortalPane, colorSigno, montoSigno } from "./PortalUI";

// Calculadora de cierre del portal (21/10/2026, pedido de Leo): supervisores y agentes simulan un cierre "de la misma manera que nosotros
// liquidamos". La cuenta la hace el servidor con la MISMA función del cierre real (POST /portal/calculadora-cierre); acá solo se cargan los números.
// Es solo informativa: no se guarda en el sistema ni toca ninguna cuenta. Lo que se escribe se recuerda en este navegador para poder seguir después.
type Sistema = "PREPAGO" | "WIN_LOSE";
interface Linea {
  id: string;
  nombre: string;
  sistema: Sistema;
  resultado: string;
  rake: string;
  rakebackPct: string;
  rebatePct: string;
  rodeo: string;
  ajuste: string;
}
interface Calculada {
  rakeback: number;
  rebate: number;
  resultadoAjustado: number;
  cierreFinal: number;
  aFichas: number;
  aCuentaCorriente: number;
}

const CLAVE = "dp_calculadora_cierre_v1";
const nuevoId = () => Math.random().toString(36).slice(2, 10);
const lineaVacia = (sistema: Sistema): Linea => ({ id: nuevoId(), nombre: "", sistema, resultado: "", rake: "", rakebackPct: "", rebatePct: "", rodeo: "", ajuste: "" });

// "1.234,56" y "1234.56" se leen igual; vacío = 0; texto raro = null (la línea no se calcula hasta corregirlo).
function aNumero(t: string): number | null {
  const s = t.trim();
  if (s === "") return 0;
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export default function CalculadoraCierre({
  activa,
  sistemaInicial,
  perspectiva,
}: {
  activa: boolean;
  sistemaInicial: Sistema;
  perspectiva: "supervisor" | "agente";
}) {
  const [lineas, setLineas] = useState<Linea[]>(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
      if (Array.isArray(guardado) && guardado.length > 0) return guardado as Linea[];
    } catch {
      /* sin almacenamiento: arranca vacío */
    }
    return [lineaVacia(sistemaInicial)];
  });
  const [calculo, setCalculo] = useState<{ lineas: Calculada[]; totales: Record<string, number> } | null>(null);
  const [error, setError] = useState("");
  const turno = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(lineas));
    } catch {
      /* no pasa nada */
    }
  }, [lineas]);

  // Recalcula solo, unos instantes después de dejar de tipear.
  useEffect(() => {
    const parseadas = lineas.map((l) => ({
      sistema: l.sistema,
      resultado: aNumero(l.resultado),
      rake: aNumero(l.rake),
      rakebackPct: aNumero(l.rakebackPct),
      rebatePct: aNumero(l.rebatePct),
      rodeo: aNumero(l.rodeo),
      ajuste: aNumero(l.ajuste),
    }));
    if (parseadas.some((p) => [p.resultado, p.rake, p.rakebackPct, p.rebatePct, p.rodeo, p.ajuste].some((v) => v === null))) {
      setError("Hay un número mal escrito: revisá los campos marcados.");
      return;
    }
    setError("");
    const mio = ++turno.current;
    const t = setTimeout(() => {
      api
        .calcularCierrePortal(parseadas as any)
        .then((r: any) => {
          if (mio === turno.current) setCalculo(r);
        })
        .catch((e: any) => {
          if (mio === turno.current) setError(e.message || "No se pudo calcular.");
        });
    }, 350);
    return () => clearTimeout(t);
  }, [lineas]);

  const cambiar = (id: string, campo: keyof Linea, valor: string) => setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)));
  const quitar = (id: string) => setLineas((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : [lineaVacia(sistemaInicial)]));
  const duplicar = (id: string) =>
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i < 0) return prev;
      const copia = { ...prev[i], id: nuevoId(), nombre: prev[i].nombre ? `${prev[i].nombre} (copia)` : "" };
      return [...prev.slice(0, i + 1), copia, ...prev.slice(i + 1)];
    });

  const campo = (l: Linea, k: keyof Linea, etiqueta: string, sufijo?: string) => {
    const mal = aNumero(String(l[k])) === null;
    return (
      <div className="field" style={{ margin: 0 }}>
        <label style={{ fontSize: 11.5 }}>{etiqueta}</label>
        <input
          value={String(l[k])}
          onChange={(e) => cambiar(l.id, k, e.target.value)}
          inputMode="decimal"
          placeholder={sufijo ?? "0"}
          style={mal ? { borderColor: "var(--red)" } : undefined}
        />
      </div>
    );
  };

  const t = calculo?.totales;
  const hayPrepago = lineas.some((l) => l.sistema === "PREPAGO");

  return (
    <PortalPane activa={activa} titulo="Calculadora de cierre">
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
        Armá un cierre cargando, por cada línea, el resultado y el rake de la semana y los porcentajes. Usa la <b>misma cuenta que el cierre real</b>
        {" "}(rakeback = rake × %, rebate = (resultado + rake) × %, cierre = resultado + rakeback + rebate + rodeo + ajuste).{" "}
        <b>Es solo informativa:</b> no se guarda en el sistema ni cambia tu cuenta. Podés cambiar los números cuantas veces quieras.
      </div>

      {lineas.map((l, i) => {
        const c = calculo?.lineas[i];
        return (
          <div key={l.id} className="pt-card" style={{ marginBottom: 10 }}>
            <div className="b">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  value={l.nombre}
                  onChange={(e) => cambiar(l.id, "nombre", e.target.value)}
                  placeholder={perspectiva === "supervisor" ? `Agente o referencia (línea ${i + 1})` : `Club o referencia (línea ${i + 1})`}
                  style={{ flex: "1 1 160px", minWidth: 0 }}
                />
                <select value={l.sistema} onChange={(e) => cambiar(l.id, "sistema", e.target.value)}>
                  <option value="PREPAGO">Prepago</option>
                  <option value="WIN_LOSE">Win/Lose</option>
                </select>
                <button type="button" className="btn secondary small" onClick={() => duplicar(l.id)} title="Duplicar esta línea">Duplicar</button>
                <button type="button" className="btn secondary small" onClick={() => quitar(l.id)} title="Quitar esta línea">Quitar</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                {campo(l, "resultado", "Resultado (US$)", "ganó + / perdió −")}
                {campo(l, "rake", "Rake total (US$)")}
                {campo(l, "rakebackPct", "% Rakeback", "ej. 70")}
                {campo(l, "rebatePct", "% Rebate", "ej. 0")}
                {campo(l, "rodeo", "Rodeo (US$)")}
                {campo(l, "ajuste", "Ajuste (US$)", "+ / −")}
              </div>
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div className="saldo-sub" style={{ margin: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <span>Rakeback <b>{c ? montoSigno(c.rakeback) : "—"}</b></span>
                  <span>Rebate <b>{c ? montoSigno(c.rebate) : "—"}</b></span>
                  {l.sistema === "PREPAGO" && c && <span>Fichas <b>{montoSigno(c.aFichas)}</b> · Cta. corriente <b>{montoSigno(c.aCuentaCorriente)}</b></span>}
                </div>
                <div style={{ fontSize: 20, fontWeight: 750, color: c ? colorSigno(c.cierreFinal) : "var(--text-dim)" }}>
                  {c ? montoSigno(c.cierreFinal) : "—"}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 14px" }}>
        <button type="button" className="btn secondary" onClick={() => setLineas((prev) => [...prev, lineaVacia(sistemaInicial)])}>+ Agregar línea</button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => {
            if (confirm("¿Borrar todas las líneas de la calculadora?")) setLineas([lineaVacia(sistemaInicial)]);
          }}
        >
          Limpiar todo
        </button>
      </div>

      {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="panel" style={{ margin: 0, padding: "14px 16px", background: "var(--panel-2)" }}>
        <div className="saldo-sub" style={{ margin: 0 }}>Cierre total ({lineas.length} línea{lineas.length === 1 ? "" : "s"})</div>
        <div className="saldo-big" style={{ fontSize: 28, color: t ? colorSigno(t.cierreFinal) : "var(--text-dim)" }}>{t ? montoSigno(t.cierreFinal) : "—"}</div>
        <div className="saldo-sub" style={{ marginTop: 6 }}>
          {perspectiva === "supervisor"
            ? "Positivo: se le debe a los agentes. Negativo: te deben a vos."
            : "Positivo: te debemos. Negativo: nos debés."}
          {t ? <> · Rakeback {montoSigno(t.rakeback)} · Rebate {montoSigno(t.rebate)}</> : null}
        </div>
        {t && hayPrepago && (
          <div className="saldo-sub" style={{ marginTop: 4 }}>
            En Prepago, el resultado de mesas va a Fichas reales ({montoSigno(t.aFichas)}) y lo demás a Cuenta corriente ({montoSigno(t.aCuentaCorriente)}).
          </div>
        )}
      </div>
    </PortalPane>
  );
}
