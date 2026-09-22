import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import Modal from "../components/Modal";

// Sección "Proveedores" (22/09/2026, pedido de Leo) -- entidad separada de Agentes/Clubes,
// a propósito no comparte pantallas ni datos con esas ("no mezclarlo con lo que ya tenemos").
// Caso original: Manzur como "unión" en Fénix GG, que nos entrega el 75% del rake TOTAL del
// club (no un agente al 75% de sus propios jugadores -- eso sigue siendo Cierres/Liquidaciones
// normal, Manzur convive con las dos cuentas al mismo tiempo).

const GARANTIA_TIPO_LABEL: Record<string, string> = {
  ALTA: "Alta",
  AUMENTO: "Aumento",
  REDUCCION: "Reducción",
  CONSUMO: "Consumo",
  BAJA: "Baja",
};

type Tab = "saldos" | "cierres" | "pagos" | "garantias";

export default function Proveedores() {
  const [tab, setTab] = useState<Tab>("saldos");
  const [proveedores, setProveedores] = useState<any[] | null>(null);
  const [clubes, setClubes] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [saldos, setSaldos] = useState<any[] | null>(null);
  const [cierres, setCierres] = useState<any[] | null>(null);
  const [pagos, setPagos] = useState<any[] | null>(null);
  const [garantias, setGarantias] = useState<any[] | null>(null);
  const [garantiasHistorial, setGarantiasHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  const [showNuevoProveedor, setShowNuevoProveedor] = useState(false);
  const [editandoProveedor, setEditandoProveedor] = useState<any | null>(null);
  const [showCierre, setShowCierre] = useState(false);
  const [showPago, setShowPago] = useState(false);
  const [showGarantiaAjuste, setShowGarantiaAjuste] = useState<{ proveedorId?: string } | null>(null);

  function refresh() {
    setError("");
    api.proveedores().then(setProveedores).catch((e) => setError(e.message));
    api.saldosProveedores().then(setSaldos).catch(() => {});
    api.cierresProveedor().then(setCierres).catch(() => {});
    api.pagosProveedor().then(setPagos).catch(() => {});
    api.garantiasProveedores().then(setGarantias).catch(() => {});
    api.garantiasProveedoresHistorial().then(setGarantiasHistorial).catch(() => {});
  }

  useEffect(() => {
    refresh();
    api.proveedoresClubes().then(setClubes);
    api.agentesProveedores().then(setAgentes);
  }, []);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Proveedores: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!proveedores) return <div className="muted">Cargando...</div>;

  const totalSaldo = (saldos ?? []).reduce((s, x) => s + Number(x.amount), 0);
  const totalGarantizado = (garantias ?? []).reduce((s, g) => s + Number(g.amount), 0);
  const totalGarantiaPendiente = (garantias ?? []).reduce((s, g) => s + (Number(g.amount) - Number(g.consumed)), 0);

  async function onRevertirCierre(id: string) {
    if (!confirm("¿Revertir este cierre? Solo funciona si no hay pagos/cierres más nuevos encima.")) return;
    try {
      await api.revertirCierreProveedor(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  async function onRevertirPago(id: string) {
    if (!confirm("¿Revertir este pago? Solo funciona si no hay movimientos más nuevos encima.")) return;
    try {
      await api.revertirPagoProveedor(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  async function onEliminarCierre(id: string) {
    if (!confirm("¿Eliminar este cierre DEL TODO? No se puede deshacer (a diferencia de \"Revertir\", esto lo saca del historial).")) return;
    try {
      await api.eliminarCierreProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  async function onEliminarPago(id: string) {
    if (!confirm("¿Eliminar este pago DEL TODO? No se puede deshacer.")) return;
    try {
      await api.eliminarPagoProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  async function onEliminarGarantia(id: string) {
    if (!confirm("¿Eliminar esta garantía DEL TODO, junto con su historial? No se puede deshacer.")) return;
    try {
      await api.eliminarGarantiaProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  async function onEliminarProveedor(id: string, nombre: string) {
    if (!confirm(`¿Eliminar a "${nombre}" DEL TODO -- saldos, cierres, pagos y garantías? No se puede deshacer.`)) return;
    try {
      await api.eliminarProveedorDefinitivo(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Proveedores</h2>
          <div className="muted">
            Cuentas separadas de Agentes -- para relaciones donde alguien nos entrega un % del rake TOTAL de un club
            (no de sus propios jugadores), ej. Manzur en Fénix GG.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" onClick={() => setShowNuevoProveedor(true)}>+ Nuevo proveedor</button>
          <button className="btn" onClick={() => setShowCierre(true)} disabled={proveedores.length === 0}>+ Cierre semanal</button>
          <button className="btn secondary" onClick={() => setShowPago(true)} disabled={proveedores.length === 0}>+ Pago / cobro</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Proveedores activos</div>
          <div className="value">{proveedores.length}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Saldo total (a favor del proveedor)</div>
          <div className="value">{usd(totalSaldo)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Garantizado</div>
          <div className="value">{usd(totalGarantizado)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Garantía pendiente</div>
          <div className="value">{usd(totalGarantiaPendiente)}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Proveedores</h3>
        <table>
          <thead><tr><th>Nombre</th><th>Auto-cierre</th><th>Notas</th><th></th></tr></thead>
          <tbody>
            {proveedores.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {p.auto_cierre_club_id
                    ? `${clubes.find((c) => c.id === p.auto_cierre_club_id)?.name ?? "?"} · ${pct(p.auto_cierre_rakeback_pct)}`
                    : "Sin auto-cierre"}
                </td>
                <td className="muted" style={{ fontSize: 12 }} title={p.notes || undefined}>{p.notes || "—"}</td>
                <td>
                  <button className="btn secondary small" onClick={() => setEditandoProveedor(p)}>Editar</button>{" "}
                  <button className="btn danger small" onClick={() => onEliminarProveedor(p.id, p.name)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tabs" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button className={`btn small ${tab === "saldos" ? "" : "secondary"}`} onClick={() => setTab("saldos")}>Saldos</button>
        <button className={`btn small ${tab === "cierres" ? "" : "secondary"}`} onClick={() => setTab("cierres")}>Cierres semanales</button>
        <button className={`btn small ${tab === "pagos" ? "" : "secondary"}`} onClick={() => setTab("pagos")}>Pagos / cobros</button>
        <button className={`btn small ${tab === "garantias" ? "" : "secondary"}`} onClick={() => setTab("garantias")}>Garantías</button>
      </div>

      {tab === "saldos" && (
        <div className="panel">
          <h3>Saldo operativo por proveedor+club</h3>
          {!saldos ? (
            <div className="muted">Cargando...</div>
          ) : saldos.length === 0 ? (
            <div className="muted">Todavía no hay saldos -- se generan solos con el primer cierre o pago.</div>
          ) : (
            <table>
              <thead><tr><th>Proveedor</th><th>Club</th><th>Saldo</th><th>Actualizado</th></tr></thead>
              <tbody>
                {saldos.map((s) => (
                  <tr key={s.id}>
                    <td>{s.proveedor_name}</td>
                    <td>{s.club_name}</td>
                    <td>
                      <span className={`badge ${Number(s.amount) > 0 ? "pos" : Number(s.amount) < 0 ? "neg" : "neutral"}`}>
                        {usd(s.amount)}
                      </span>
                    </td>
                    <td className="muted">{dateShort(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Positivo = a favor del proveedor (le debemos). Negativo = a favor nuestro (nos debe). Se actualiza solo con
            cada cierre semanal y cada pago/cobro -- nunca se edita a mano.
          </div>
        </div>
      )}

      {tab === "cierres" && (
        <div className="panel">
          <h3>Historial de cierres semanales</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Un cierre puede tener varias líneas (club y/o agente) -- tocá una fila para ver el detalle.
          </div>
          {!cierres ? (
            <div className="muted">Cargando...</div>
          ) : cierres.length === 0 ? (
            <div className="muted">Todavía no hay cierres cargados.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Semana</th><th>Proveedor</th><th>Cierre</th><th>Saldo resultante</th><th></th>
                </tr>
              </thead>
              <tbody>
                {cierres.map((c) => (
                  <CierreRow key={c.id} cierre={c} onRevertir={onRevertirCierre} onEliminar={onEliminarCierre} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "pagos" && (
        <div className="panel">
          <h3>Historial de pagos / cobros</h3>
          {!pagos ? (
            <div className="muted">Cargando...</div>
          ) : pagos.length === 0 ? (
            <div className="muted">Todavía no hay pagos/cobros cargados.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Fecha</th><th>Proveedor</th><th>Club</th><th>Tipo</th><th>Medio</th><th>Monto</th><th>Saldo resultante</th><th></th></tr>
              </thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id} style={p.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                    <td>{dateShort(p.occurred_at)}</td>
                    <td>{p.proveedor_name}</td>
                    <td>{p.club_name}</td>
                    <td><span className="badge neutral">{p.direction === "PAGO" ? "Pago (le dimos)" : "Cobro (nos dio)"}</span></td>
                    <td>{p.medio}</td>
                    <td>{usd(p.amount)}</td>
                    <td>{usd(p.saldo_nuevo)}</td>
                    <td>
                      {p.status !== "REVERTIDO" && (
                        <button className="btn secondary small" onClick={() => onRevertirPago(p.id)}>Revertir</button>
                      )}
                      {p.status === "REVERTIDO" && <span className="badge neg">Revertido</span>}{" "}
                      <button className="btn danger small" onClick={() => onEliminarPago(p.id)}>Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "garantias" && (
        <>
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>Garantías activas</h3>
              <button className="btn secondary small" onClick={() => setShowGarantiaAjuste({})}>+ Ajustar garantía</button>
            </div>
            {!garantias ? (
              <div className="muted">Cargando...</div>
            ) : garantias.length === 0 ? (
              <div className="muted">Todavía no hay garantías activas.</div>
            ) : (
              <table>
                <thead><tr><th>Proveedor</th><th>Garantizado</th><th>Consumido</th><th>Pendiente</th><th>Notas</th><th></th></tr></thead>
                <tbody>
                  {garantias.map((g) => (
                    <tr key={g.id}>
                      <td>{g.proveedor_name}</td>
                      <td>{usd(g.amount)}</td>
                      <td>{usd(g.consumed)}</td>
                      <td><span className="badge neutral">{usd(Number(g.amount) - Number(g.consumed))}</span></td>
                      <td className="muted" style={{ fontSize: 12 }} title={g.notes || undefined}>{g.notes || "—"}</td>
                      <td>
                        <button className="btn secondary small" onClick={() => setShowGarantiaAjuste({ proveedorId: g.proveedor_id })}>Ajustar</button>{" "}
                        <button className="btn danger small" onClick={() => onEliminarGarantia(g.id)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="panel">
            <h3>Historial de garantías</h3>
            {!garantiasHistorial ? (
              <div className="muted">Cargando...</div>
            ) : garantiasHistorial.length === 0 ? (
              <div className="muted">Todavía no hay movimientos.</div>
            ) : (
              <table>
                <thead><tr><th>Fecha</th><th>Proveedor</th><th>Tipo</th><th>Monto</th><th>Resultante</th><th>Consumido</th><th>Notas</th></tr></thead>
                <tbody>
                  {garantiasHistorial.map((m) => (
                    <tr key={m.id}>
                      <td>{dateShort(m.occurred_at)}</td>
                      <td>{m.proveedor_name}</td>
                      <td><span className="badge neutral">{GARANTIA_TIPO_LABEL[m.type] ?? m.type}</span></td>
                      <td>{m.type === "BAJA" ? "—" : usd(m.amount)}</td>
                      <td>{usd(m.resulting_amount)}</td>
                      <td>{usd(m.resulting_consumed)}</td>
                      <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {showNuevoProveedor && (
        <Modal title="Nuevo proveedor" onClose={() => setShowNuevoProveedor(false)}>
          <NuevoProveedorForm clubes={clubes} onDone={() => { setShowNuevoProveedor(false); refresh(); }} />
        </Modal>
      )}
      {editandoProveedor && (
        <Modal title={`Editar ${editandoProveedor.name}`} onClose={() => setEditandoProveedor(null)}>
          <NuevoProveedorForm
            proveedor={editandoProveedor}
            clubes={clubes}
            onDone={() => { setEditandoProveedor(null); refresh(); }}
          />
        </Modal>
      )}
      {showCierre && (
        <Modal title="Cierre semanal de proveedor" onClose={() => setShowCierre(false)}>
          <CierreForm
            proveedores={proveedores}
            clubes={clubes}
            agentes={agentes}
            onDone={() => { setShowCierre(false); refresh(); }}
          />
        </Modal>
      )}
      {showPago && (
        <Modal title="Pago / cobro a proveedor" onClose={() => setShowPago(false)}>
          <PagoForm
            proveedores={proveedores}
            clubes={clubes}
            onDone={() => { setShowPago(false); refresh(); }}
          />
        </Modal>
      )}
      {showGarantiaAjuste && (
        <Modal title="Ajustar garantía de proveedor" onClose={() => setShowGarantiaAjuste(null)}>
          <GarantiaAjusteForm
            proveedores={proveedores}
            garantias={garantias ?? []}
            preselectProveedorId={showGarantiaAjuste.proveedorId}
            onDone={() => { setShowGarantiaAjuste(null); refresh(); }}
          />
        </Modal>
      )}
    </div>
  );
}

function CierreRow({
  cierre,
  onRevertir,
  onEliminar,
}: {
  cierre: any;
  onRevertir: (id: string) => void;
  onEliminar: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [lineas, setLineas] = useState<any[] | null>(null);

  function toggle() {
    const next = !abierto;
    setAbierto(next);
    if (next && !lineas) {
      api.lineasCierreProveedor(cierre.id).then(setLineas).catch(() => setLineas([]));
    }
  }

  return (
    <>
      <tr
        style={{ cursor: "pointer", ...(cierre.status === "REVERTIDO" ? { opacity: 0.55 } : {}) }}
        onClick={toggle}
      >
        <td>{dateShort(cierre.week_start)} - {dateShort(cierre.week_end)}</td>
        <td>{cierre.proveedor_name}</td>
        <td><span className={`badge ${Number(cierre.cierre) > 0 ? "pos" : Number(cierre.cierre) < 0 ? "neg" : "neutral"}`}>{usd(cierre.cierre)}</span></td>
        <td>{usd(cierre.saldo_nuevo)}</td>
        <td>
          {cierre.status !== "REVERTIDO" && (
            <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); onRevertir(cierre.id); }}>Revertir</button>
          )}
          {cierre.status === "REVERTIDO" && <span className="badge neg">Revertido</span>}{" "}
          <button className="btn danger small" onClick={(e) => { e.stopPropagation(); onEliminar(cierre.id); }}>Eliminar</button>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={5} style={{ background: "rgba(255,255,255,0.02)" }}>
            {!lineas ? (
              <div className="muted" style={{ fontSize: 12, padding: 8 }}>Cargando líneas...</div>
            ) : lineas.length === 0 ? (
              <div className="muted" style={{ fontSize: 12, padding: 8 }}>Sin líneas registradas (cierre del formato anterior).</div>
            ) : (
              <table style={{ margin: "4px 0" }}>
                <thead>
                  <tr>
                    <th>Tipo</th><th>Club</th><th>Agente</th><th>Resultado</th><th>Rake</th><th>%</th>
                    <th>Monto bruto</th><th>Aplicado al saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => (
                    <tr key={l.id}>
                      <td>{l.tipo === "CLUB" ? "Club total" : "Agente"}</td>
                      <td>{l.club_name}</td>
                      <td>{l.agent_name ?? "—"}</td>
                      <td>{l.resultado_total !== null ? usd(l.resultado_total) : "—"}</td>
                      <td>{l.rake_total !== null ? usd(l.rake_total) : "—"}</td>
                      <td>{l.rakeback_pct !== null ? pct(l.rakeback_pct) : "—"}</td>
                      <td>{usd(l.monto_crudo)}</td>
                      <td><b>{usd(l.monto_aplicado)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Sirve para crear Y para editar (pasando `proveedor`) -- el auto-cierre (club + % fijo) es
// lo que permite que "Resumen por club" cierre este proveedor solo cuando se guarda esa
// pantalla (22/09/2026, pedido de Leo: "que se haga automaticamente en proveedores, asi no
// tenemos que cargar de nuevo todo"). Dejar el club en "Sin auto-cierre" es válido -- el
// proveedor sigue existiendo, solo que su cierre semanal se sigue aplicando a mano desde acá.
function NuevoProveedorForm({
  proveedor,
  clubes,
  onDone,
}: {
  proveedor?: any;
  clubes: any[];
  onDone: () => void;
}) {
  const [name, setName] = useState(proveedor?.name ?? "");
  const [notes, setNotes] = useState(proveedor?.notes ?? "");
  const [autoCierreClubId, setAutoCierreClubId] = useState(proveedor?.auto_cierre_club_id ?? "");
  const [autoCierreRakebackPct, setAutoCierreRakebackPct] = useState(
    proveedor?.auto_cierre_rakeback_pct != null ? String(Number(proveedor.auto_cierre_rakeback_pct) * 100) : "75"
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    if (autoCierreClubId && !(Number(autoCierreRakebackPct) > 0)) {
      return setMsg({ ok: false, text: "Si elegís un club de auto-cierre, el % de rakeback tiene que ser mayor a 0." });
    }
    setLoading(true);
    const payload = {
      name: name.trim(),
      notes: notes.trim() || undefined,
      autoCierreClubId: autoCierreClubId || null,
      autoCierreRakebackPct: autoCierreClubId ? (Number(autoCierreRakebackPct) || 0) / 100 : null,
    };
    try {
      if (proveedor) {
        await api.actualizarProveedor(proveedor.id, payload);
      } else {
        await api.crearProveedor(payload);
      }
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el proveedor." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Manzur (unión Fénix GG)" />
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Descripción de la relación, referencia, etc." />
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Club de auto-cierre (opcional)</label>
          <select value={autoCierreClubId} onChange={(e) => setAutoCierreClubId(e.target.value)}>
            <option value="">Sin auto-cierre (cerrar a mano)</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {autoCierreClubId && (
          <div className="field">
            <label>% rakeback fijo para el auto-cierre</label>
            <input value={autoCierreRakebackPct} onChange={(e) => setAutoCierreRakebackPct(e.target.value)} type="number" step="0.01" />
          </div>
        )}
      </div>
      {autoCierreClubId && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Cada vez que se guarde el resumen semanal de ese club (en "Resumen por club"), se va a aplicar solo el cierre
          de este proveedor para esa semana, sin tener que volver acá.
        </div>
      )}
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : proveedor ? "Guardar cambios" : "Crear"}</button>
    </form>
  );
}

// Un cierre de proveedor cubre UNA semana y puede tener varias líneas (22/09/2026, pedido de
// Leo, caso Manzur: línea CLUB para Fénix GG donde es "la unión" + línea AGENTE para M CHOCO
// en Fénix Suprema, que ya tiene su cierre normal en Cierres semanales). Línea CLUB: el total
// del club (nunca se re-tipea, sale de "Resumen por club"), se guarda invertido -- esa
// inversión es exclusiva de acá. Línea AGENTE: el cierre YA APLICADO de un agente puntual en
// Cierres semanales, tal cual, sin invertir.
type LineaTipo = "CLUB" | "AGENTE";
interface LineaState {
  key: number;
  tipo: LineaTipo;
  clubId: string;
  rakebackPct: string; // solo CLUB
  agentId: string; // solo AGENTE
}

let lineaKeySeq = 1;
function nuevaLinea(): LineaState {
  return { key: lineaKeySeq++, tipo: "CLUB", clubId: "", rakebackPct: "75", agentId: "" };
}

function LineaClubEditor({
  linea,
  clubes,
  weekStart,
  onChange,
  onRemove,
  soloUna,
}: {
  linea: LineaState;
  clubes: any[];
  weekStart: string;
  onChange: (l: LineaState) => void;
  onRemove: () => void;
  soloUna: boolean;
}) {
  const [resumen, setResumen] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    setResumen(null);
    if (linea.tipo !== "CLUB" || !linea.clubId || !weekStart) return;
    setCargando(true);
    api
      .resumenClub(linea.clubId, weekStart)
      .then(setResumen)
      .catch(() => setResumen(null))
      .finally(() => setCargando(false));
  }, [linea.tipo, linea.clubId, weekStart]);

  const pctNum = (Number(linea.rakebackPct) || 0) / 100;
  const resultadoTotal = resumen ? Number(resumen.resultadoTotal) : null;
  const rakeTotal = resumen ? Number(resumen.rakeTotal) : null;
  const montoCrudo = resultadoTotal !== null && rakeTotal !== null ? resultadoTotal + rakeTotal * pctNum : null;
  const sinCierresDelClub = resumen && Number(resumen.agentesConCierre) === 0;

  return (
    <div className="panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: 10 }}>
      <div className="form-grid">
        <div className="field">
          <label>Club</label>
          <select value={linea.clubId} onChange={(e) => onChange({ ...linea, clubId: e.target.value })}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>% rakeback sobre el rake total del club</label>
          <input value={linea.rakebackPct} onChange={(e) => onChange({ ...linea, rakebackPct: e.target.value })} type="number" step="0.01" />
        </div>
      </div>
      {cargando && <div className="muted" style={{ fontSize: 12 }}>Trayendo el resumen del club...</div>}
      {sinCierresDelClub && (
        <div className="error" style={{ fontSize: 12 }}>
          Esta semana no tiene ningún cierre cargado para este club -- cargalo primero en "Cierres semanales".
        </div>
      )}
      {resumen && !sinCierresDelClub && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Resultado: {usd(resultadoTotal ?? 0)} (de {resumen.agentesConCierre} agente{Number(resumen.agentesConCierre) === 1 ? "" : "s"}) · Rake:{" "}
          {usd(rakeTotal ?? 0)} · Cierre bruto = {usd(montoCrudo ?? 0)} · Se guarda invertido:{" "}
          <b>{usd(montoCrudo !== null ? -montoCrudo : 0)}</b>
        </div>
      )}
      {!soloUna && (
        <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={onRemove}>Quitar línea</button>
      )}
    </div>
  );
}

function LineaAgenteEditor({
  linea,
  clubes,
  agentes,
  weekStart,
  onChange,
  onRemove,
  soloUna,
}: {
  linea: LineaState;
  clubes: any[];
  agentes: any[];
  weekStart: string;
  onChange: (l: LineaState) => void;
  onRemove: () => void;
  soloUna: boolean;
}) {
  const [preview, setPreview] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);
  const [noEncontrado, setNoEncontrado] = useState(false);

  useEffect(() => {
    setPreview(null);
    setNoEncontrado(false);
    if (linea.tipo !== "AGENTE" || !linea.clubId || !linea.agentId || !weekStart) return;
    setCargando(true);
    api
      .cierreAgentePreview(linea.agentId, linea.clubId, weekStart)
      .then((r) => {
        if (!r) setNoEncontrado(true);
        setPreview(r);
      })
      .catch(() => setNoEncontrado(true))
      .finally(() => setCargando(false));
  }, [linea.tipo, linea.clubId, linea.agentId, weekStart]);

  return (
    <div className="panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: 10 }}>
      <div className="form-grid">
        <div className="field">
          <label>Club</label>
          <select value={linea.clubId} onChange={(e) => onChange({ ...linea, clubId: e.target.value })}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Agente</label>
          <select value={linea.agentId} onChange={(e) => onChange({ ...linea, agentId: e.target.value })}>
            <option value="">Elegir...</option>
            {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      {cargando && <div className="muted" style={{ fontSize: 12 }}>Buscando el cierre del agente...</div>}
      {noEncontrado && !cargando && linea.clubId && linea.agentId && (
        <div className="error" style={{ fontSize: 12 }}>
          Este agente no tiene un cierre aplicado en ese club para esa semana -- cargalo primero en "Cierres semanales".
        </div>
      )}
      {preview && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Cierre de {preview.agent_name} en {preview.club_name}: <b>{usd(preview.final_closing)}</b> -- se agrega tal cual (sin invertir).
        </div>
      )}
      {!soloUna && (
        <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={onRemove}>Quitar línea</button>
      )}
    </div>
  );
}

function CierreForm({
  proveedores,
  clubes,
  agentes,
  onDone,
}: {
  proveedores: any[];
  clubes: any[];
  agentes: any[];
  onDone: () => void;
}) {
  const [proveedorId, setProveedorId] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [notes, setNotes] = useState("");
  const [lineas, setLineas] = useState<LineaState[]>([nuevaLinea()]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function actualizarLinea(idx: number, l: LineaState) {
    setLineas((prev) => prev.map((x, i) => (i === idx ? l : x)));
  }
  function quitarLinea(idx: number) {
    setLineas((prev) => prev.filter((_, i) => i !== idx));
  }
  function agregarLinea() {
    setLineas((prev) => [...prev, nuevaLinea()]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId) return setMsg({ ok: false, text: "Elegí un proveedor." });
    if (!weekStart) return setMsg({ ok: false, text: "Elegí la semana." });
    for (const l of lineas) {
      if (!l.clubId) return setMsg({ ok: false, text: "Todas las líneas necesitan un club." });
      if (l.tipo === "CLUB" && !(Number(l.rakebackPct) >= 0)) {
        return setMsg({ ok: false, text: "El % de rakeback de cada línea de club tiene que ser un número." });
      }
      if (l.tipo === "AGENTE" && !l.agentId) {
        return setMsg({ ok: false, text: "Todas las líneas de agente necesitan un agente." });
      }
    }
    setLoading(true);
    try {
      await api.aplicarCierreProveedor({
        proveedorId,
        weekStart,
        lineas: lineas.map((l) =>
          l.tipo === "CLUB"
            ? { tipo: "CLUB" as const, clubId: l.clubId, rakebackPct: (Number(l.rakebackPct) || 0) / 100 }
            : { tipo: "AGENTE" as const, clubId: l.clubId, agentId: l.agentId }
        ),
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el cierre." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Semana (lunes de inicio)</label>
          <input value={weekStart} onChange={(e) => setWeekStart(e.target.value)} type="date" />
        </div>
      </div>

      <div style={{ marginTop: 10, marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Líneas del cierre</div>
      {lineas.map((l, idx) => (
        <div key={l.key}>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Tipo de línea</label>
            <select value={l.tipo} onChange={(e) => actualizarLinea(idx, { ...l, tipo: e.target.value as LineaTipo })}>
              <option value="CLUB">Club total (ej. "es la unión")</option>
              <option value="AGENTE">Cierre de un agente puntual</option>
            </select>
          </div>
          {l.tipo === "CLUB" ? (
            <LineaClubEditor
              linea={l}
              clubes={clubes}
              weekStart={weekStart}
              onChange={(nl) => actualizarLinea(idx, nl)}
              onRemove={() => quitarLinea(idx)}
              soloUna={lineas.length === 1}
            />
          ) : (
            <LineaAgenteEditor
              linea={l}
              clubes={clubes}
              agentes={agentes}
              weekStart={weekStart}
              onChange={(nl) => actualizarLinea(idx, nl)}
              onRemove={() => quitarLinea(idx)}
              soloUna={lineas.length === 1}
            />
          )}
        </div>
      ))}
      <button type="button" className="btn secondary small" onClick={agregarLinea} style={{ marginBottom: 10 }}>
        + Agregar línea
      </button>

      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, etc." />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Aplicando..." : "Aplicar cierre"}</button>
    </form>
  );
}

function PagoForm({ proveedores, clubes, onDone }: { proveedores: any[]; clubes: any[]; onDone: () => void }) {
  const [proveedorId, setProveedorId] = useState("");
  const [clubId, setClubId] = useState("");
  const [amount, setAmount] = useState("");
  const [medio, setMedio] = useState<"USDT" | "EFECTIVO" | "ZELLE" | "OTRO">("USDT");
  const [direction, setDirection] = useState<"PAGO" | "COBRO">("PAGO");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId || !clubId) return setMsg({ ok: false, text: "Elegí proveedor y club." });
    if (!(Number(amount) > 0)) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.registrarPagoProveedor({
        proveedorId,
        clubId,
        amount: Number(amount),
        medio,
        direction,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el pago." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="PAGO">Pago (le pagamos)</option>
            <option value="COBRO">Cobro (nos paga)</option>
          </select>
        </div>
        <div className="field">
          <label>Medio</label>
          <select value={medio} onChange={(e) => setMedio(e.target.value as any)}>
            <option value="USDT">USDT</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="ZELLE">Zelle</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
        <div className="field">
          <label>Monto (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
        </div>
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, hash de la transacción, etc." />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar"}</button>
    </form>
  );
}

function GarantiaAjusteForm({
  proveedores,
  garantias,
  preselectProveedorId,
  onDone,
}: {
  proveedores: any[];
  garantias: any[];
  preselectProveedorId?: string;
  onDone: () => void;
}) {
  const [proveedorId, setProveedorId] = useState(preselectProveedorId ?? "");
  const [type, setType] = useState<"ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA">(preselectProveedorId ? "AUMENTO" : "ALTA");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const tieneGarantiaActiva = garantias.some((g) => g.proveedor_id === proveedorId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId) return setMsg({ ok: false, text: "Elegí un proveedor." });
    const monto = Number(amount) || 0;
    if (type !== "BAJA" && monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.ajustarGarantiaProveedor({ proveedorId, type, amount: monto, notes: notes.trim() || undefined });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select
            value={proveedorId}
            onChange={(e) => {
              const nextId = e.target.value;
              setProveedorId(nextId);
              const yaTiene = garantias.some((g) => g.proveedor_id === nextId);
              setType(yaTiene ? "AUMENTO" : "ALTA");
            }}
            disabled={!!preselectProveedorId}
          >
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo de movimiento</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="ALTA" disabled={tieneGarantiaActiva}>Alta (garantía nueva)</option>
            <option value="AUMENTO" disabled={!tieneGarantiaActiva}>Aumento</option>
            <option value="REDUCCION" disabled={!tieneGarantiaActiva}>Reducción</option>
            <option value="CONSUMO" disabled={!tieneGarantiaActiva}>Consumo</option>
            <option value="BAJA" disabled={!tieneGarantiaActiva}>Baja</option>
          </select>
        </div>
        {type !== "BAJA" && (
          <div className="field">
            <label>Monto (USD)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
          </div>
        )}
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo del ajuste, referencia, etc." />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Aplicar"}</button>
    </form>
  );
}
