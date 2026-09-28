import { useEffect, useState } from "react";
import { api } from "../api";
import MovimientosHistorial from "../components/MovimientosHistorial";

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
];

function todayLocal() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 16);
}

export default function Movimientos() {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);

  const [type, setType] = useState("CARGA");
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
  // Solo para el tipo "Adelanto de rakeback" (ver nota en TIPOS más arriba) -- mismo campo
  // "medio" que ya tenía el Alta en Adelantos.tsx: "" = sin especificar (no mueve nada todavía),
  // FICHAS/USDT = mueve stock/wallet ya mismo (se descuenta después en la liquidación real).
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

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }, []);

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

    // Adelanto de rakeback: no es un movimiento de ledger, es su propio flujo (mismo que "Nuevo
    // adelanto" en Adelantos.tsx) -- validación y llamada separadas del resto de los tipos.
    if (type === "ADELANTO_RAKEBACK") {
      if (!agentId) return setMsg({ ok: false, text: "Elegí un agente." });
      if (!(Number(amount) > 0)) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
      if (medioAdelanto && !clubId) return setMsg({ ok: false, text: "Un adelanto en fichas o USDT necesita club de origen." });
      setLoading(true);
      try {
        await api.altaAdelanto({
          agentId,
          amount: Number(amount),
          medio: medioAdelanto || null,
          clubOrigenId: clubId || null,
          notes: observation.trim() || undefined,
        });
        setMsg({ ok: true, text: "Adelanto de rakeback cargado." });
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
      setMsg({ ok: true, text: "Movimiento registrado y aplicado al ledger." });
      setAmount("");
      setObservation("");
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cargar movimiento</h2>
          <div className="muted">Cada movimiento se aplica de forma atómica al ledger y actualiza saldos al instante.</div>
        </div>
      </div>

      <div className="panel">
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label>Tipo de movimiento</label>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Agente</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Elegir...</option>
                {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>
                Club {type === "TRANSFERENCIA_ENTRE_CLUBES" ? "(origen)" : type === "ADELANTO_RAKEBACK" ? "de origen (opcional)" : ""}
              </label>
              <select value={clubId} onChange={(e) => elegirClub(e.target.value)}>
                <option value="">{type === "ADELANTO_RAKEBACK" ? "Sin especificar" : "Elegir..."}</option>
                {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {type === "TRANSFERENCIA_ENTRE_CLUBES" && (
              <div className="field">
                <label>Club destino</label>
                <select value={clubDestinoId} onChange={(e) => setClubDestinoId(e.target.value)}>
                  <option value="">Elegir...</option>
                  {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label>{type === "ADELANTO_RAKEBACK" ? "Monto adelantado (USD)" : "Importe (USD)"}</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" placeholder="0.00" />
            </div>
            {type === "ADELANTO_RAKEBACK" && (
              <div className="field">
                <label>Medio</label>
                <select value={medioAdelanto} onChange={(e) => setMedioAdelanto(e.target.value as any)}>
                  <option value="">Sin especificar (no mueve nada todavía)</option>
                  <option value="FICHAS">Fichas (mueve el stock ya mismo)</option>
                  <option value="USDT">USDT (sale de la wallet ya mismo)</option>
                </select>
              </div>
            )}
            {type !== "ADELANTO_RAKEBACK" && esFichas && (
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
            {type !== "ADELANTO_RAKEBACK" && (
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
            {type !== "ADELANTO_RAKEBACK" && paymentMethod === "EFECTIVO" && (
              <div className="field">
                <label>Custodio del efectivo</label>
                <input value={custodian} onChange={(e) => setCustodian(e.target.value)} placeholder="Quién tiene la plata físicamente" />
              </div>
            )}
            {type !== "ADELANTO_RAKEBACK" && (
              <div className="field">
                <label>Fecha y hora</label>
                <input value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} type="datetime-local" />
              </div>
            )}
          </div>
          <div className="field">
            <label>{type === "ADELANTO_RAKEBACK" ? "Notas (opcional)" : "Observación (opcional)"}</label>
            <input value={observation} onChange={(e) => setObservation(e.target.value)} placeholder={type === "ADELANTO_RAKEBACK" ? "Motivo, referencia..." : undefined} />
          </div>
          {type === "ADELANTO_RAKEBACK" && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Esto da de alta un adelanto de rakeback nuevo e independiente (por agente, no por club) — se
              descuenta después en la liquidación real. Para ajustar, corregir o eliminar uno que ya existe,
              o ver el historial completo, andá a "Adelantos".
            </div>
          )}
          {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
          <button className="btn" disabled={loading}>
            {loading ? "Registrando..." : type === "ADELANTO_RAKEBACK" ? "Dar de alta el adelanto" : "Registrar movimiento"}
          </button>
        </form>
      </div>

      <div className="panel" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Historial de movimientos cargados</h3>
        <div className="muted" style={{ marginBottom: 14 }}>
          Últimos movimientos registrados en el sistema (los más recientes primero), para verificar rápido lo que se fue cargando.
        </div>
        <MovimientosHistorial key={refreshKey} />
      </div>
    </div>
  );
}
