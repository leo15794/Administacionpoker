import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmProvider";

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
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [cuentas, setCuentas] = useState<any[] | null>(null);
  const [agregados, setAgregados] = useState<any | null>(null);
  const [ajustesHistoricos, setAjustesHistoricos] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [expandida, setExpandida] = useState<string | null>(null);
  const [movimientos, setMovimientos] = useState<Record<string, any[]>>({});
  const [showNuevaCuenta, setShowNuevaCuenta] = useState(false);
  const [showEditarCuenta, setShowEditarCuenta] = useState<any | null>(null);
  const [showNuevoMov, setShowNuevoMov] = useState<string | null>(null);
  const [showEditarMov, setShowEditarMov] = useState<any | null>(null);
  const [showNuevoAjusteHistorico, setShowNuevoAjusteHistorico] = useState(false);
  const [showEditarAjusteHistorico, setShowEditarAjusteHistorico] = useState<any | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.cuentasSocios().then(setCuentas).catch((e) => setError(e.message));
    api.cuentasSociosAgregados().then(setAgregados).catch(() => {});
    api.gananciaHistoricaAjustes().then(setAjustesHistoricos).catch(() => {});
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
    if (!(await confirmDialog(`¿Eliminar la cuenta "${c.name}"? Esto borra también todos sus movimientos (${c.movimientos}) — no se puede deshacer.`))) return;
    setBorrando(c.id);
    try {
      await api.eliminarCuentaSocio(c.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar la cuenta.");
    } finally {
      setBorrando(null);
    }
  }

  async function eliminarMovimiento(m: any) {
    if (!(await confirmDialog(`¿Eliminar este movimiento de ${m.account_name}?\n\n${m.concept} — ${usd(m.amount)}\n\nNo se puede deshacer.`))) return;
    setBorrando(m.id);
    try {
      await api.eliminarMovimientoCuentaSocio(m.id);
      refresh();
      cargarMovimientos(m.account_id);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el movimiento.");
    } finally {
      setBorrando(null);
    }
  }

  async function eliminarAjusteHistorico(a: any) {
    if (!(await confirmDialog(`¿Eliminar el ajuste histórico "${a.concept}" (${usd(a.amount)})? No se puede deshacer.`))) return;
    setBorrando(a.id);
    try {
      await api.eliminarGananciaHistoricaAjuste(a.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el ajuste.");
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
            <div className="muted" style={{ fontSize: 12 }}>
              Ganancia real de todos los cierres (misma cuenta que Resumen ejecutivo/por club/financiero)
              {ajustesHistoricos && ajustesHistoricos.length > 0 ? " + ajuste histórico de abajo" : ""}
            </div>
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
        <div className="topbar" style={{ marginBottom: ajustesHistoricos?.length ? 14 : 0 }}>
          <div>
            <h3 style={{ margin: 0 }}>Ajuste histórico de ganancia operativa</h3>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Para arrancar "Ganancia operativa histórica" desde un total viejo (planilla de antes de usar este
              sistema) sin tocar el cálculo en vivo de los cierres reales. Se suma arriba de ese cálculo — no
              afecta a Resumen ejecutivo, Resumen por club ni Resumen financiero.
            </div>
          </div>
          <button className="btn secondary" onClick={() => setShowNuevoAjusteHistorico(true)}>+ Ajuste histórico</button>
        </div>
        {ajustesHistoricos && ajustesHistoricos.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Concepto</th><th>Fecha</th><th className="num">Monto</th><th></th></tr>
              </thead>
              <tbody>
                {ajustesHistoricos.map((a) => (
                  <tr key={a.id} title={a.notes || undefined}>
                    <td>{a.concept}</td>
                    <td className="muted">{dateShort(a.created_at)}</td>
                    <td className={`num ${Number(a.amount) >= 0 ? "pos" : "neg"}`}>{usd(a.amount)}</td>
                    <td className="row-actions">
                      <button className="btn secondary small" onClick={() => setShowEditarAjusteHistorico(a)}>Editar</button>
                      <button
                        className="btn secondary small"
                        disabled={borrando === a.id}
                        onClick={() => eliminarAjusteHistorico(a)}
                        style={{ color: "var(--red)" }}
                      >
                        {borrando === a.id ? "..." : "Eliminar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Cuentas</h3>
        {cuentas.length === 0 ? (
          <div className="muted">Todavía no hay ninguna cuenta cargada — creá una con "+ Nueva cuenta" (ej. "Uriel", "Juan").</div>
        ) : (
          <div className="cuentas-grid">
            {cuentas.map((c) => (
              <div className="cuenta-card" key={c.id}>
                <div className="cuenta-card-header">
                  <div className="cuenta-card-name">{c.name}</div>
                  <div className={`cuenta-card-saldo ${Number(c.saldo) >= 0 ? "pos" : "neg"}`}>{usd(c.saldo)}</div>
                </div>
                {c.description && (
                  <div className="cuenta-card-desc" title={c.description}>{c.description}</div>
                )}
                <div className="cuenta-card-meta">{c.movimientos} movimiento{c.movimientos === 1 ? "" : "s"}</div>
                <div className="row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
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
                    style={{ color: "var(--red)" }}
                  >
                    {borrando === c.id ? "..." : "Eliminar"}
                  </button>
                </div>
                {expandida === c.id && (
                  <div className="cuenta-card-expand">
                    {!movimientos[c.id] ? (
                      <div className="muted">Cargando...</div>
                    ) : movimientos[c.id].length === 0 ? (
                      <div className="muted">Sin movimientos todavía.</div>
                    ) : (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th className="num">Monto</th><th>Notas</th><th></th></tr>
                          </thead>
                          <tbody>
                            {movimientos[c.id].map((m) => (
                              <tr key={m.id}>
                                <td>{dateShort(m.entry_date)}</td>
                                <td><span className="badge neutral">{CATEGORY_LABEL[m.category] ?? m.category}</span></td>
                                <td>
                                  {m.concept}
                                  {m.idempotency_key && (
                                    <span className="badge neutral" style={{ marginLeft: 6, fontSize: 10 }} title="Generado automáticamente por un cierre semanal — para corregirlo, corregí o revertí el cierre de origen, no este movimiento.">
                                      Auto
                                    </span>
                                  )}
                                </td>
                                <td className={`num ${Number(m.amount) >= 0 ? "pos" : "neg"}`}>{usd(m.amount)}</td>
                                <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                                <td className="row-actions">
                                  <button className="btn secondary small" onClick={() => setShowEditarMov(m)}>Editar</button>
                                  <button
                                    className="btn secondary small"
                                    disabled={borrando === m.id}
                                    onClick={() => eliminarMovimiento(m)}
                                    style={{ color: "var(--red)" }}
                                  >
                                    {borrando === m.id ? "..." : "Eliminar"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
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

      {showNuevoAjusteHistorico && (
        <Modal title="Ajuste histórico de ganancia operativa" onClose={() => setShowNuevoAjusteHistorico(false)}>
          <GananciaHistoricaForm
            onDone={() => {
              setShowNuevoAjusteHistorico(false);
              refresh();
            }}
          />
        </Modal>
      )}

      {showEditarAjusteHistorico && (
        <Modal title="Editar ajuste histórico" onClose={() => setShowEditarAjusteHistorico(null)}>
          <GananciaHistoricaForm
            ajuste={showEditarAjusteHistorico}
            onDone={() => {
              setShowEditarAjusteHistorico(null);
              refresh();
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

function GananciaHistoricaForm({ ajuste, onDone }: { ajuste?: any; onDone: () => void }) {
  const [amount, setAmount] = useState(ajuste ? String(ajuste.amount) : "");
  const [concept, setConcept] = useState(ajuste?.concept ?? "");
  const [notes, setNotes] = useState(ajuste?.notes ?? "");
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
      if (ajuste) {
        await api.editarGananciaHistoricaAjuste(ajuste.id, { amount: monto, concept: concept.trim(), notes: notes.trim() });
      } else {
        await api.crearGananciaHistoricaAjuste({ amount: monto, concept: concept.trim(), notes: notes.trim() || undefined });
      }
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Esto se suma (o resta, si cargás un monto negativo) directo a "Ganancia operativa histórica" en Cuentas de
        socios — no toca el cálculo de Resumen ejecutivo, Resumen por club ni Resumen financiero, que siguen siendo
        100% los cierres reales cargados en el sistema.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Monto (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Concepto</label>
        <input
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          placeholder="Ej: Ganancia histórica de la planilla vieja (previo a cargar cierres acá)"
        />
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : ajuste ? "Guardar" : "Agregar ajuste"}</button>
    </form>
  );
}
