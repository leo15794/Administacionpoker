import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmProvider";
import { usdCents as usd } from "../fmt";
import { usePaginado, WmPaginacion, WmTabs, WmSaldoCard, WmConteos, type WmTab } from "../components/ListaWm";

// Cuentas de jugadores de TeamBack Affiliates (21/10/2026, pedido de Leo): una cuenta corriente por jugador, como las de supervisores y agentes del
// sistema principal. Sus liquidaciones suman a favor; lo que se le entrega a cuenta (fichas) queda como deuda y se compensa SOLO contra las liquidaciones
// (de la más vieja a la más nueva, apenas se calcula cada una): no hay botón para compensar. Lo que sobra se paga como siempre desde Liquidaciones.
const hoy = () => new Date().toISOString().slice(0, 10);
const signo = (n: number) => (n < 0 ? "−" : "") + usd(Math.abs(n));
const diaMes = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

function Estado({ c }: { c: any }) {
  if (c.deuda > 0.004) return <span className="pill a" style={{ background: "rgba(229,72,77,.15)", color: "var(--red)" }}>Nos debe</span>;
  if (c.pendiente > 0.004) return <span className="pill g">Le debemos</span>;
  return <span className="pill">Al día</span>;
}

export default function CuentasJugadoresTab() {
  const [datos, setDatos] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  // Lista con el estilo de la Wallet (23/10/2026, pedido de Leo, mockup aprobado): pestañas por estado, buscador y paginación.
  const [estadoTab, setEstadoTab] = useState<"todas" | "deben" | "apagar" | "aldia">("todas");
  const [buscaC, setBuscaC] = useState("");
  const qC = buscaC.trim().toLowerCase();
  const todasOrdenadas = [...(datos?.cuentas ?? [])].sort((a: any, b: any) => b.deuda - a.deuda || b.pendiente - a.pendiente || a.name.localeCompare(b.name));
  const estadoDe = (c: any): "deben" | "apagar" | "aldia" => (c.deuda > 0.004 ? "deben" : c.pendiente > 0.004 ? "apagar" : "aldia");
  const visibles = todasOrdenadas.filter((c: any) => (estadoTab === "todas" || estadoDe(c) === estadoTab) && (qC === "" || String(c.name).toLowerCase().includes(qC)));
  const pgC = usePaginado(visibles, "dp_tb_cuentas_tamano", [estadoTab, buscaC]);

  function cargar() {
    api.teamback.cuentas().then(setDatos).catch((e: any) => setError(e.message));
  }
  useEffect(cargar, []);

  if (sel) return <DetalleCuenta playerId={sel} onVolver={() => { setSel(null); cargar(); }} />;
  if (error) return <div className="error">{error}</div>;
  if (!datos) return <div className="muted">Cargando...</div>;
  const t = datos.totales;
  const cuentasTotal = { todas: datos.cuentas.length, deben: datos.cuentas.filter((c: any) => estadoDe(c) === "deben").length, apagar: datos.cuentas.filter((c: any) => estadoDe(c) === "apagar").length, aldia: datos.cuentas.filter((c: any) => estadoDe(c) === "aldia").length };
  return (
    <div className="wm">
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Cada jugador tiene su cuenta corriente: las liquidaciones suman a su favor y lo que se le entrega a cuenta (fichas) queda como deuda. La deuda se descuenta sola de sus liquidaciones, de la más vieja a la más nueva, apenas se calculan.
      </div>
      <WmSaldoCard
        etiqueta="DEUDA DE JUGADORES"
        monto={usd(t.deuda)}
        signo={t.deuda > 0 ? "neg" : ""}
        sub={`${t.conDeuda} jugador${t.conDeuda === 1 ? "" : "es"} con deuda`}
      >
        <WmConteos
          items={[
            { etiqueta: "PENDIENTE DE PAGAR", valor: usd(t.pendiente) },
            { etiqueta: "COMPENSADO HASTA HOY", valor: usd(t.compensado) },
          ]}
        />
      </WmSaldoCard>

      <div className="wm-card">
        <div className="wm-cab">
          <div className="wm-h">Cuentas <span className="wm-n">{visibles.length}</span></div>
          <div className="wm-fil">
            <input className="wm-in" placeholder="Buscar jugador..." value={buscaC} onChange={(e) => setBuscaC(e.target.value)} />
          </div>
        </div>
        <WmTabs
          actual={estadoTab}
          onChange={setEstadoTab}
          tabs={
            [
              { k: "todas", t: "Todas", n: cuentasTotal.todas },
              { k: "deben", t: "Nos deben", n: cuentasTotal.deben },
              { k: "apagar", t: "Le debemos", n: cuentasTotal.apagar },
              { k: "aldia", t: "Al día", n: cuentasTotal.aldia },
            ] as WmTab<typeof estadoTab>[]
          }
        />
        <div className="cj-th">
          <span>JUGADOR</span><span>A PAGAR</span><span>DEUDA</span><span>SALDO NETO</span><span>ESTADO</span><span />
        </div>
        {pgC.recorte.map((c: any) => (
          <div className="cj-fila" key={c.id}>
            <div className="wm-who">
              <span className={`wm-av ${c.deuda > 0.004 ? "n" : ""}`}>{String(c.name).trim().slice(0, 2).toUpperCase()}</span>
              <div>
                <div className="saldo-name">{c.name}</div>
                {c.semanas_pendientes > 0 && <div className="saldo-sub">{c.semanas_pendientes} {c.semanas_pendientes === 1 ? "semana" : "semanas"} sin pagar</div>}
              </div>
            </div>
            <span className="n">{c.pendiente > 0 ? usd(c.pendiente) : <span className="muted">—</span>}</span>
            <span className="n" style={{ color: c.deuda > 0 ? "var(--red)" : undefined }}>{c.deuda > 0 ? usd(c.deuda) : <span className="muted">—</span>}</span>
            <span className="n"><b style={{ color: c.neto < 0 ? "var(--red)" : undefined }}>{signo(c.neto)}</b></span>
            <span><Estado c={c} /></span>
            <span style={{ textAlign: "right" }}><button className="btn secondary small" onClick={() => setSel(c.id)}>Ver cuenta</button></span>
          </div>
        ))}
        {visibles.length === 0 && <div className="muted" style={{ padding: "16px 8px" }}>{datos.cuentas.length === 0 ? "Todavía no hay liquidaciones calculadas." : "Ninguna cuenta coincide con estos filtros."}</div>}
        <div className="wm-pie">
          <div className="wm-tot">
            <span>Saldo neto de lo filtrado <b className={visibles.reduce((a: number, c: any) => a + c.neto, 0) >= 0 ? "in" : "out"}>{signo(visibles.reduce((a: number, c: any) => a + c.neto, 0))}</b></span>
            <small>{visibles.length} cuenta{visibles.length === 1 ? "" : "s"}</small>
          </div>
        </div>
        <WmPaginacion p={pgC} unidad="cuentas" />
      </div>
    </div>
  );
}

function DetalleCuenta({ playerId, onVolver }: { playerId: string; onVolver: () => void }) {
  const { confirmDialog } = useConfirmDialog();
  const [cuenta, setCuenta] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<null | "CARGO" | "COBRO" | "AJUSTE">(null);

  function cargar() {
    api.teamback.cuenta(playerId).then(setCuenta).catch((e: any) => setError(e.message));
  }
  useEffect(cargar, [playerId]);

  async function anular(m: any) {
    const ok = await confirmDialog(`¿Anular "${m.concepto}" por ${usd(Math.abs(m.importe))}?\nLas liquidaciones que se habían compensado por ese movimiento se liberan y se vuelven a repartir con lo que quede.`, { title: "Anular movimiento", danger: true });
    if (!ok) return;
    try {
      await api.teamback.anularMovimientoCuenta(m.movimientoId);
      cargar();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (error && !cuenta) return <div className="error">{error}</div>;
  if (!cuenta) return <div className="muted">Cargando...</div>;
  const r = cuenta.resumen;
  return (
    <div>
      <button className="btn secondary small" onClick={onVolver} style={{ marginBottom: 12 }}>← Todas las cuentas</button>
      {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}
      <div className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="deals-eyebrow">Cuenta del jugador</div>
            <div style={{ fontSize: 22, fontWeight: 750 }}>{cuenta.jugador.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>ID Suprema {cuenta.jugador.suprema_player_id}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 12 }}>Saldo neto · {r.neto < -0.004 ? "nos debe" : r.neto > 0.004 ? "le debemos" : "al día"}</div>
            <div className="saldo-big" style={{ fontSize: 30, color: r.neto < 0 ? "var(--red)" : undefined }}>{signo(r.neto)}</div>
          </div>
        </div>
        <div className="stat-row" style={{ margin: "14px 0" }}>
          <div className="stat-card"><div className="l">A pagar (liquidaciones)</div><div className="v">{usd(r.pendiente)}</div></div>
          <div className="stat-card"><div className="l">Deuda actual</div><div className="v" style={{ color: r.deuda > 0 ? "var(--red)" : undefined }}>{usd(r.deuda)}</div></div>
          <div className="stat-card"><div className="l">Compensado</div><div className="v">{usd(r.compensado)}</div></div>
          <div className="stat-card"><div className="l">Ya pagado</div><div className="v">{usd(r.pagado)}</div></div>
        </div>
        {r.compensado_de_mas > 0.004 && (
          <div className="error" style={{ marginBottom: 10 }}>
            Se anuló una deuda que ya se había descontado y pagado: al jugador se le retuvieron {usd(r.compensado_de_mas)} de más. Cargale un Ajuste negativo (a su favor) por ese importe para devolvérselos.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setForm("CARGO")}>+ Cargo de fichas</button>
          <button className="btn secondary" onClick={() => setForm("COBRO")} disabled={r.deuda <= 0}>+ Cobro</button>
          <button className="btn secondary" onClick={() => setForm("AJUSTE")}>+ Ajuste</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          No hace falta compensar a mano: la deuda se descuenta sola de las liquidaciones pendientes y de las que se calculen de ahora en más. Lo que quede a favor del jugador se paga desde Liquidaciones.
        </div>
      </div>

      <div className="panel" style={{ overflowX: "auto" }}>
        <h3 style={{ margin: "0 0 8px" }}>Movimientos</h3>
        <table>
          <thead><tr><th>Fecha</th><th>Concepto</th><th>Estado</th><th style={{ textAlign: "right" }}>Importe</th><th style={{ textAlign: "right" }}>Saldo</th><th></th></tr></thead>
          <tbody>
            {cuenta.movimientos.map((m: any) => (
              <tr key={m.clave} style={m.revertido ? { opacity: 0.45, textDecoration: "line-through" } : undefined}>
                <td>{diaMes(m.fecha)}</td>
                <td>{m.concepto}</td>
                <td className="muted" style={{ fontSize: 12 }}>{m.revertido ? "Anulado" : m.estado ?? ""}</td>
                <td style={{ textAlign: "right", color: m.importe < 0 ? "var(--red)" : "var(--green)" }}>{m.importe > 0 ? "+" : "−"}{usd(Math.abs(m.importe))}</td>
                <td style={{ textAlign: "right" }}><b style={{ color: m.saldo < 0 ? "var(--red)" : undefined }}>{signo(m.saldo)}</b></td>
                <td style={{ textAlign: "right" }}>{m.movimientoId && !m.revertido && <button className="btn secondary small" onClick={() => anular(m)}>Anular</button>}</td>
              </tr>
            ))}
            {cuenta.movimientos.length === 0 && <tr><td colSpan={6} className="muted">Sin movimientos.</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <FormMovimiento
          tipo={form}
          jugador={cuenta.jugador.name}
          deuda={r.deuda}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); cargar(); }}
          playerId={playerId}
        />
      )}
    </div>
  );
}

function FormMovimiento({ tipo, jugador, deuda, playerId, onClose, onSaved }: { tipo: "CARGO" | "COBRO" | "AJUSTE"; jugador: string; deuda: number; playerId: string; onClose: () => void; onSaved: () => void }) {
  const [monto, setMonto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [aFavor, setAFavor] = useState(false); // solo en Ajuste: a favor del jugador (resta deuda) o en su contra (suma deuda)
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<any | null>(null);
  const n = Number(monto.replace(",", "."));
  const titulo = tipo === "CARGO" ? "Cargo de fichas" : tipo === "COBRO" ? "Cobro de deuda" : "Ajuste";

  async function guardar() {
    setError("");
    if (!Number.isFinite(n) || n <= 0) return setError("Poné un importe mayor a cero.");
    setGuardando(true);
    try {
      const r = await api.teamback.cargarMovimientoCuenta(playerId, { tipo, amount: tipo === "AJUSTE" && aFavor ? -n : n, concepto: concepto.trim() || undefined, fecha });
      setResultado(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (resultado) {
    return (
      <Modal title={titulo} onClose={onSaved}>
        <div style={{ lineHeight: 1.6 }}>
          <b>Listo.</b>{" "}
          {resultado.compensado > 0
            ? <>Se compensaron <b>{usd(resultado.compensado)}</b> contra las liquidaciones pendientes de {jugador}. Deuda que queda: <b>{usd(resultado.deuda)}</b>.</>
            : resultado.deuda > 0
              ? <>Queda una deuda de <b>{usd(resultado.deuda)}</b>; se va a descontar de sus próximas liquidaciones.</>
              : <>La cuenta de {jugador} quedó sin deuda.</>}
        </div>
        <div style={{ marginTop: 14 }}><button className="btn" onClick={onSaved}>Cerrar</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={`${titulo} · ${jugador}`} onClose={onClose}>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        {tipo === "CARGO" && "Fichas (o plata) que le entregaste a cuenta. Queda como deuda y se descuenta solo de sus liquidaciones, de la más vieja a la más nueva. 1 ficha = US$ 1."}
        {tipo === "COBRO" && `El jugador te pagó parte de su deuda por afuera de las liquidaciones. Deuda actual: ${usd(deuda)}.`}
        {tipo === "AJUSTE" && "Corrección manual de la deuda."}
      </div>
      {tipo === "AJUSTE" && (
        <div className="field">
          <label>Tipo de ajuste</label>
          <select value={aFavor ? "fav" : "contra"} onChange={(e) => setAFavor(e.target.value === "fav")}>
            <option value="contra">En su contra (suma deuda)</option>
            <option value="fav">A su favor (resta deuda)</option>
          </select>
        </div>
      )}
      <div className="field"><label>Importe (US$ / fichas)</label><input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej. 100" autoFocus /></div>
      <div className="field"><label>Concepto</label><input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tipo === "CARGO" ? "Ej. 100 fichas entregadas" : "Opcional"} maxLength={200} /></div>
      <div className="field"><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
      {error && <div className="error" style={{ marginBottom: 8 }}>{error}</div>}
      <button className="btn" onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar"}</button>
    </Modal>
  );
}
