import { useEffect, useState } from "react";
import { api } from "../api";
import MovimientosHistorial from "../components/MovimientosHistorial";
import SaldoHistorico from "../components/SaldoHistorico";
import { AdelantosPanel } from "./Adelantos";

const TIPOS = [
  { value: "CARGA", label: "Carga (agente recibe fichas/crédito)" },
  { value: "DESCARGA", label: "Descarga (agente entrega fichas/crédito)" },
  { value: "COBRO", label: "Cobro (le cobramos al agente)" },
  { value: "PAGO", label: "Pago (le pagamos al agente)" },
  { value: "TRANSFERENCIA_ENTRE_CLUBES", label: "Transferencia entre clubes" },
  { value: "TICKET_PROMOCIONAL", label: "Ticket promocional" },
  { value: "AJUSTE", label: "Ajuste manual" },
  // (29/09/2026, pedido de Leo: "unifiquemos... los adelantos de rakeback, necesito que los
  // movamos a carga de movimientos y que funcionen como está funcionando ahora") -- NO es un
  // movimiento de ledger como los de arriba (no pasa por crearMovimiento): es un adelanto de
  // rakeback nuevo (rakeback_advances), exactamente el mismo "Nuevo adelanto" que ya existía en
  // Adelantos.tsx, ahora accesible también desde acá. Gestionar los que ya existen (ajustar,
  // corregir, eliminar, ver historial) sigue estando en la pantalla de Adelantos, tal cual.
  { value: "ADELANTO_RAKEBACK", label: "Adelanto de rakeback (a cuenta — se descuenta después en la liquidación)" },
  // ADELANTO_FICHAS (29/09/2026, pedido de Leo: "necesito un adelanto de fichas -- nosotros le
  // cargamos las fichas pero todavía no las pago") -- tampoco pasa por crearMovimiento, mismo
  // mecanismo de altaAdelanto que "Adelanto de rakeback" (rakeback_advances), pero con
  // kind="FICHAS_PENDIENTE" fijo: genera un movimiento ADELANTO_FICHAS (no CARGA) que suma al
  // stock físico pero resta del saldo -- el agente nos debe esas fichas. Se cruza después en
  // Liquidaciones, junto con adelantos y cargas, y ese cruce SÍ genera un cobro real (a
  // diferencia del consumo de un adelanto de rakeback, que es puramente contable).
  { value: "ADELANTO_FICHAS", label: "Adelanto de fichas (le cargamos fichas, todavía no las pagó)" },
];

// Filtros del historial de abajo (29/09/2026, pedido de Leo: "faltarian filtros para poder
// rastrear un movimiento") -- mismos tipos que puede tener un ledger_movement real (no los dos
// de arriba que no pasan por ahí -- ADELANTO_RAKEBACK/ADELANTO_FICHAS si SE PUEDEN filtrar,
// porque el Alta de esos sí genera su propio movimiento de ledger).
const TIPOS_FILTRO = [
  { value: "CARGA", label: "Carga" },
  { value: "DESCARGA", label: "Descarga" },
  { value: "COBRO", label: "Cobro" },
  { value: "PAGO", label: "Pago" },
  { value: "TRANSFERENCIA_ENTRE_CLUBES", label: "Transferencia" },
  { value: "TICKET_PROMOCIONAL", label: "Ticket promocional" },
  { value: "AJUSTE", label: "Ajuste" },
  { value: "ADELANTO_RAKEBACK", label: "Adelanto de rakeback (USDT)" },
  { value: "ADELANTO_FICHAS", label: "Adelanto de fichas" },
];

function todayLocal() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export default function Movimientos() {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);

  // (29/09/2026, pedido de Leo: "cambiemos lo visual, como hicimos en los otros lugares... ir
  // eligiendo paso a paso") -- arranca vacío a propósito (a diferencia de antes, que ya venía
  // con "CARGA" precargado) para forzar una elección activa: el resto de los campos se van
  // revelando uno a uno a medida que se completa el anterior, en vez de mostrar el formulario
  // entero de una.
  const [type, setType] = useState("");
  const [agentId, setAgentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [clubDestinoId, setClubDestinoId] = useState("");
  const [amount, setAmount] = useState("");
  // (25/09/2026, pedido de Leo: "el importe que mueve el saldo tiene que ser SIEMPRE USD, en
  // cargas y en descargas -- abajo que muestre las fichas equivalentes, informativo nada mas")
  // -- a diferencia de Cierres.tsx (que convierte fichas -> USD), acá es al revés: el operador
  // ya sabe cuántos USD está cargando/descargando, y lo que quiere ver es a cuántas fichas
  // equivale eso al valor de hoy. El campo de tasa sigue precargado con clubes.current_rate
  // (editable) para calcular esa equivalencia, pero nunca toca el importe que se manda al ledger.
  const [valorFicha, setValorFicha] = useState("1");
  const [paymentMethod, setPaymentMethod] = useState("SIN_TESORERIA");
  const [custodian, setCustodian] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayLocal());
  const [observation, setObservation] = useState("");
  // Solo para "Adelanto de rakeback"/"Adelanto de fichas" -- mismo campo "medio" que ya tenía el
  // Alta en Adelantos.tsx: "" = sin especificar (no mueve nada todavía, solo para rakeback),
  // FICHAS/USDT = mueve stock/wallet ya mismo (se descuenta después en la liquidación real). El
  // Adelanto de fichas siempre es en fichas -- no hay nada que elegir ahí.
  const [medioAdelanto, setMedioAdelanto] = useState<"" | "FICHAS" | "USDT">("");

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // (25/09/2026, pedido de Leo: "conectar el valor de donde tomamos la conversion y que se
  // actualice en tiempo real") -- PRUEBA, solo para Tiny: en vez de cargar el valor de la ficha
  // a mano, lo trae en vivo de MAX (USDT/TWD, ver routes/marketRates.ts) con un boton. Sigue
  // siendo editable despues -- esto solo prellena.
  const [cotizando, setCotizando] = useState(false);
  const [cotizacionMsg, setCotizacionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Filtros del historial (29/09/2026, ver nota en TIPOS_FILTRO).
  const [filtroAgentId, setFiltroAgentId] = useState("");
  const [filtroClubId, setFiltroClubId] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }, []);

  const esAdelanto = type === "ADELANTO_RAKEBACK" || type === "ADELANTO_FICHAS";
  const esAdelantoFichas = type === "ADELANTO_FICHAS";

  const clubSeleccionado = clubes.find((c) => c.id === clubId);
  const esFichas = clubSeleccionado?.unit === "FICHAS";

  function elegirClub(id: string) {
    setClubId(id);
    setCotizacionMsg(null);
    const club = clubes.find((c) => c.id === id);
    // Precarga la tasa del club (ej. 1,20 para X-Poker) pero queda editable -- si esta carga
    // puntual cambió, se pisa acá sin tener que ir a Configuración → Clubes primero.
    if (club?.unit === "FICHAS") setValorFicha(String(club.current_rate ?? 1));
  }

  function elegirTipo(v: string) {
    // Cambiar el tipo reinicia los pasos siguientes -- si ya habías completado Agente/Club/etc.
    // con un tipo y cambiás de idea, no queda un formulario a medio llenar con combinaciones
    // que no tienen sentido para el tipo nuevo.
    setType(v);
    setAgentId("");
    setClubId("");
    setClubDestinoId("");
    setAmount("");
    setMedioAdelanto("");
    setMsg(null);
  }

  // PRUEBA solo para Tiny (nombre real hoy: "Tiny GG") -- todavía no hay una fuente en vivo
  // conectada para X-Poker.
  const esTiny = /tiny/i.test(clubSeleccionado?.name ?? "");

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    // Adelanto de rakeback / Adelanto de fichas: no son un movimiento de ledger, son su propio
    // flujo (mismo que "Nuevo adelanto" en Adelantos.tsx) -- validación y llamada separadas del
    // resto de los tipos. El de fichas siempre manda medio="FICHAS" y kind="FICHAS_PENDIENTE".
    if (esAdelanto) {
      if (!agentId) return setMsg({ ok: false, text: "Elegí un agente." });
      if (!(Number(amount) > 0)) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
      const medio = esAdelantoFichas ? "FICHAS" : medioAdelanto;
      if (medio && !clubId) return setMsg({ ok: false, text: "Un adelanto en fichas o USDT necesita club de origen." });
      setLoading(true);
      try {
        await api.altaAdelanto({
          agentId,
          amount: Number(amount),
          medio: medio || null,
          clubOrigenId: clubId || null,
          kind: esAdelantoFichas ? "FICHAS_PENDIENTE" : "RAKEBACK",
          notes: observation.trim() || undefined,
        });
        setMsg({ ok: true, text: esAdelantoFichas ? "Adelanto de fichas cargado." : "Adelanto de rakeback cargado." });
        setAmount("");
        setObservation("");
        setMedioAdelanto("");
        setRefreshKey((k) => k + 1);
      } catch (err: any) {
        setMsg({ ok: false, text: err.message || "No se pudo cargar el adelanto." });
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!agentId || !clubId || !amount) return setMsg({ ok: false, text: "Agente, club e importe son obligatorios." });
    if (type === "TRANSFERENCIA_ENTRE_CLUBES" && !clubDestinoId) return setMsg({ ok: false, text: "La transferencia necesita club de destino." });
    if (paymentMethod === "EFECTIVO" && !custodian.trim()) return setMsg({ ok: false, text: "Un movimiento en efectivo requiere custodio (BIT-051/052)." });

    setLoading(true);
    try {
      // El importe SIEMPRE es USD y se manda tal cual -- es lo único que mueve el saldo. Para
      // clubes en fichas, se calculan las fichas equivalentes (importe × tasa) solo para
      // dejarlas guardadas como referencia (originalAmount/originalUnit), nunca se usan para
      // el monto real del movimiento.
      const fichasEquivalentes = esFichas ? (Number(amount) || 0) * (Number(valorFicha) || 0) : 0;
      await api.crearMovimiento({
        type,
        agentId,
        clubId,
        clubDestinoId: type === "TRANSFERENCIA_ENTRE_CLUBES" ? clubDestinoId : undefined,
        amount: Number(amount) || 0,
        originalAmount: esFichas ? fichasEquivalentes : undefined,
        originalUnit: esFichas ? "FICHAS" : undefined,
        paymentMethod,
        custodian: paymentMethod === "EFECTIVO" ? custodian.trim() : undefined,
        occurredAt: new Date(occurredAt).toISOString(),
        observation: observation.trim() || undefined,
      });
      setMsg({ ok: true, text: "Movimiento registrado y aplicado." });
      setAmount("");
      setObservation("");
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setLoading(false);
    }
  }

  // Pasos revelados uno a uno (29/09/2026, pedido de Leo). El club es opcional para un adelanto
  // "sin especificar" (medioAdelanto === "" en ADELANTO_RAKEBACK) -- para no bloquear el flujo
  // esperando un valor que puede no llegar nunca, ese caso se considera "resuelto" con solo
  // llegar al paso (el select de club ya está visible, elegirlo o no queda a criterio).
  const pasoAgente = type !== "";
  const pasoClub = pasoAgente && agentId !== "";
  const clubResuelto = clubId !== "" || (type === "ADELANTO_RAKEBACK" && !medioAdelanto);
  const pasoClubDestino = pasoClub && clubResuelto && type === "TRANSFERENCIA_ENTRE_CLUBES";
  const clubDestinoResuelto = type !== "TRANSFERENCIA_ENTRE_CLUBES" || clubDestinoId !== "";
  const pasoImporte = pasoClub && clubResuelto && clubDestinoResuelto;
  const importeResuelto = Number(amount) > 0;
  const pasoSiguienteAImporte = pasoImporte && importeResuelto;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cargar movimiento</h2>
          <div className="muted">Cada movimiento se aplica al instante y actualiza los saldos en el momento.</div>
        </div>
      </div>

      <div className="panel">
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>1. Tipo de movimiento</label>
            <select value={type} onChange={(e) => elegirTipo(e.target.value)}>
              <option value="">Elegir...</option>
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {pasoAgente && (
            <div className="field">
              <label>2. Agente</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Elegir...</option>
                {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          {pasoClub && (
            <div className="field">
              <label>
                3. Club {type === "TRANSFERENCIA_ENTRE_CLUBES" ? "(origen)" : esAdelanto ? "de origen (opcional)" : ""}
              </label>
              <select value={clubId} onChange={(e) => elegirClub(e.target.value)}>
                <option value="">{esAdelanto ? "Sin especificar" : "Elegir..."}</option>
                {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {esAdelantoFichas && (
                <span className="muted" style={{ fontSize: 12 }}>El adelanto de fichas siempre necesita club de origen (de dónde salen).</span>
              )}
            </div>
          )}

          {pasoClubDestino && (
            <div className="field">
              <label>4. Club destino</label>
              <select value={clubDestinoId} onChange={(e) => setClubDestinoId(e.target.value)}>
                <option value="">Elegir...</option>
                {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {pasoImporte && (
            <div className="field">
              <label>{esAdelanto ? "Monto adelantado (USD)" : "Importe (USD)"}</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" placeholder="0.00" autoFocus />
            </div>
          )}

          {pasoSiguienteAImporte && type === "ADELANTO_RAKEBACK" && (
            <div className="field">
              <label>Medio</label>
              <select value={medioAdelanto} onChange={(e) => setMedioAdelanto(e.target.value as any)}>
                <option value="">Sin especificar (no mueve nada todavía)</option>
                <option value="FICHAS">Fichas (mueve el stock ya mismo)</option>
                <option value="USDT">USDT (sale de la wallet ya mismo)</option>
              </select>
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && esFichas && (
            <div className="field">
              <label>Valor de la ficha (USD)</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={valorFicha} onChange={(e) => setValorFicha(e.target.value)} type="number" step="0.01" style={{ flex: 1 }} />
                {esTiny && (
                  <button
                    type="button"
                    className="btn secondary small"
                    disabled={cotizando}
                    onClick={traerCotizacionEnVivo}
                    title="Traer la cotización USDT/TWD en vivo de MAX (max.maicoin.com)"
                  >
                    {cotizando ? "..." : "🔄 En vivo"}
                  </button>
                )}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                = {((Number(amount) || 0) * (Number(valorFicha) || 0)).toLocaleString("es-AR", { maximumFractionDigits: 2 })} fichas
              </span>
              {cotizacionMsg && (
                <div className={cotizacionMsg.ok ? "success" : "error"} style={{ marginTop: 6, fontSize: 12, padding: "6px 9px" }}>
                  {cotizacionMsg.text}
                </div>
              )}
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && (
            <div className="field">
              <label>Medio de pago</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="SIN_TESORERIA">Sin tesorería (interno)</option>
                <option value="USDT">USDT</option>
                <option value="EFECTIVO">Efectivo</option>
                <option value="ZELLE">Zelle</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && paymentMethod === "EFECTIVO" && (
            <div className="field">
              <label>Custodio del efectivo</label>
              <input value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="Quién tiene la plata físicamente" />
            </div>
          )}

          {pasoSiguienteAImporte && !esAdelanto && (
            <div className="field">
              <label>Fecha y hora</label>
              <input value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} type="datetime-local" />
            </div>
          )}

          {pasoSiguienteAImporte && (
            <div className="field">
              <label>{esAdelanto ? "Notas (opcional)" : "Observación (opcional)"}</label>
              <input value={observation} onChange={(e) => setObservation(e.target.value)} placeholder={esAdelanto ? "Motivo, referencia..." : undefined} />
            </div>
          )}

          {pasoSiguienteAImporte && type === "ADELANTO_RAKEBACK" && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Esto da de alta un adelanto de rakeback nuevo e independiente (por agente, no por club) — se
              descuenta después en la liquidación real. Para ajustar, corregir o eliminar uno que ya existe,
              o ver el historial completo, andá a "Adelantos" (acá abajo).
            </div>
          )}
          {pasoSiguienteAImporte && esAdelantoFichas && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Esto carga fichas de adelanto: suman al stock del agente ya mismo, pero NO a su saldo a favor
              — nos las debe. Va a aparecer como "Fichas pendientes" en Adelantos (acá abajo) y en el
              resumen del agente hasta que se cobre (cruzándolo en Liquidaciones, o desde "Ajustar → Consumo" ahí abajo).
            </div>
          )}

          {pasoSiguienteAImporte && (
            <>
              {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
              <button className="btn" disabled={loading}>
                {loading ? "Registrando..." : esAdelanto ? "Dar de alta el adelanto" : "Registrar movimiento"}
              </button>
            </>
          )}
        </form>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Historial de movimientos cargados</h3>
        <div className="muted" style={{ marginBottom: 14 }}>
          Últimos movimientos registrados en el sistema (los más recientes primero), para verificar rápido lo que se fue cargando.
        </div>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Agente</label>
            <select value={filtroAgentId} onChange={(e) => setFiltroAgentId(e.target.value)}>
              <option value="">Todos</option>
              {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Club</label>
            <select value={filtroClubId} onChange={(e) => setFiltroClubId(e.target.value)}>
              <option value="">Todos</option>
              {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tipo</label>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">Todos</option>
              {TIPOS_FILTRO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Desde</label>
            <input value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} type="date" />
          </div>
          <div className="field">
            <label>Hasta</label>
            <input value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} type="date" />
          </div>
        </div>
        <MovimientosHistorial
          key={refreshKey}
          agentId={filtroAgentId || undefined}
          clubId={filtroClubId || undefined}
          type={filtroTipo || undefined}
          desde={filtroDesde || undefined}
          hasta={filtroHasta || undefined}
        />
      </div>

      <SaldoHistorico agentes={agentes} clubes={clubes} />

      {/* (29/09/2026, pedido de Leo: "la sección adelantos debería desaparecer") -- unificada acá
          del todo, ya no es una pantalla propia. clubes ya está cargado arriba para el resto del
          formulario, se reusa en vez de volver a pedirlo. */}
      <div className="panel" style={{ marginTop: 24 }}>
        <AdelantosPanel clubes={clubes} />
      </div>
    </div>
  );
}
