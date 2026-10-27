import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { dateShort, usdCents } from "../fmt";
import { PortalPane, colorSigno, montoSigno } from "./PortalUI";
import Cifra from "./Cifra";

// Calculadora de cierre del portal (21/10/2026, pedido de Leo): supervisores y agentes simulan un cierre "de la misma manera que nosotros
// liquidamos". La cuenta la hace el servidor con la MISMA función del cierre real (POST /portal/calculadora-cierre); acá solo se cargan los números.
// Es solo informativa: no se guarda en el sistema ni toca ninguna cuenta, y NO llega a nosotros -- cada supervisor decide qué le da a cada agente.
// Lo que se escribe se recuerda en este navegador para poder seguir después.
//
// "Traer agente" (21/10/2026, pedido de Leo, solo supervisores con cuenta consolidada): en vez de tipear todo, se elige una semana y un agente (o todos)
// y se trae su cierre real (resultado, rake, rodeo, rebate) -- esos datos quedan fijos y lo único que el supervisor define es el % de rakeback.
type Sistema = "PREPAGO" | "WIN_LOSE";
interface Origen {
  agente: string;
  club: string;
  jugadores: number | null;
  rakebackRealPct: number; // el rakeback real del cierre, en % (solo de referencia)
  rakebackRealMonto: number;
}
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
  pagaRodeo?: boolean; // ¿le pago el rodeo a su jugador? (por defecto sí); si es no, el rodeo no entra al cierre
  rodeoPct?: string; // si le paga: qué % del rodeo (por defecto 100)
  origen?: Origen; // si viene de un cierre real
  editable?: boolean; // una línea traída se puede "destrabar" para tocar todo a mano
}
interface Calculada {
  rakeback: number;
  rebate: number;
  resultadoAjustado: number;
  cierreFinal: number;
  aFichas: number;
  aCuentaCorriente: number;
}

const CLAVE = "dp_calculadora_cierre_v2";
const nuevoId = () => Math.random().toString(36).slice(2, 10);
const lineaVacia = (sistema: Sistema): Linea => ({ id: nuevoId(), nombre: "", sistema, resultado: "", rake: "", rakebackPct: "", rebatePct: "", rodeo: "", ajuste: "", pagaRodeo: true, rodeoPct: "100" });
const aTexto = (n: number) => String(Math.round(n * 10000) / 10000).replace(".", ",");

// "1.234,56" y "1234.56" se leen igual; vacío = 0; texto raro = null (la línea no se calcula hasta corregirlo).
function aNumero(t: string): number | null {
  const s = t.trim();
  if (s === "") return 0;
  const limpio = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

// Rodeo que realmente entra al cierre: 0 si el supervisor no se lo paga; si se lo paga, el % elegido (100 por defecto).
function rodeoPagado(l: Linea): number | null {
  const r = aNumero(l.rodeo);
  if (r === null) return null;
  if (l.pagaRodeo === false) return 0;
  const pct = aNumero(l.rodeoPct ?? "100");
  return pct === null ? null : Math.round(r * pct) / 100;
}

export default function CalculadoraCierre({
  activa,
  sistemaInicial,
  perspectiva,
  permitirTraer = false,
}: {
  activa: boolean;
  sistemaInicial: Sistema;
  perspectiva: "supervisor" | "agente";
  /** Solo supervisores con cuenta consolidada: habilita "Traer agente" desde su cierre semanal real. */
  permitirTraer?: boolean;
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

  // ---- Traer agente ----
  const [semanas, setSemanas] = useState<any[] | null>(null);
  const [semana, setSemana] = useState("");
  const [cierre, setCierre] = useState<any | null>(null);
  const [agenteId, setAgenteId] = useState("todos");
  const [traerMsg, setTraerMsg] = useState("");
  const [cargandoCierre, setCargandoCierre] = useState(false);

  useEffect(() => {
    if (!permitirTraer) return;
    api
      .miSupervisionSemanasCierre()
      .then((r: any[]) => {
        setSemanas(r);
        if (r[0]) setSemana(String(r[0].week_start).slice(0, 10));
      })
      .catch(() => setSemanas([]));
  }, [permitirTraer]);

  useEffect(() => {
    if (!permitirTraer || !semana) return;
    setCargandoCierre(true);
    setCierre(null);
    setAgenteId("todos");
    api
      .miSupervisionCierreSemanal(semana)
      .then(setCierre)
      .catch(() => setCierre(null))
      .finally(() => setCargandoCierre(false));
  }, [permitirTraer, semana]);

  const agentesConCierre: any[] = (cierre?.lineas ?? []).filter((l: any) => (l.detalle ?? []).length > 0);

  function lineasDe(agentes: any[]): Linea[] {
    const salida: Linea[] = [];
    for (const a of agentes) {
      for (const d of a.detalle ?? []) {
        const base = Number(d.result) + Number(d.rake_total);
        // el % de rebate se deduce del monto del cierre real (rebate = (resultado + rake) × %)
        const rebatePct = Math.abs(base) > 0.0001 ? Math.round((Number(d.rebate) / base) * 10000) / 100 : 0;
        salida.push({
          id: nuevoId(),
          nombre: `${a.agent_name} · ${d.club_name}`,
          sistema: d.system === "PREPAGO" ? "PREPAGO" : "WIN_LOSE",
          resultado: aTexto(Number(d.result)),
          rake: aTexto(Number(d.rake_total)),
          rakebackPct: aTexto(Math.round(Number(d.rakeback_pct) * 10000) / 100), // arranca con el % real; el supervisor lo cambia
          rebatePct: aTexto(rebatePct),
          rodeo: aTexto(Number(d.rodeo)),
          ajuste: "",
          pagaRodeo: true,
          rodeoPct: "100",
          origen: {
            agente: a.agent_name,
            club: d.club_name,
            jugadores: d.jugadores ?? null,
            rakebackRealPct: Math.round(Number(d.rakeback_pct) * 10000) / 100,
            rakebackRealMonto: Number(d.rakeback),
          },
        });
      }
    }
    return salida;
  }

  function traer() {
    setTraerMsg("");
    const elegidos = agenteId === "todos" ? agentesConCierre : agentesConCierre.filter((a) => a.agent_id === agenteId);
    const nuevas = lineasDe(elegidos);
    if (nuevas.length === 0) return setTraerMsg("Ese agente no tiene cierre cargado esa semana.");
    // Si solo está la línea vacía de arranque, se reemplaza; si no, se agregan al final (y no se repite una línea ya traída).
    setLineas((prev) => {
      const sinVacias = prev.filter((l) => l.origen || l.nombre || l.resultado || l.rake);
      const yaTraidas = new Set(sinVacias.filter((l) => l.origen).map((l) => `${l.origen!.agente}|${l.origen!.club}|${l.resultado}|${l.rake}`));
      const aAgregar = nuevas.filter((n) => !yaTraidas.has(`${n.origen!.agente}|${n.origen!.club}|${n.resultado}|${n.rake}`));
      return [...sinVacias, ...aAgregar].length > 0 ? [...sinVacias, ...aAgregar] : [lineaVacia(sistemaInicial)];
    });
    setTraerMsg(`Se trajo el cierre de ${elegidos.length === 1 ? elegidos[0].agent_name : `${elegidos.length} agentes`} (${nuevas.length} línea${nuevas.length === 1 ? "" : "s"}).`);
  }

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
      rodeo: rodeoPagado(l),
      ajuste: aNumero(l.ajuste),
    }));
    if (parseadas.some((p) => [p.resultado, p.rake, p.rakebackPct, p.rebatePct, p.rodeo, p.ajuste].some((v) => v === null)) || lineas.some((l) => l.pagaRodeo !== false && aNumero(l.rodeoPct ?? "100") === null)) {
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

  const cambiar = (id: string, campo: keyof Linea, valor: string | boolean) => setLineas((prev) => prev.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)));
  const quitar = (id: string) => setLineas((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : [lineaVacia(sistemaInicial)]));
  const duplicar = (id: string) =>
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      if (i < 0) return prev;
      const copia = { ...prev[i], id: nuevoId(), nombre: prev[i].nombre ? `${prev[i].nombre} (copia)` : "" };
      return [...prev.slice(0, i + 1), copia, ...prev.slice(i + 1)];
    });

  const campo = (l: Linea, k: keyof Linea, etiqueta: string, sufijo?: string, fijo = false) => {
    const mal = aNumero(String(l[k] ?? "")) === null;
    return (
      <div className="field" style={{ margin: 0 }}>
        <label style={{ fontSize: 11.5 }}>{etiqueta}{fijo ? " 🔒" : ""}</label>
        <input
          value={String(l[k] ?? "")}
          onChange={(e) => cambiar(l.id, k, e.target.value)}
          inputMode="decimal"
          placeholder={sufijo ?? "0"}
          readOnly={fijo}
          style={{ ...(mal ? { borderColor: "var(--red)" } : {}), ...(fijo ? { opacity: 0.7, cursor: "not-allowed" } : {}) }}
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
        <b>Es solo informativa:</b> no se guarda en el sistema, no cambia tu cuenta y no la ve nadie más. Podés cambiar los números cuantas veces quieras.
      </div>

      {permitirTraer && (
        <div className="panel" style={{ margin: "0 0 12px", padding: "12px 14px", background: "var(--panel-2)" }}>
          <div style={{ fontWeight: 650, marginBottom: 2 }}>Traer un agente de su cierre real</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Elegí la semana y el agente: se carga su cierre (resultado, rake, rodeo y rebate) y lo único que definís vos es el % de rakeback.
          </div>
          {!semanas ? (
            <div className="muted">Cargando semanas...</div>
          ) : semanas.length === 0 ? (
            <div className="muted">Todavía no hay cierres cargados para tus agentes.</div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={semana} onChange={(e) => setSemana(e.target.value)}>
                {semanas.map((s) => {
                  const ws = String(s.week_start).slice(0, 10);
                  return <option key={ws} value={ws}>{dateShort(s.week_start)} al {dateShort(s.week_end)}</option>;
                })}
              </select>
              <select value={agenteId} onChange={(e) => setAgenteId(e.target.value)} disabled={cargandoCierre || agentesConCierre.length === 0}>
                <option value="todos">Todos los agentes ({agentesConCierre.length})</option>
                {agentesConCierre.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.agent_name}</option>)}
              </select>
              <button type="button" className="btn" onClick={traer} disabled={cargandoCierre || agentesConCierre.length === 0}>
                {cargandoCierre ? "Cargando..." : "Traer"}
              </button>
              {!cargandoCierre && cierre && agentesConCierre.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Esa semana no tiene cierres de tus agentes.</span>}
            </div>
          )}
          {traerMsg && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{traerMsg}</div>}
        </div>
      )}

      {lineas.map((l, i) => {
        const c = calculo?.lineas[i];
        const fijo = !!l.origen && !l.editable;
        return (
          <div key={l.id} className="pt-card" style={{ marginBottom: 10 }}>
            <div className="b">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <input
                  value={l.nombre}
                  onChange={(e) => cambiar(l.id, "nombre", e.target.value)}
                  placeholder={perspectiva === "supervisor" ? `Agente o referencia (línea ${i + 1})` : `Club o referencia (línea ${i + 1})`}
                  readOnly={fijo}
                  style={{ flex: "1 1 160px", minWidth: 0, ...(fijo ? { fontWeight: 650 } : {}) }}
                />
                <select value={l.sistema} onChange={(e) => cambiar(l.id, "sistema", e.target.value)} disabled={fijo}>
                  <option value="PREPAGO">Prepago</option>
                  <option value="WIN_LOSE">Win/Lose</option>
                </select>
                {l.origen && (
                  <button type="button" className="btn secondary small" onClick={() => cambiar(l.id, "editable", !l.editable)} title="Destrabar los datos del cierre para cambiarlos a mano">
                    {l.editable ? "Trabar datos" : "Editar a mano"}
                  </button>
                )}
                <button type="button" className="btn secondary small" onClick={() => duplicar(l.id)} title="Duplicar esta línea">Duplicar</button>
                <button type="button" className="btn secondary small" onClick={() => quitar(l.id)} title="Quitar esta línea">Quitar</button>
              </div>
              {l.origen && (
                <div className="saldo-sub" style={{ margin: "0 0 8px" }}>
                  Del cierre real{l.origen.jugadores != null ? ` · ${l.origen.jugadores} jugador${l.origen.jugadores === 1 ? "" : "es"}` : ""} · rakeback real {l.origen.rakebackRealPct}% ({usdCents(l.origen.rakebackRealMonto)})
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                {campo(l, "resultado", "Resultado (US$)", "ganó + / perdió −", fijo)}
                {campo(l, "rake", "Rake total (US$)", undefined, fijo)}
                {campo(l, "rakebackPct", "% Rakeback", "ej. 70")}
                {campo(l, "rebatePct", "% Rebate", "ej. 0", fijo)}
                {campo(l, "rodeo", "Rodeo (US$)", undefined, fijo)}
                {campo(l, "ajuste", "Ajuste (US$)", "+ / −")}
              </div>
              {(aNumero(l.rodeo) ?? 0) !== 0 && (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10, padding: "8px 10px", background: "var(--panel-2)", borderRadius: 8 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ fontSize: 11.5 }}>¿Le pagás el rodeo a tu jugador?</label>
                    <select value={l.pagaRodeo === false ? "no" : "si"} onChange={(e) => cambiar(l.id, "pagaRodeo", e.target.value === "si")}>
                      <option value="si">Sí</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                  {l.pagaRodeo !== false && (
                    <div style={{ width: 130 }}>{campo(l, "rodeoPct", "% del rodeo", "100")}</div>
                  )}
                  <div className="saldo-sub" style={{ margin: 0, paddingBottom: 6 }}>
                    {l.pagaRodeo === false ? "El rodeo no se suma al cierre." : `Rodeo que se suma al cierre: ${usdCents(rodeoPagado(l) ?? 0)}`}
                  </div>
                </div>
              )}
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
        <div className="saldo-big" style={{ fontSize: 28, color: t ? colorSigno(t.cierreFinal) : "var(--text-dim)" }}><Cifra texto={t ? montoSigno(t.cierreFinal) : "—"} /></div>
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
