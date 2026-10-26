import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmProvider";
import Loading from "../components/Loading";
import Ayuda from "../components/Ayuda";
import ActionsMenu from "../components/ActionsMenu";
import { usePaginado, WmPaginacion, WmTabs, WmSaldoCard, WmConteos, type WmTab } from "../components/ListaWm";

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
  // Lista con el estilo de la Wallet (23/10/2026, pedido de Leo, mockup aprobado): pestañas, buscador, orden y paginación.
  const [tipoCuenta, setTipoCuenta] = useState<"todas" | "personal" | "operativa">("todas");
  const [buscaCuenta, setBuscaCuenta] = useState("");
  const [ordenCuenta, setOrdenCuenta] = useState<"saldo" | "nombre">("saldo");
  const qc = buscaCuenta.trim().toLowerCase();
  const cuentasVisibles = (cuentas ?? [])
    .filter((c) => (tipoCuenta === "todas" || (tipoCuenta === "operativa") === (c.kind === "OPERATIVA")) && (qc === "" || `${c.name} ${c.description ?? ""}`.toLowerCase().includes(qc)))
    .sort((a, b) => (ordenCuenta === "nombre" ? String(a.name).localeCompare(String(b.name)) : Math.abs(Number(b.saldo)) - Math.abs(Number(a.saldo)) || String(a.name).localeCompare(String(b.name))));
  const pgCuentas = usePaginado(cuentasVisibles, "dp_socios_tamano", [tipoCuenta, buscaCuenta, ordenCuenta]);

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
  if (!cuentas) return <Loading />;

  const cuentaMovimientos = showMovimientosDe ? cuentas.find((c) => c.id === showMovimientosDe) ?? null : null;
  const personales = cuentas.filter((c) => c.kind !== "OPERATIVA");

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cuentas de socios <Ayuda>Plata de los socios (compensaciones, comisiones por referido, retiros, gastos) — separado del saldo de agentes y de Wallet.
            Acá se puede editar y eliminar todo directamente, sin pasar por revertir/corregir.</Ayuda></h2>
        </div>
        <button className="btn" onClick={() => setShowNuevaCuenta(true)}>+ Nueva cuenta</button>
      </div>

      <div className="wm">
        <WmSaldoCard
          etiqueta="LE DEBEN A LA EMPRESA · SOCIOS"
          monto={usd(personales.reduce((a, c) => a + Math.max(Number(c.saldo), 0), 0))}
          signo={personales.some((c) => Number(c.saldo) > 0) ? "neg" : ""}
          sub={`suma de ${personales.filter((c) => Number(c.saldo) > 0).length} cuenta${personales.filter((c) => Number(c.saldo) > 0).length === 1 ? "" : "s"} personal${personales.filter((c) => Number(c.saldo) > 0).length === 1 ? "" : "es"} con deuda`}
        >
          {agregados && (
            <WmConteos
              items={[
                { etiqueta: "GANANCIA OPERATIVA HISTÓRICA", valor: usd(agregados.gananciaOperativaHistorica) },
                { etiqueta: "RETIROS DE SOCIOS", valor: usd(agregados.retirosSocios) },
                { etiqueta: "GASTOS OPERATIVOS", valor: usd(agregados.gastosOperativos) },
                { etiqueta: "INGRESOS / AJUSTES", valor: usd(agregados.ingresosAjustes) },
                { etiqueta: "GANANCIA NETA HISTÓRICA", valor: usd(agregados.gananciaNetaHistorica) },
                { etiqueta: "SALDO DESPUÉS DE RETIROS", valor: usd(agregados.saldoDespuesRetiros) },
              ]}
            />
          )}
        </WmSaldoCard>

        <div className="wm-card">
          <div className="wm-cab">
            <div className="wm-h">
              Cuentas <span className="wm-n">{cuentasVisibles.length}</span>
            </div>
            <div className="wm-fil">
              <input className="wm-in" placeholder="Buscar cuenta..." value={buscaCuenta} onChange={(e) => setBuscaCuenta(e.target.value)} />
              <select className="wm-in" value={ordenCuenta} onChange={(e) => setOrdenCuenta(e.target.value as "saldo" | "nombre")} aria-label="Orden">
                <option value="saldo">Orden: mayor saldo</option>
                <option value="nombre">Orden: nombre</option>
              </select>
            </div>
          </div>
          <WmTabs
            actual={tipoCuenta}
            onChange={setTipoCuenta}
            tabs={
              [
                { k: "todas", t: "Todas", n: cuentas.length },
                { k: "personal", t: "Personales", n: personales.length },
                { k: "operativa", t: "Operativas", n: cuentas.length - personales.length },
              ] as WmTab<"todas" | "personal" | "operativa">[]
            }
          />
          {cuentas.length === 0 ? (
            <div className="muted" style={{ padding: "12px 0" }}>Todavía no hay ninguna cuenta cargada — creá una con "+ Nueva cuenta" (ej. "Uriel", "Juan").</div>
          ) : (
            <>
              <div className="cs-th">
                <span>CUENTA</span><span>DETALLE</span><span>MOVIMIENTOS</span><span>SALDO</span><span />
              </div>
              {pgCuentas.recorte.map((c) => {
                const operativa = c.kind === "OPERATIVA";
                const saldo = Number(c.saldo);
                return (
                  <div className="cs-fila" key={c.id}>
                    <div className="wm-who">
                      <span className={`wm-av ${!operativa && saldo > 0 ? "n" : ""}`}>{String(c.name).trim().slice(0, 2).toUpperCase()}</span>
                      <div>
                        <div className="saldo-name">{c.name}</div>
                        <div className="saldo-sub" title={operativa ? "Cuenta operativa: solo un total acumulado, no es una deuda de ni hacia nadie." : undefined}>{operativa ? "Operativa" : "Personal"}</div>
                      </div>
                    </div>
                    <span className="ds" title={c.description || undefined}>{c.description || "—"}</span>
                    <span className="ds">{c.movimientos} movimiento{c.movimientos === 1 ? "" : "s"}</span>
                    <span className={`t ${operativa ? "" : claseDebeFavor(c.saldo) === "neg" ? "r" : "p"}`}>
                      {usd(c.saldo)}
                      <small>{operativa ? "total acumulado" : labelDebeFavor(c.saldo)}</small>
                    </span>
                    <div className="acc">
                      <button className="btn secondary small" onClick={() => abrirMovimientos(c.id)}>Ver movimientos</button>
                      <ActionsMenu
                        items={[
                          { label: "+ Movimiento", onClick: () => setShowNuevoMov(c.id) },
                          { label: "Editar", onClick: () => setShowEditarCuenta(c) },
                          { label: borrando === c.id ? "Eliminando..." : "Eliminar (borra la cuenta y sus movimientos)", onClick: () => eliminarCuenta(c), danger: true, disabled: borrando === c.id },
                        ]}
                      />
                    </div>
                  </div>
                );
              })}
              {cuentasVisibles.length === 0 && <div className="muted" style={{ padding: "16px 8px" }}>Ninguna cuenta coincide con la búsqueda.</div>}
              <div className="wm-pie">
                <div className="wm-tot">
                  <span>Le deben a la empresa <b className="out">{usd(cuentasVisibles.filter((c) => c.kind !== "OPERATIVA").reduce((a, c) => a + Math.max(Number(c.saldo), 0), 0))}</b></span>
                  <small>{cuentasVisibles.length} cuenta{cuentasVisibles.length === 1 ? "" : "s"}</small>
                </div>
              </div>
              <WmPaginacion p={pgCuentas} unidad="cuentas" />
            </>
          )}
        </div>

        <div className="wm-card">
          <div className="wm-cab">
            <div className="wm-h">
              Ajuste histórico de ganancia operativa{" "}
              <Ayuda>Para arrancar "Ganancia operativa histórica" desde un total viejo (planilla de antes de usar este
                sistema) sin tocar el cálculo en vivo de los cierres reales. Se suma arriba de ese cálculo — no
                afecta a Resumen ejecutivo, Resumen por club ni Resumen financiero.</Ayuda>
            </div>
            <div className="wm-fil">
              <button type="button" className="wm-in wm-btn" onClick={() => setShowNuevoAjusteHistorico(true)}>+ Ajuste histórico</button>
            </div>
          </div>
          {ajustesHistoricos && ajustesHistoricos.length > 0 ? (
            <>
              <div className="cs-th aj">
                <span>CONCEPTO</span><span>FECHA</span><span>MONTO</span><span />
              </div>
              {ajustesHistoricos.map((a) => (
                <div className="cs-fila aj" key={a.id} title={a.notes || undefined}>
                  <div className="wm-who">
                    <span className="wm-av">{String(a.concept).trim().slice(0, 2).toUpperCase()}</span>
                    <div><div className="saldo-name">{a.concept}</div></div>
                  </div>
                  <span className="ds">{dateShort(a.created_at)}</span>
                  <span className={`t ${Number(a.amount) >= 0 ? "p" : "r"}`}>{usd(a.amount)}</span>
                  <div className="acc">
                    <ActionsMenu
                      items={[
                        { label: "Editar", onClick: () => setShowEditarAjusteHistorico(a) },
                        { label: borrando === a.id ? "Eliminando..." : "Eliminar", onClick: () => eliminarAjusteHistorico(a), danger: true, disabled: borrando === a.id },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="muted">Todavía no hay ajustes históricos.</div>
          )}
        </div>
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
            <Loading />
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
                      {m.treasury_adjustment_id && (
                        <span className="badge neutral" title="Este movimiento generó un ingreso/egreso real en Wallet.">
                          Wallet
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
  const [moveWallet, setMoveWallet] = useState(!!movimiento?.treasury_adjustment_id);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const montoPreview = Number(amount);
  const yaEstabaVinculado = !!movimiento?.treasury_adjustment_id;

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
          moveWallet,
        });
      } else {
        await api.crearMovimientoCuentaSocio({
          accountId,
          category: category as any,
          concept: concept.trim(),
          amount: monto,
          entryDate,
          notes: notes.trim() || undefined,
          moveWallet,
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
      <div className="field">
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
          <input type="checkbox" checked={moveWallet} onChange={(e) => setMoveWallet(e.target.checked)} style={{ width: "auto" }} />
          Esto también mueve la Wallet (USDT real)
        </label>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {moveWallet ? (
            montoPreview ? (
              <>
                Al guardar se va a registrar en Wallet un{" "}
                <strong>{montoPreview > 0 ? "EGRESO" : "INGRESO"}</strong> real de {usd(Math.abs(montoPreview))}.
                {yaEstabaVinculado && " Si cambiás el monto, se corrige también el movimiento de Wallet (se revierte el viejo y se crea uno nuevo)."}
              </>
            ) : (
              "Al guardar se va a registrar un movimiento real en Wallet por el monto de arriba."
            )
          ) : yaEstabaVinculado ? (
            "Este movimiento tiene un ingreso/egreso real en Wallet vinculado — si destildás esto, se revierte."
          ) : (
            'Tildalo solo si esta plata de verdad entró o salió de la Wallet (no todo lo que cargás acá lo hace).'
          )}
        </div>
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
