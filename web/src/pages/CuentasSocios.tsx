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

// Convención de signo de esta pantalla (partner_account_entries.amount, ver
// aplicarCierreCompensacionPersonaTx en repo/closings.ts): POSITIVO = el socio le debe a la
// empresa, NEGATIVO = a favor del socio (la empresa le debe a él). Es la convención INVERSA a
// balances.amount del resto de la app. Para que el color no confunda (verde = bueno/a favor,
// rojo = debe), acá pintamos en rojo lo positivo (debe) y en verde lo negativo (a favor).
function claseDebeFavor(amount: number): "pos" | "neg" {
  return Number(amount) >= 0 ? "neg" : "pos";
}

function labelDebeFavor(amount: number): string {
  const n = Number(amount);
  if (n === 0) return "sin saldo pendiente";
  return n > 0 ? "le debe a la empresa" : "a favor del socio";
}

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
  const [showMovimientosDe, setShowMovimientosDe] = useState<string | null>(null);
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

  function abrirMovimientos(accountId: string) {
    setShowMovimientosDe(accountId);
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

  const cuentaMovimientos = showMovimientosDe ? cuentas.find((c) => c.id === showMovimientosDe) ?? null : null;

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
                  <div className="cuenta-card-name">
                    {c.name}
                    {c.kind === "OPERATIVA" && (
                      <span className="badge neutral" style={{ marginLeft: 6, fontSize: 10 }} title="Cuenta operativa: solo un total acumulado, no es una deuda de ni hacia nadie.">
                        Operativa
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {c.kind === "OPERATIVA" ? (
                      <>
                        <div className="cuenta-card-saldo">{usd(c.saldo)}</div>
                        <div className="muted" style={{ fontSize: 11 }}>total acumulado</div>
                      </>
                    ) : (
                      <>
                        <div className={`cuenta-card-saldo ${claseDebeFavor(c.saldo)}`}>{usd(c.saldo)}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{labelDebeFavor(c.saldo)}</div>
                      </>
                    )}
                  </div>
                </div>
                {c.description && (
                  <div className="cuenta-card-desc" title={c.description}>{c.description}</div>
                )}
                <div className="cuenta-card-meta">{c.movimientos} movimiento{c.movimientos === 1 ? "" : "s"}</div>
                <div className="row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                  <button className="btn secondary small" onClick={() => abrirMovimientos(c.id)}>
                    Ver movimientos
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
              const accountId = showNuevoMov;
              setShowNuevoMov(null);
              refresh();
              cargarMovimientos(accountId);
              setShowMovimientosDe(accountId);
            }}
          />
        </Modal>
      )}

      {cuentaMovimientos && (
        <Modal title={`Movimientos — ${cuentaMovimientos.name}`} onClose={() => setShowMovimientosDe(null)} wide>
          <div className="topbar" style={{ marginBottom: 14, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13 }} className="muted">
                {cuentaMovimientos.kind === "OPERATIVA" ? "Total acumulado" : labelDebeFavor(cuentaMovimientos.saldo)}
              </div>
              <div
                className={`cuenta-card-saldo ${cuentaMovimientos.kind === "OPERATIVA" ? "" : claseDebeFavor(cuentaMovimientos.saldo)}`}
                style={{ fontSize: 26 }}
              >
                {usd(cuentaMovimientos.saldo)}
              </div>
            </div>
            <button className="btn secondary small" onClick={() => setShowNuevoMov(cuentaMovimientos.id)}>+ Movimiento</button>
          </div>

          {!movimientos[cuentaMovimientos.id] ? (
            <div className="muted">Cargando...</div>
          ) : movimientos[cuentaMovimientos.id].length === 0 ? (
            <div className="muted">Sin movimientos todavía.</div>
          ) : (
            <div className="movimientos-list">
              {movimientos[cuentaMovimientos.id].map((m) => (
                <div className="movimiento-row" key={m.id}>
                  <div className="movimiento-row-main">
                    <div className="movimiento-row-top">
                      <span className="badge neutral">{CATEGORY_LABEL[m.category] ?? m.category}</span>
                      {m.idempotency_key && (
                        <span
                          className="badge neutral"
                          title="Generado automáticamente por un cierre semanal — para corregirlo, corregí o revertí el cierre de origen, no este movimiento."
                        >
                          Auto
                        </span>
                      )}
                      <span className="muted" style={{ fontSize: 12 }}>{dateShort(m.entry_date)}</span>
                    </div>
                    <div className="movimiento-row-concept">{m.concept}</div>
                    {m.notes && <div className="muted movimiento-row-notes" title={m.notes}>{m.notes}</div>}
                  </div>
                  <div className="movimiento-row-side">
                    <div className={`movimiento-row-amount ${cuentaMovimientos.kind === "OPERATIVA" ? "" : claseDebeFavor(m.amount)}`}>
                      {usd(m.amount)}
                    </div>
                    <div className="row-actions">
                      <button className="btn secondary small" onClick={() => setShowEditarMov(m)}>Editar</button>
                      <button
                        className="btn secondary small"
                        disabled={borrando === m.id}
                        onClick={() => eliminarMovimiento(m)}
                        style={{ color: "var(--red)" }}
                      >
                        {borrando === m.id ? "..." : "Eliminar"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
  const [kind, setKind] = useState<"SOCIO" | "OPERATIVA">(cuenta?.kind === "OPERATIVA" ? "OPERATIVA" : "SOCIO");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    setLoading(true);
    try {
      if (cuenta) await api.editarCuentaSocio(cuenta.id, { name: name.trim(), description: description.trim(), kind });
      else await api.crearCuentaSocio({ name: name.trim(), description: description.trim() || undefined, kind });
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
      <div className="field">
        <label>Tipo de cuenta</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as "SOCIO" | "OPERATIVA")}>
          <option value="SOCIO">Socio (persona) — el saldo es debe/a favor</option>
          <option value="OPERATIVA">Categoría operativa (gastos, retiros) — solo un total, no es una deuda</option>
        </select>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Usá "Categoría operativa" para cuentas como "Gastos operativo" o "Retiros de socios": ahí no hay una persona
          a la que se le deba o se le deba plata, solo un total acumulado.
        </div>
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
