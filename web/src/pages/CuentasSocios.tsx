import { useEffect, useState, Fragment } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";

const CATEGORY_LABEL: Record<string, string> = {
  COMPENSACION: "Compensación",
  COMISION: "Comisión",
  PAGO: "Pago",
  RETIRO: "Retiro",
  GASTO: "Gasto operativo",
  AJUSTE: "Ingreso/ajuste",
  OTRO: "Otro",
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[];

// Cuentas de socios — equivalente a "Cuentas y memorias" de la planilla (Saldo Uriel,
// Compensación Juan, etc.): plata de los SOCIOS de la empresa, sin relación con agentes ni
// clubes (para eso está el resto del sistema). A pedido explícito del usuario, acá se puede
// editar y eliminar todo directo — sin la ceremonia de revertir/corregir del resto de la app.
// Cada cuenta es un nombre con saldo = suma de sus movimientos (monto libre, +/-). Los
// agregados de abajo (Ganancia neta histórica, etc.) toman "Ganancia operativa" en vivo de
// nuestros propios cierres, y retiros/gastos/ajustes de los movimientos cargados acá con esa
// categoría, sin importar a qué cuenta pertenezcan.
export default function CuentasSocios() {
  const [cuentas, setCuentas] = useState<any[] | null>(null);
  const [agregados, setAgregados] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [expandida, setExpandida] = useState<string | null>(null);
  const [movimientos, setMovimientos] = useState<Record<string, any[]>>({});
  const [showNuevaCuenta, setShowNuevaCuenta] = useState(false);
  const [showEditarCuenta, setShowEditarCuenta] = useState<any | null>(null);
  const [showNuevoMov, setShowNuevoMov] = useState<string | null>(null);
  const [showEditarMov, setShowEditarMov] = useState<any | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.cuentasSocios().then(setCuentas).catch((e) => setError(e.message));
    api.cuentasSociosAgregados().then(setAgregados).catch(() => {});
  }

  function cargarMovimientos(accountId: string) {
    api.movimientosCuentasSocios(accountId).then((rows) => setMovimientos((m) => ({ ...m, [accountId]: rows })));
  }

  function toggleExpandir(accountId: string) {
    if (expandida === accountId) {
      setExpandida(null);
      return;
    }
    setExpandida(accountId);
    if (!movimientos[accountId]) cargarMovimientos(accountId);
  }

  async function eliminarCuenta(c: any) {
    if (!confirm(`¿Eliminar la cuenta "${c.name}"? Esto borra también todos sus movimientos (${c.movimientos}) — no se puede deshacer.`)) return;
    setBorrando(c.id);
    try {
      await api.eliminarCuentaSocio(c.id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar la cuenta.");
    } finally {
      setBorrando(null);
    }
  }

  async function eliminarMovimiento(m: any) {
    if (!confirm(`¿Eliminar este movimiento de ${m.account_name}?\n\n${m.concept} — ${usd(m.amount)}\n\nNo se puede deshacer.`)) return;
    setBorrando(m.id);
    try {
      await api.eliminarMovimientoCuentaSocio(m.id);
      refresh();
      cargarMovimientos(m.account_id);
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar el movimiento.");
    } finally {
      setBorrando(null);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Cuentas de socios: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!cuentas) return <div className="muted">Cargando...</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cuentas de socios</h2>
          <div className="muted">
            Plata de los socios (compensaciones, comisiones por referido, retiros, gastos) — separado del saldo de agentes y de Tesorería.
            Acá se puede editar y eliminar todo directamente, sin pasar por revertir/corregir.
          </div>
        </div>
        <button className="btn" onClick={() => setShowNuevaCuenta(true)}>+ Nueva cuenta</button>
      </div>

      {agregados && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="label">Ganancia operativa histórica</div>
            <div className="value">{usd(agregados.gananciaOperativaHistorica)}</div>
            <div className="muted" style={{ fontSize: 12 }}>Suma de rake − rakeback − rebate de todos los cierres reales</div>
          </div>
          <div className="kpi-card">
            <div className="label">Retiros de socios</div>
            <div className="value">{usd(agregados.retirosSocios)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Gastos operativos</div>
            <div className="value">{usd(agregados.gastosOperativos)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Ingresos/ajustes</div>
            <div className="value">{usd(agregados.ingresosAjustes)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Ganancia neta histórica</div>
            <div className="value">{usd(agregados.gananciaNetaHistorica)}</div>
          </div>
          <div className="kpi-card">
            <div className="label">Saldo después de retiros</div>
            <div className="value">{usd(agregados.saldoDespuesRetiros)}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <h3>Cuentas</h3>
        {cuentas.length === 0 ? (
          <div className="muted">Todavía no hay ninguna cuenta cargada — creá una con "+ Nueva cuenta" (ej. "Uriel", "Juan").</div>
        ) : (
          <table>
            <thead>
              <tr><th>Cuenta</th><th>Descripción</th><th>Saldo</th><th>Movimientos</th><th></th></tr>
            </thead>
            <tbody>
              {cuentas.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td><strong>{c.name}</strong></td>
                    <td className="muted" style={{ fontSize: 12 }} title={c.description || undefined}>{c.description || "—"}</td>
                    <td><span className={`badge ${Number(c.saldo) >= 0 ? "pos" : "neg"}`}>{usd(c.saldo)}</span></td>
                    <td>{c.movimientos}</td>
                    <td className="row-actions">
                      <button className="btn secondary small" onClick={() => toggleExpandir(c.id)}>
                        {expandida === c.id ? "Ocultar" : "Ver movimientos"}
                      </button>
                      <button className="btn secondary small" onClick={() => setShowNuevoMov(c.id)}>
                        + Movimiento
                      </button>
                      <button className="btn secondary small" onClick={() => setShowEditarCuenta(c)}>
                        Editar
                      </button>
                      <button
                        className="btn secondary small"
                        disabled={borrando === c.id}
                        onClick={() => eliminarCuenta(c)}
                        title="Borrado real — la cuenta y todos sus movimientos."
                        style={{ color: "var(--danger, #e5484d)" }}
                      >
                        {borrando === c.id ? "..." : "Eliminar"}
                      </button>
                    </td>
                  </tr>
                  {expandida === c.id && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--panel-soft, rgba(255,255,255,0.03))" }}>
                        {!movimientos[c.id] ? (
                          <div className="muted">Cargando...</div>
                        ) : movimientos[c.id].length === 0 ? (
                          <div className="muted">Sin movimientos todavía.</div>
                        ) : (
                          <table>
                            <thead>
                              <tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Monto</th><th>Notas</th><th></th></tr>
                            </thead>
                            <tbody>
                              {movimientos[c.id].map((m) => (
                                <tr key={m.id}>
                                  <td>{dateShort(m.entry_date)}</td>
                                  <td><span className="badge neutral">{CATEGORY_LABEL[m.category] ?? m.category}</span></td>
                                  <td>{m.concept}</td>
                                  <td className={Number(m.amount) >= 0 ? "pos" : "neg"}>{usd(m.amount)}</td>
                                  <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                                  <td className="row-actions">
                                    <button className="btn secondary small" onClick={() => setShowEditarMov(m)}>Editar</button>
                                    <button
                                      className="btn secondary small"
                                      disabled={borrando === m.id}
                                      onClick={() => eliminarMovimiento(m)}
                                      style={{ color: "var(--danger, #e5484d)" }}
                                    >
                                      {borrando === m.id ? "..." : "Eliminar"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNuevaCuenta && (
        <Modal title="Nueva cuenta" onClose={() => setShowNuevaCuenta(false)}>
          <CuentaForm
            onDone={() => {
              setShowNuevaCuenta(false);
              refresh();
            }}
          />
        </Modal>
      )}

      {showEditarCuenta && (
        <Modal title={`Editar cuenta — ${showEditarCuenta.name}`} onClose={() => setShowEditarCuenta(null)}>
          <CuentaForm
            cuenta={showEditarCuenta}
            onDone={() => {
              setShowEditarCuenta(null);
              refresh();
            }}
          />
        </Modal>
      )}

      {showNuevoMov && (
        <Modal title="Nuevo movimiento" onClose={() => setShowNuevoMov(null)}>
          <MovimientoForm
            accountId={showNuevoMov}
            onDone={() => {
              setShowNuevoMov(null);
              refresh();
              cargarMovimientos(showNuevoMov);
              setExpandida(showNuevoMov);
            }}
          />
        </Modal>
      )}

      {showEditarMov && (
        <Modal title="Editar movimiento" onClose={() => setShowEditarMov(null)}>
          <MovimientoForm
            accountId={showEditarMov.account_id}
            movimiento={showEditarMov}
            onDone={() => {
              const accountId = showEditarMov.account_id;
              setShowEditarMov(null);
              refresh();
              cargarMovimientos(accountId);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function CuentaForm({ cuenta, onDone }: { cuenta?: any; onDone: () => void }) {
  const [name, setName] = useState(cuenta?.name ?? "");
  const [description, setDescription] = useState(cuenta?.description ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    setLoading(true);
    try {
      if (cuenta) await api.editarCuentaSocio(cuenta.id, { name: name.trim(), description: description.trim() });
      else await api.crearCuentaSocio({ name: name.trim(), description: description.trim() || undefined });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar la cuenta." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Uriel, Juan, Fede" />
      </div>
      <div className="field">
        <label>Descripción (opcional)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: Comisión por referido Demiurge (10% de su rake)" />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : cuenta ? "Guardar" : "Crear cuenta"}</button>
    </form>
  );
}

function MovimientoForm({ accountId, movimiento, onDone }: { accountId: string; movimiento?: any; onDone: () => void }) {
  const [category, setCategory] = useState<string>(movimiento?.category ?? "AJUSTE");
  const [concept, setConcept] = useState(movimiento?.concept ?? "");
  const [amount, setAmount] = useState(movimiento ? String(movimiento.amount) : "");
  const [entryDate, setEntryDate] = useState(movimiento?.entry_date ? String(movimiento.entry_date).slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(movimiento?.notes ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!concept.trim()) return setMsg({ ok: false, text: "El concepto es obligatorio." });
    const monto = Number(amount);
    if (!monto) return setMsg({ ok: false, text: "El monto no puede ser 0." });
    setLoading(true);
    try {
      if (movimiento) {
        await api.editarMovimientoCuentaSocio(movimiento.id, {
          category: category as any,
          concept: concept.trim(),
          amount: monto,
          entryDate,
          notes: notes.trim(),
        });
      } else {
        await api.crearMovimientoCuentaSocio({
          accountId,
          category: category as any,
          concept: concept.trim(),
          amount: monto,
          entryDate,
          notes: notes.trim() || undefined,
        });
      }
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el movimiento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        El monto es libre (positivo o negativo) — vos decidís el signo. Para que "Retiros de socios" y "Gastos operativos" salgan bien en los totales,
        cargalos como monto positivo (la cantidad que salió) con esa categoría.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Categoría</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Fecha</label>
          <input value={entryDate} onChange={(e) => setEntryDate(e.target.value)} type="date" />
        </div>
        <div className="field">
          <label>Monto (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Concepto</label>
        <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej: Retiro de Fede, Sueldo Manos julio, Comisión semanal" />
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : movimiento ? "Guardar" : "Agregar movimiento"}</button>
    </form>
  );
}
