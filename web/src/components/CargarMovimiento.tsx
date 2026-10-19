import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usdCents, dateTime } from "../fmt";
import { useConfirmDialog } from "./ConfirmProvider";
import { TIPO_LABEL } from "./MovimientosHistorial";

// (19/10/2026, pedido de Leo: "programá todo lo de Cargar movimiento" -- mockups aprobados)
// Formulario de carga rediseñado. MISMA lógica de negocio que tenía Movimientos.tsx (mismos
// endpoints, mismas validaciones, mismos tipos, mismo flujo de adelantos y de fichas): lo que
// cambia es cómo se eligen los datos y lo que se ve antes de confirmar.

interface TipoDef {
  value: string;
  label: string;
  desc: string;
  glyph: string;
  cls: "g" | "r" | "a" | "gold" | "n";
}

// Orden "por defecto" (el de siempre); en pantalla se reordenan por uso real de los últimos 30 días.
const TIPOS: TipoDef[] = [
  { value: "CARGA", label: "Carga", desc: "Agente recibe fichas o crédito", glyph: "+", cls: "g" },
  { value: "DESCARGA", label: "Descarga", desc: "Agente entrega fichas o crédito", glyph: "−", cls: "r" },
  { value: "COBRO", label: "Cobro", desc: "Le cobramos al agente", glyph: "↙", cls: "g" },
  { value: "PAGO", label: "Pago", desc: "Le pagamos al agente", glyph: "↗", cls: "r" },
  { value: "TRANSFERENCIA_ENTRE_CLUBES", label: "Transferencia entre clubes", desc: "Mueve saldo de un club a otro", glyph: "⇄", cls: "n" },
  { value: "TICKET_PROMOCIONAL", label: "Ticket promocional", desc: "Ticket promocional cargado a mano", glyph: "★", cls: "gold" },
  { value: "AJUSTE", label: "Ajuste", desc: "Corrección contable. No mueve la Wallet", glyph: "±", cls: "gold" },
  // (29/09/2026, pedido de Leo) NO son movimientos de ledger como los de arriba: son su propio flujo
  // (rakeback_advances, mismo "Nuevo adelanto" de Adelantos.tsx). Ver onSubmit.
  { value: "ADELANTO_RAKEBACK", label: "Adelanto de rakeback", desc: "A cuenta, se descuenta después en la liquidación", glyph: "◷", cls: "a" },
  { value: "ADELANTO_FICHAS", label: "Adelanto de fichas", desc: "Le cargamos fichas, todavía no las pagó", glyph: "◔", cls: "a" },
];

const MEDIOS = [
  { value: "SIN_TESORERIA", label: "Sin tesorería" },
  { value: "USDT", label: "USDT" },
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "ZELLE", label: "Zelle" },
  { value: "OTRO", label: "Otro" },
];

// Tipos que cuentan para armar los "Frecuentes" (los ajustes salen en su mayoría de la edición
// manual de Resumen, no de alguien cargando a un agente).
const TIPOS_PARA_FRECUENTES = ["CARGA", "DESCARGA", "COBRO", "PAGO", "ADELANTO_FICHAS", "ADELANTO_RAKEBACK"];
const UMBRAL_IMPORTE_GRANDE = 1000; // USD -- mismo umbral que ya usa la campana de alertas (repo/alertas.ts)

function todayLocal() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

function haceDias(n: number) {
  const d = new Date(Date.now() - n * 86400000);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export default function CargarMovimiento({
  agentes,
  clubes,
  onRegistrado,
}: {
  agentes: any[];
  clubes: any[];
  onRegistrado: () => void;
}) {
  const { confirmDialog } = useConfirmDialog();

  // Se arranca vacío a propósito (29/09/2026, pedido de Leo: "ir eligiendo paso a paso"): el resto de
  // los campos se va revelando uno a uno a medida que se completa el anterior.
  const [type, setType] = useState("");
  const [agentId, setAgentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [clubDestinoId, setClubDestinoId] = useState("");
  const [amount, setAmount] = useState("");
  // (25/09/2026, pedido de Leo) el importe que mueve el saldo es SIEMPRE USD, en cargas y en
  // descargas; las fichas equivalentes son solo informativas -- nunca tocan el monto real.
  const [valorFicha, setValorFicha] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState("SIN_TESORERIA");
  const [custodian, setCustodian] = useState("");
  const [fechaModo, setFechaModo] = useState<"ahora" | "ayer" | "elegir">("ahora");
  const [occurredAt, setOccurredAt] = useState(todayLocal());
  const [observation, setObservation] = useState("");
  const [medioAdelanto, setMedioAdelanto] = useState<"" | "FICHAS" | "USDT">("");
  const [verMas, setVerMas] = useState(false);

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ultimoId, setUltimoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [cotizando, setCotizando] = useState(false);
  const [cotizacionMsg, setCotizacionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Buscador de agente
  const [busqueda, setBusqueda] = useState("");
  const [listaAbierta, setListaAbierta] = useState(false);

  // Movimientos de los últimos 30 días: de acá salen el orden de los tipos por uso, los agentes
  // "Frecuentes" y el aviso de posible duplicado -- una sola consulta, sin endpoints nuevos.
  const [recientes, setRecientes] = useState<any[]>([]);
  // Saldo del agente elegido en cada club (para los botones de club y el "antes -> después").
  const [cuenta, setCuenta] = useState<Record<string, { fichas: number; system: string }> | null>(null);
  const msgRef = useRef<HTMLDivElement>(null);

  function cargarRecientes() {
    api.movimientos({ desde: haceDias(30), limit: 1000 }).then(setRecientes).catch(() => setRecientes([]));
  }
  useEffect(() => {
    cargarRecientes();
  }, []);

  useEffect(() => {
    setCuenta(null);
    if (!agentId) return;
    let vivo = true;
    api
      .cuentaDeAgente(agentId)
      .then((r: any) => {
        if (!vivo) return;
        const m: Record<string, { fichas: number; system: string }> = {};
        for (const b of r.saldos ?? []) {
          // Mismo criterio que fichasTotal() en Resumen.tsx: PREPAGO suma las fichas ganadas en mesas.
          const fichas = b.system === "PREPAGO" ? Number(b.amount) + Number(b.total_fichas_ganadas_mesas || 0) : Number(b.amount);
          m[b.club_id] = { fichas, system: b.system };
        }
        setCuenta(m);
      })
      .catch(() => vivo && setCuenta({}));
    return () => {
      vivo = false;
    };
  }, [agentId]);

  const esAdelanto = type === "ADELANTO_RAKEBACK" || type === "ADELANTO_FICHAS";
  const esAdelantoFichas = type === "ADELANTO_FICHAS";
  const clubSeleccionado = clubes.find((c) => c.id === clubId);
  const esFichas = clubSeleccionado?.unit === "FICHAS";
  const esTiny = /tiny/i.test(clubSeleccionado?.name ?? "");
  const agenteSel = agentes.find((a) => a.id === agentId);
  const clubDestinoSel = clubes.find((c) => c.id === clubDestinoId);
  const tipoDef = TIPOS.find((t) => t.value === type);

  const usoPorTipo = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recientes) if (r.status !== "REVERTIDO") m[r.type] = (m[r.type] ?? 0) + 1;
    return m;
  }, [recientes]);

  const tiposOrdenados = useMemo(
    () => [...TIPOS].sort((a, b) => (usoPorTipo[b.value] ?? 0) - (usoPorTipo[a.value] ?? 0) || TIPOS.indexOf(a) - TIPOS.indexOf(b)),
    [usoPorTipo]
  );
  const tiposVisibles = tiposOrdenados.slice(0, 7);
  const tiposMas = tiposOrdenados.slice(7);
  const tipoEnMas = tiposMas.some((t) => t.value === type);

  const frecuentes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of recientes) {
      if (r.status === "REVERTIDO" || !TIPOS_PARA_FRECUENTES.includes(r.type)) continue;
      m[r.agent_id] = (m[r.agent_id] ?? 0) + 1;
    }
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id]) => agentes.find((a) => a.id === id))
      .filter(Boolean);
  }, [recientes, agentes]);

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return agentes.filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 60);
  }, [agentes, busqueda]);

  function elegirClub(id: string) {
    setClubId(id);
    setCotizacionMsg(null);
    const club = clubes.find((c) => c.id === id);
    // Precarga la tasa del club (ej. 1,20 para X-Poker) pero queda editable.
    if (club?.unit === "FICHAS") setValorFicha(String(club.current_rate ?? 1));
  }

  function elegirTipo(v: string) {
    // Cambiar el tipo reinicia los pasos siguientes -- no queda un formulario a medio llenar con
    // combinaciones que no tienen sentido para el tipo nuevo.
    setType(v);
    setAgentId("");
    setClubId("");
    setClubDestinoId("");
    setAmount("");
    setMedioAdelanto("");
    setPaymentMethod("SIN_TESORERIA");
    setBusqueda("");
    setMsg(null);
    setUltimoId(null);
  }

  function elegirAgente(id: string) {
    setAgentId(id);
    setClubId("");
    setClubDestinoId("");
    setBusqueda("");
    setListaAbierta(false);
  }

  function nuevaCarga() {
    elegirTipo("");
    setObservation("");
    setCustodian("");
    setFechaModo("ahora");
    setOccurredAt(todayLocal());
  }

  async function traerCotizacionEnVivo() {
    setCotizando(true);
    setCotizacionMsg(null);
    try {
      const r = await api.cotizacionUsdtTwd();
      setValorFicha(String(r.rate));
      setCotizacionMsg({ ok: true, text: `USDT/TWD ${r.rate} (MAX, recién actualizado) -- lo podés pisar si hace falta.` });
    } catch (err: any) {
      setCotizacionMsg({ ok: false, text: err.message || "No se pudo traer la cotización en vivo." });
    } finally {
      setCotizando(false);
    }
  }

  function fechaDelMovimiento(): string {
    if (fechaModo === "ahora") return new Date().toISOString();
    if (fechaModo === "ayer") return new Date(Date.now() - 86400000).toISOString();
    return new Date(occurredAt).toISOString();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setUltimoId(null);

    const montoNumero = Number(amount) || 0;
    const agenteNombre = agenteSel?.name ?? "";

    // Adelanto de rakeback / Adelanto de fichas: no son un movimiento de ledger, son su propio
    // flujo (mismo que "Nuevo adelanto" en Adelantos.tsx). El de fichas siempre manda
    // medio="FICHAS" y kind="FICHAS_PENDIENTE".
    if (esAdelanto) {
      if (!agentId) return setMsg({ ok: false, text: "Elegí un agente." });
      if (!(montoNumero > 0)) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
      const medio = esAdelantoFichas ? "FICHAS" : medioAdelanto;
      if (medio && !clubId) return setMsg({ ok: false, text: "Un adelanto en fichas o USDT necesita club de origen." });
      if (Math.abs(montoNumero) > UMBRAL_IMPORTE_GRANDE && !(await confirmDialog(`¿Confirmás el ${tipoDef?.label.toLowerCase()} de ${usdCents(montoNumero)} a ${agenteNombre}?`, { title: "Importe grande" }))) return;
      setLoading(true);
      try {
        await api.altaAdelanto({
          agentId,
          amount: montoNumero,
          medio: medio || null,
          clubOrigenId: clubId || null,
          kind: esAdelantoFichas ? "FICHAS_PENDIENTE" : "RAKEBACK",
          notes: observation.trim() || undefined,
        });
        setMsg({ ok: true, text: esAdelantoFichas ? "Adelanto de fichas cargado." : "Adelanto de rakeback cargado." });
        setAmount("");
        setObservation("");
        setMedioAdelanto("");
        onRegistrado();
        cargarRecientes();
      } catch (err: any) {
        setMsg({ ok: false, text: err.message || "No se pudo cargar el adelanto." });
      } finally {
        setLoading(false);
        msgRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      return;
    }

    if (!agentId || !clubId || !amount) return setMsg({ ok: false, text: "Agente, club e importe son obligatorios." });
    if (type === "TRANSFERENCIA_ENTRE_CLUBES" && !clubDestinoId) return setMsg({ ok: false, text: "La transferencia necesita club de destino." });
    if (paymentMethod === "EFECTIVO" && type !== "AJUSTE" && !custodian.trim()) return setMsg({ ok: false, text: "Un movimiento en efectivo requiere custodio (BIT-051/052)." });

    // Importes grandes: una confirmación extra (mismo umbral que la campana de alertas).
    if (Math.abs(montoNumero) > UMBRAL_IMPORTE_GRANDE) {
      const ok = await confirmDialog(`¿Confirmás ${tipoDef?.label.toLowerCase()} de ${usdCents(montoNumero)} a ${agenteNombre} (${clubSeleccionado?.name ?? ""})?`, { title: "Importe grande" });
      if (!ok) return;
    }

    setLoading(true);
    try {
      // El importe SIEMPRE es USD y se manda tal cual -- es lo único que mueve el saldo. Para clubes
      // en fichas, las fichas equivalentes (importe × tasa) quedan guardadas solo como referencia
      // (originalAmount/originalUnit), nunca se usan para el monto real del movimiento.
      const fichasEquivalentes = esFichas ? montoNumero * (Number(valorFicha) || 0) : 0;
      const r = await api.crearMovimiento({
        type,
        agentId,
        clubId,
        clubDestinoId: type === "TRANSFERENCIA_ENTRE_CLUBES" ? clubDestinoId : undefined,
        amount: montoNumero,
        originalAmount: esFichas ? fichasEquivalentes : undefined,
        originalUnit: esFichas ? "FICHAS" : undefined,
        paymentMethod,
        custodian: paymentMethod === "EFECTIVO" && type !== "AJUSTE" ? custodian.trim() : undefined,
        occurredAt: fechaDelMovimiento(),
        observation: observation.trim() || undefined,
      });
      setMsg({ ok: true, text: `Registrado: ${tipoDef?.label} de ${usdCents(montoNumero)} — ${agenteNombre} · ${clubSeleccionado?.name ?? ""}.` });
      setUltimoId(r?.id && !r?.alreadyApplied ? r.id : null);
      setAmount("");
      setObservation("");
      onRegistrado();
      cargarRecientes();
      // La cuenta del agente cambió: se vuelve a pedir para que el "antes" ya sea el saldo nuevo.
      api
        .cuentaDeAgente(agentId)
        .then((res: any) => {
          const m: Record<string, { fichas: number; system: string }> = {};
          for (const b of res.saldos ?? []) {
            m[b.club_id] = { fichas: b.system === "PREPAGO" ? Number(b.amount) + Number(b.total_fichas_ganadas_mesas || 0) : Number(b.amount), system: b.system };
          }
          setCuenta(m);
        })
        .catch(() => {});
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setLoading(false);
      msgRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // "Deshacer" = el mismo "Revertir" del historial (genera el movimiento opuesto, no borra nada).
  async function deshacer() {
    if (!ultimoId) return;
    setDeshaciendo(true);
    try {
      await api.revertirMovimiento(ultimoId, "Deshecho al instante desde Cargar movimiento");
      setMsg({ ok: true, text: "Listo: el movimiento se revirtió (queda en el historial como revertido)." });
      setUltimoId(null);
      onRegistrado();
      cargarRecientes();
      if (agentId) {
        api
          .cuentaDeAgente(agentId)
          .then((res: any) => {
            const m: Record<string, { fichas: number; system: string }> = {};
            for (const b of res.saldos ?? []) {
              m[b.club_id] = { fichas: b.system === "PREPAGO" ? Number(b.amount) + Number(b.total_fichas_ganadas_mesas || 0) : Number(b.amount), system: b.system };
            }
            setCuenta(m);
          })
          .catch(() => {});
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo deshacer." });
    } finally {
      setDeshaciendo(false);
    }
  }

  // Pasos revelados uno a uno (29/09/2026). El club es opcional para un adelanto "sin especificar"
  // (medioAdelanto === "" en ADELANTO_RAKEBACK) -- ese caso se considera "resuelto" con solo llegar
  // al paso.
  const pasoAgente = type !== "";
  const pasoClub = pasoAgente && agentId !== "";
  const clubResuelto = clubId !== "" || (type === "ADELANTO_RAKEBACK" && !medioAdelanto);
  const pasoClubDestino = pasoClub && clubResuelto && type === "TRANSFERENCIA_ENTRE_CLUBES";
  const clubDestinoResuelto = type !== "TRANSFERENCIA_ENTRE_CLUBES" || clubDestinoId !== "";
  const pasoImporte = pasoClub && clubResuelto && clubDestinoResuelto;
  // Un AJUSTE puede ser negativo; el resto de los tipos siempre esperan un monto positivo -- el signo
  // ya lo resuelve el backend según el tipo (ver deltaParaBalance en repo/ledger.ts).
  const importeResuelto = type === "AJUSTE" ? amount !== "" && Number(amount) !== 0 : Number(amount) > 0;
  const pasoSiguienteAImporte = pasoImporte && importeResuelto;

  // ---- Vista previa del efecto sobre el saldo (mismo signo que deltaParaBalance en el backend) ----
  const montoNum = Number(amount) || 0;
  const delta: number | null = !importeResuelto
    ? null
    : type === "CARGA"
      ? Math.abs(montoNum)
      : type === "DESCARGA" || type === "COBRO" || type === "PAGO" || type === "ADELANTO_FICHAS"
        ? -Math.abs(montoNum)
        : type === "AJUSTE" || type === "TICKET_PROMOCIONAL"
          ? montoNum
          : null; // transferencia / adelanto de rakeback: no se previsualiza
  const fichasAntes = clubId && cuenta ? (cuenta[clubId]?.fichas ?? 0) : null;
  const fichasDespues = delta !== null && fichasAntes !== null ? fichasAntes + delta : null;

  const textoWallet = esAdelanto
    ? type === "ADELANTO_RAKEBACK" && medioAdelanto === "USDT"
      ? "Sale de la Wallet (USDT)"
      : type === "ADELANTO_RAKEBACK" && medioAdelanto === ""
        ? "No mueve nada todavía"
        : "No toca la Wallet (mueve el stock de fichas)"
    : type === "AJUSTE"
      ? "No se mueve (ajuste contable)"
      : paymentMethod === "USDT" || paymentMethod === "ZELLE"
        ? "Mueve la Wallet"
        : paymentMethod === "EFECTIVO"
          ? "Mueve la Caja de efectivo"
          : "No se mueve";

  // ---- Aviso de posible duplicado: último movimiento igual (tipo+agente+club) de los últimos 7 días ----
  const parecido = useMemo(() => {
    if (!type || !agentId || !clubId) return null;
    const limite = Date.now() - 7 * 86400000;
    return recientes.find((r) => r.status !== "REVERTIDO" && r.type === type && r.agent_id === agentId && r.club_id === clubId && new Date(r.occurred_at).getTime() >= limite) ?? null;
  }, [recientes, type, agentId, clubId]);
  const mismoImporte = parecido && importeResuelto && Math.abs(Number(parecido.amount)) === Math.abs(montoNum);

  const signoTitular = delta === null ? "" : delta >= 0 ? "+" : "−";
  const colorTitular = delta === null ? "var(--text)" : delta >= 0 ? "var(--green)" : "var(--red)";
  const sistemaAgente = cuenta ? Object.values(cuenta)[0]?.system : undefined;

  const resumen = (
    <>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>Vas a registrar</div>
      {!type ? (
        <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Elegí qué vas a cargar y se va armando el resumen acá.</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, margin: "6px 0 10px" }}>
            <span className={`pill ${tipoDef?.cls === "r" ? "a" : tipoDef?.cls === "g" ? "g" : "gold"}`}>{tipoDef?.label}</span>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: colorTitular, fontVariantNumeric: "tabular-nums" }}>
              {importeResuelto ? `${signoTitular}${usdCents(Math.abs(montoNum))}` : "—"}
            </span>
          </div>
          <div className="sumrow"><span>Agente</span><b>{agenteSel?.name ?? "—"}</b></div>
          <div className="sumrow">
            <span>Club</span>
            <b>{clubSeleccionado?.name ?? (esAdelanto ? "Sin especificar" : "—")}{clubDestinoSel ? ` → ${clubDestinoSel.name}` : ""}</b>
          </div>
          {pasoImporte && <div className="sumrow"><span>Wallet</span><b>{textoWallet}</b></div>}
          {fichasAntes !== null && delta !== null && fichasDespues !== null && (
            <div className="sumrow" style={{ borderBottom: "none" }}>
              <span>Saldo del agente</span>
              <b>
                {usdCents(fichasAntes)} <span style={{ color: "var(--text-faint)" }}>→</span>{" "}
                <span style={{ color: fichasDespues >= 0 ? "var(--green)" : "var(--red)" }}>{usdCents(fichasDespues)}</span>
              </b>
            </div>
          )}
          {parecido && (
            <div className="warnbox">
              <b>{mismoImporte ? "Mismo importe: ¿es la misma carga?" : "¿Es otra carga?"}</b> El {dateTime(parecido.occurred_at)} ya se cargó {TIPO_LABEL[parecido.type]?.toLowerCase() ?? parecido.type} de{" "}
              <b>{usdCents(Math.abs(Number(parecido.amount)))}</b> a {parecido.agent_name} en {parecido.club_name}.
            </div>
          )}
        </>
      )}
      <button type="submit" form="cargar-form" className="btn" style={{ width: "100%", marginTop: 12 }} disabled={loading || !pasoSiguienteAImporte}>
        {loading ? "Registrando..." : esAdelanto ? "Dar de alta el adelanto" : "Registrar movimiento"}
      </button>
      {type && (
        <button type="button" className="btn secondary" style={{ width: "100%", marginTop: 8 }} onClick={nuevaCarga}>
          Limpiar
        </button>
      )}
    </>
  );

  return (
    <div className="cargar-grid">
      <div className="panel">
        <form id="cargar-form" onSubmit={onSubmit}>
          {msg && (
            <div ref={msgRef} className={msg.ok ? "success" : "error"} style={{ marginBottom: 16 }}>
              <div className="cargar-ok">
                <span style={{ flex: 1 }}>{msg.text}</span>
                {msg.ok && ultimoId && (
                  <button type="button" className="btn secondary small" disabled={deshaciendo} onClick={deshacer}>
                    {deshaciendo ? "..." : "Deshacer"}
                  </button>
                )}
                {msg.ok && (
                  <button type="button" className="btn secondary small" onClick={nuevaCarga}>
                    Nueva carga
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="cstep">
            <h4>
              <b className={type ? "done" : ""}>{type ? "✓" : "1"}</b>Qué vas a cargar
              <span className="hint">· ordenado por uso (últimos 30 días)</span>
            </h4>
            <div className="tile-grid">
              {[...tiposVisibles, ...(verMas || tipoEnMas ? tiposMas : [])].map((t) => (
                <button type="button" key={t.value} className={`tile${type === t.value ? " on" : ""}`} onClick={() => elegirTipo(t.value)}>
                  <div className={`ic ${t.cls}`}>{t.glyph}</div>
                  <div className="t">{t.label}</div>
                  <div className="d">{t.desc}</div>
                  <div className="n">{usoPorTipo[t.value] ?? 0}</div>
                </button>
              ))}
              {tiposMas.length > 0 && !(verMas || tipoEnMas) && (
                <button type="button" className="tile" onClick={() => setVerMas(true)}>
                  <div className="ic n">⋯</div>
                  <div className="t">Más…</div>
                  <div className="d">{tiposMas.map((t) => t.label).join(" · ")}</div>
                </button>
              )}
            </div>
          </div>

          {pasoAgente && (
            <div className="cstep">
              <h4><b className={agentId ? "done" : ""}>{agentId ? "✓" : "2"}</b>Agente</h4>
              {agentId ? (
                <div className="agente-sel">
                  <b>{agenteSel?.name}</b>
                  {sistemaAgente && <span className="pill">{sistemaAgente === "PREPAGO" ? "Prepago" : "Win/Lose"}</span>}
                  <button type="button" className="quitar" onClick={() => elegirAgente("")}>✕ cambiar</button>
                </div>
              ) : (
                <div className="agente-buscar">
                  <input
                    className="search-input"
                    placeholder={`Buscar entre ${agentes.length} agentes...`}
                    value={busqueda}
                    onChange={(e) => {
                      setBusqueda(e.target.value);
                      setListaAbierta(true);
                    }}
                    onFocus={() => setListaAbierta(true)}
                    onBlur={() => setTimeout(() => setListaAbierta(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (coincidencias[0]) elegirAgente(coincidencias[0].id);
                      }
                    }}
                    autoFocus
                  />
                  {listaAbierta && coincidencias.length > 0 && (
                    <div className="agente-lista">
                      {coincidencias.map((a, i) => (
                        <button type="button" key={a.id} className={i === 0 && busqueda ? "activo" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => elegirAgente(a.id)}>
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!agentId && frecuentes.length > 0 && (
                <div className="chips-row">
                  <span className="muted" style={{ fontSize: 11.5 }}>Frecuentes:</span>
                  {frecuentes.map((a: any) => (
                    <button type="button" key={a.id} className="chipx" onClick={() => elegirAgente(a.id)}>{a.name}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {pasoClub && (
            <div className="cstep">
              <h4>
                <b className={clubResuelto ? "done" : ""}>{clubResuelto ? "✓" : "3"}</b>
                Club {type === "TRANSFERENCIA_ENTRE_CLUBES" ? "(origen)" : esAdelanto ? "de origen (opcional)" : ""}
              </h4>
              <div className="chips-row">
                {esAdelanto && !esAdelantoFichas && (
                  <button type="button" className={`club-chip${clubId === "" ? " on" : ""}`} onClick={() => elegirClub("")}>
                    <div className="c">Sin especificar</div>
                    <div className="s">no mueve nada todavía</div>
                  </button>
                )}
                {[...clubes]
                  .sort((a, b) => Number(!!cuenta?.[b.id]) - Number(!!cuenta?.[a.id]))
                  .map((c) => {
                    const sal = cuenta?.[c.id];
                    return (
                      <button type="button" key={c.id} className={`club-chip${clubId === c.id ? " on" : sal || !cuenta ? "" : " dim"}`} onClick={() => elegirClub(c.id)}>
                        <div className="c">{c.name}</div>
                        <div className="s">{!cuenta ? "..." : sal ? `Saldo hoy ${usdCents(sal.fichas)}` : "sin cuenta todavía"}</div>
                      </button>
                    );
                  })}
              </div>
              {esAdelantoFichas && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>El adelanto de fichas siempre necesita club de origen (de dónde salen).</div>}
            </div>
          )}

          {pasoClubDestino && (
            <div className="cstep">
              <h4><b className={clubDestinoId ? "done" : ""}>{clubDestinoId ? "✓" : "4"}</b>Club destino</h4>
              <div className="chips-row">
                {clubes.filter((c) => c.id !== clubId).map((c) => (
                  <button type="button" key={c.id} className={`club-chip${clubDestinoId === c.id ? " on" : ""}`} onClick={() => setClubDestinoId(c.id)}>
                    <div className="c">{c.name}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {pasoImporte && (
            <div className="cstep">
              <h4><b>{type === "TRANSFERENCIA_ENTRE_CLUBES" ? "5" : "4"}</b>{esAdelanto ? "Monto adelantado" : "Importe"}</h4>
              <div className="bigamt">
                <span>US$</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" inputMode="decimal" placeholder="0,00" autoFocus />
              </div>
              {type === "AJUSTE" && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Un ajuste puede ser negativo (ej. corregir un exceso cargado de más).</div>}
            </div>
          )}

          {pasoSiguienteAImporte && type === "ADELANTO_RAKEBACK" && (
            <div className="cstep">
              <h4><b>5</b>Medio</h4>
              <div className="seg">
                <button type="button" className={medioAdelanto === "" ? "on" : ""} onClick={() => setMedioAdelanto("")}>Sin especificar</button>
                <button type="button" className={medioAdelanto === "FICHAS" ? "on" : ""} onClick={() => setMedioAdelanto("FICHAS")}>Fichas</button>
                <button type="button" className={medioAdelanto === "USDT" ? "on" : ""} onClick={() => setMedioAdelanto("USDT")}>USDT</button>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {medioAdelanto === "" ? "No mueve nada todavía." : medioAdelanto === "FICHAS" ? "Mueve el stock ya mismo." : "Sale de la wallet ya mismo."}
              </div>
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && esFichas && (
            <div className="cstep">
              <h4><b>5</b>Valor de la ficha (USD)</h4>
              <div style={{ display: "flex", gap: 6, maxWidth: 360 }}>
                <input value={valorFicha} onChange={(e) => setValorFicha(e.target.value)} type="number" step="0.01" style={{ flex: 1 }} />
                {esTiny && (
                  <button type="button" className="btn secondary small" disabled={cotizando} onClick={traerCotizacionEnVivo} title="Traer la cotización USDT/TWD en vivo de MAX (max.maicoin.com)">
                    {cotizando ? "..." : "🔄 En vivo"}
                  </button>
                )}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                = {(montoNum * (Number(valorFicha) || 0)).toLocaleString("es-AR", { maximumFractionDigits: 2 })} fichas
              </span>
              {cotizacionMsg && (
                <div className={cotizacionMsg.ok ? "success" : "error"} style={{ marginTop: 6, fontSize: 12, padding: "6px 9px" }}>
                  {cotizacionMsg.text}
                </div>
              )}
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && type !== "AJUSTE" && (
            <div className="cstep">
              <h4><b>6</b>Medio de pago</h4>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div className="seg" style={{ maxWidth: "100%", overflowX: "auto" }}>
                  {MEDIOS.map((m) => (
                    <button type="button" key={m.value} className={paymentMethod === m.value ? "on" : ""} onClick={() => setPaymentMethod(m.value)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{textoWallet}</span>
              </div>
            </div>
          )}
          {pasoSiguienteAImporte && type === "AJUSTE" && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
              Un ajuste es puramente contable -- nunca mueve la wallet, sin importar el motivo.
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && type !== "AJUSTE" && paymentMethod === "EFECTIVO" && (
            <div className="cstep">
              <h4><b>6</b>Custodio del efectivo</h4>
              <input className="search-input" style={{ width: "100%" }} value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="Quién tiene la plata físicamente" />
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && (
            <div className="cstep">
              <h4><b>7</b>Cuándo</h4>
              <div className="chips-row">
                <button type="button" className={`chipx${fechaModo === "ahora" ? " on" : ""}`} onClick={() => setFechaModo("ahora")}>Ahora</button>
                <button type="button" className={`chipx${fechaModo === "ayer" ? " on" : ""}`} onClick={() => setFechaModo("ayer")}>Ayer</button>
                <button type="button" className={`chipx${fechaModo === "elegir" ? " on" : ""}`} onClick={() => setFechaModo("elegir")}>Elegir fecha y hora…</button>
                {fechaModo === "elegir" && <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />}
              </div>
            </div>
          )}

          {pasoSiguienteAImporte && (
            <div className="cstep">
              <h4><b>8</b>{esAdelanto ? "Notas (opcional)" : "Observación (opcional)"}</h4>
              <input className="search-input" style={{ width: "100%" }} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder={esAdelanto ? "Motivo, referencia..." : "Motivo, referencia..."} />
            </div>
          )}

          {pasoSiguienteAImporte && type === "ADELANTO_RAKEBACK" && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Esto da de alta un adelanto de rakeback nuevo e independiente (por agente, no por club) — se descuenta después en la liquidación real. Para ajustar, corregir o eliminar uno que ya existe, o ver el historial completo, andá a la pestaña "Adelantos".
            </div>
          )}
          {pasoSiguienteAImporte && esAdelantoFichas && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Esto carga fichas de adelanto: suman al stock del agente ya mismo, pero NO a su saldo a favor — nos las debe. Va a aparecer como "Fichas pendientes" en la pestaña "Adelantos" y en el resumen del agente hasta que se cobre (cruzándolo en Liquidaciones, o desde "Ajustar → Consumo" ahí).
            </div>
          )}
        </form>
      </div>

      <div className="panel cargar-summary">{resumen}</div>

      {/* Celular: barra fija con el resumen y el botón (arriba de la barra de accesos de abajo). */}
      {type && (
        <div className="cargar-bar">
          <div className="txt">
            <div>{tipoDef?.label}{agenteSel ? ` · ${agenteSel.name}` : ""}{clubSeleccionado ? ` · ${clubSeleccionado.name}` : ""}</div>
            {fichasAntes !== null && fichasDespues !== null && delta !== null && (
              <div>Saldo {usdCents(fichasAntes)} → <b>{usdCents(fichasDespues)}</b></div>
            )}
          </div>
          <button type="submit" form="cargar-form" className="btn" style={{ padding: "11px 16px" }} disabled={loading || !pasoSiguienteAImporte}>
            {loading ? "..." : importeResuelto ? `Registrar ${signoTitular}US$ ${Math.abs(montoNum).toLocaleString("es-AR")}` : "Registrar"}
          </button>
        </div>
      )}
    </div>
  );
}
