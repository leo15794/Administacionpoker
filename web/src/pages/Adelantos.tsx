import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmProvider";

const TIPO_LABEL: Record<string, string> = {
  ALTA: "Alta",
  AUMENTO: "Aumento",
  REDUCCION: "Reducción",
  CONSUMO: "Consumo",
  BAJA: "Baja",
  CORRECCION: "Corrección",
};

// Adelantos de rakeback: plata (fichas o USDT) adelantada a un agente A CUENTA de un rakeback
// que todavía no se generó — separado del saldo operativo, igual que Garantías (BIT-034). Es
// por AGENTE, no por agente+club (corregido 11/09/2026: un agente sigue generando rake en
// varios clubes a la vez, el adelanto se compensa contra el rakeback que sea, sin importar de
// qué club salga). CADA ADELANTO ES INDEPENDIENTE (corregido 12/09/2026, segunda vuelta): un
// mismo agente puede tener varios adelantos activos a la vez, dados en momentos distintos y en
// clubes distintos — por eso "Alta" (nuevo adelanto) y "Ajustar" (Aumento/Reducción/Consumo/Baja
// sobre uno que ya existe) son dos acciones separadas. "Club de origen" es puramente informativo
// de en qué club se originó ESE adelanto puntual — nunca limita contra qué club se compensa
// después. Es el concepto "Adelanto de rakeback" que la planilla suma en Agentes nos deben.
export default function Adelantos() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [adelantos, setAdelantos] = useState<any[] | null>(null);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [showAlta, setShowAlta] = useState(false);
  const [showAjuste, setShowAjuste] = useState<any | null>(null);
  const [showCorreccion, setShowCorreccion] = useState<any | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [borrandoMov, setBorrandoMov] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.adelantos().then(setAdelantos).catch((e) => setError(e.message));
    api.adelantosHistorial().then(setHistorial).catch(() => {});
  }

  // Borrado real (no "Baja"): saca el adelanto y todo su historial de movimientos, para cuando
  // nunca debió cargarse (duplicado, agente equivocado, etc.).
  async function eliminarAdelanto(a: any) {
    if (!(await confirmDialog(`¿Eliminar este adelanto de ${a.agent_name}${a.club_origen_name ? ` (${a.club_origen_name})` : ""}? Esto borra también su historial de movimientos — no se puede deshacer.`))) return;
    setBorrando(a.id);
    try {
      await api.eliminarAdelanto(a.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el adelanto.");
    } finally {
      setBorrando(null);
    }
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }, []);

  // Solo se puede borrar el movimiento MÁS RECIENTE de cada adelanto (ver nota del backend) —
  // como el historial ya viene ordenado más nuevo primero, alcanza con marcar la primera
  // aparición de cada advance_id.
  async function eliminarMovimiento(m: any) {
    if (!(await confirmDialog(`¿Eliminar este movimiento (${TIPO_LABEL[m.type] ?? m.type} de ${m.agent_name}, ${usd(m.amount)})? Deja el adelanto como estaba antes de este movimiento. Es para corregir cargas de prueba, no se puede deshacer.`))) return;
    setBorrandoMov(m.id);
    try {
      await api.eliminarMovimientoAdelanto(m.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el movimiento.");
    } finally {
      setBorrandoMov(null);
    }
  }

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Adelantos: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!adelantos) return <div className="muted">Cargando...</div>;

  const totalAdelantado = adelantos.reduce((s, a) => s + Number(a.amount), 0);
  const totalConsumido = adelantos.reduce((s, a) => s + Number(a.consumed), 0);
  const totalPendiente = totalAdelantado - totalConsumido;
  const agentesDistintos = new Set(adelantos.map((a) => a.agent_id)).size;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Adelantos de rakeback</h2>
          <div className="muted">
            Por agente (no por club) — un agente sigue generando rake en varios clubes a la vez, el adelanto se compensa contra cualquiera.
            Un mismo agente puede tener varios adelantos activos a la vez (en momentos y clubes distintos): cada uno es independiente.
            Separado del saldo operativo. Cada alta, aumento, reducción, consumo, baja o corrección queda registrado en el historial.
          </div>
        </div>
        <button className="btn" onClick={() => setShowAlta(true)}>+ Nuevo adelanto</button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Total adelantado</div>
          <div className="value">{usd(totalAdelantado)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Consumido</div>
          <div className="value">{usd(totalConsumido)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Pendiente</div>
          <div className="value">{usd(totalPendiente)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Adelantos activos</div>
          <div className="value">{adelantos.length}</div>
          <div className="muted" style={{ fontSize: 12 }}>{agentesDistintos} agente{agentesDistintos === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Adelantos activos</h3>
        {adelantos.length === 0 ? (
          <div className="muted">Todavía no hay adelantos activos cargados.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Agente</th><th>Medio</th><th>Club origen</th><th>Adelantado</th><th>Consumido</th><th>Pendiente</th><th>Notas</th><th>Actualizado</th><th></th></tr>
            </thead>
            <tbody>
              {adelantos.map((a) => (
                <tr key={a.id}>
                  <td>{a.agent_name}</td>
                  <td>
                    {a.medio === "FICHAS" ? (
                      <span className="badge neutral">Fichas</span>
                    ) : a.medio === "USDT" ? (
                      <span className="badge neutral">USDT</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">{a.club_origen_name || "—"}</td>
                  <td>{usd(a.amount)}</td>
                  <td>{usd(a.consumed)}</td>
                  <td><span className="badge neutral">{usd(Number(a.amount) - Number(a.consumed))}</span></td>
                  <td className="muted" style={{ fontSize: 12 }} title={a.notes || undefined}>{a.notes || "—"}</td>
                  <td className="muted">{dateShort(a.updated_at)}</td>
                  <td className="row-actions">
                    <button className="btn secondary small" onClick={() => setShowAjuste(a)}>
                      Ajustar
                    </button>
                    <button className="btn secondary small" onClick={() => setShowCorreccion(a)} title="Arreglar un error de carga (monto, consumido o club mal tipeados) sin que quede como un movimiento de negocio">
                      Corregir
                    </button>
                    <button
                      className="btn secondary small"
                      disabled={borrando === a.id}
                      onClick={() => eliminarAdelanto(a)}
                      title="Borrado real — no queda en el historial. Para un adelanto que nunca debió cargarse."
                      style={{ color: "var(--danger, #e5484d)" }}
                    >
                      {borrando === a.id ? "..." : "Eliminar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Historial de movimientos</h3>
        {!historial ? (
          <div className="muted">Cargando...</div>
        ) : historial.length === 0 ? (
          <div className="muted">Todavía no hay movimientos de adelantos.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Fecha</th><th>Agente</th><th>Tipo</th><th>Monto</th><th>Adelanto resultante</th><th>Consumido resultante</th><th>Notas</th><th></th></tr>
            </thead>
            <tbody>
              {(() => {
                const vistos = new Set<string>();
                return historial.map((m) => {
                  // El historial viene ordenado más nuevo primero — la primera vez que aparece
                  // un advance_id es su movimiento más reciente, el único borrable individualmente.
                  const esElMasReciente = !vistos.has(m.advance_id);
                  vistos.add(m.advance_id);
                  return (
                    <tr key={m.id}>
                      <td>{dateShort(m.occurred_at)}</td>
                      <td>{m.agent_name}</td>
                      <td><span className="badge neutral">{TIPO_LABEL[m.type] ?? m.type}</span></td>
                      <td>{m.type === "BAJA" || m.type === "CORRECCION" ? "—" : usd(m.amount)}</td>
                      <td>{usd(m.resulting_amount)}</td>
                      <td>{usd(m.resulting_consumed)}</td>
                      <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                      <td>
                        {esElMasReciente && m.type !== "ALTA" && (
                          <button
                            className="btn danger small"
                            disabled={borrandoMov === m.id}
                            onClick={() => eliminarMovimiento(m)}
                            title="Borrar este movimiento puntual (deja el adelanto como estaba antes) — para corregir pruebas"
                          >
                            {borrandoMov === m.id ? "..." : "Eliminar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        )}
      </div>

      {showAlta && (
        <Modal title="Nuevo(s) adelanto(s)" onClose={() => setShowAlta(false)} wide>
          <AltaForm
            agentes={agentes}
            clubes={clubes}
            onDone={() => {
              setShowAlta(false);
              refresh();
            }}
          />
        </Modal>
      )}

      {showAjuste && (
        <Modal title={`Ajustar adelanto — ${showAjuste.agent_name}${showAjuste.club_origen_name ? ` (${showAjuste.club_origen_name})` : ""}`} onClose={() => setShowAjuste(null)}>
          <AjusteForm
            adelanto={showAjuste}
            onDone={() => {
              setShowAjuste(null);
              refresh();
            }}
          />
        </Modal>
      )}

      {showCorreccion && (
        <Modal title={`Corregir adelanto — ${showCorreccion.agent_name}`} onClose={() => setShowCorreccion(null)}>
          <CorreccionForm
            adelanto={showCorreccion}
            clubes={clubes}
            onDone={() => {
              setShowCorreccion(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

// Alta de adelantos NUEVOS e independientes — en lote (22/09/2026, pedido de Leo, "así no
// tenemos que hacerlo de a uno"): una fila por adelanto, cada una con su propio agente,
// importe, medio y club de origen, todas se mandan juntas en un click. No se fija si un agente
// ya tiene otro(s) adelanto(s) activos, ni si aparece repetido en más de una fila -- en la
// práctica puede recibir varios en la misma tanda, en clubes distintos.
type FilaAlta = { id: string; agentId: string; amount: string; medio: "" | "FICHAS" | "USDT"; clubOrigenId: string; notes: string };

function filaAltaVacia(): FilaAlta {
  return { id: Math.random().toString(36).slice(2), agentId: "", amount: "", medio: "", clubOrigenId: "", notes: "" };
}

function AltaForm({ agentes, clubes, onDone }: { agentes: any[]; clubes: any[]; onDone: () => void }) {
  const [filas, setFilas] = useState<FilaAlta[]>([filaAltaVacia()]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function actualizarFila(id: string, patch: Partial<FilaAlta>) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function agregarFila() {
    setFilas((prev) => [...prev, filaAltaVacia()]);
  }
  function quitarFila(id: string) {
    setFilas((prev) => (prev.length > 1 ? prev.filter((f) => f.id !== id) : prev));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    for (const f of filas) {
      if (!f.agentId) return setMsg({ ok: false, text: "Todas las filas necesitan un agente elegido." });
      if (!(Number(f.amount) > 0)) return setMsg({ ok: false, text: "Todos los montos tienen que ser mayores a 0." });
      if (f.medio && !f.clubOrigenId) return setMsg({ ok: false, text: "Un adelanto en fichas o USDT necesita club de origen." });
    }
    setLoading(true);
    let exitos = 0;
    const errores: string[] = [];
    const filasConError: FilaAlta[] = [];
    for (const f of filas) {
      const agente = agentes.find((a) => a.id === f.agentId);
      try {
        await api.altaAdelanto({
          agentId: f.agentId,
          amount: Number(f.amount),
          medio: f.medio || null,
          clubOrigenId: f.clubOrigenId || null,
          notes: f.notes.trim() || undefined,
        });
        exitos++;
      } catch (err: any) {
        errores.push(`${agente?.name ?? f.agentId}: ${err.message || "error"}`);
        filasConError.push(f);
      }
    }
    setLoading(false);
    if (errores.length === 0) {
      onDone();
      return;
    }
    setMsg({
      ok: false,
      text: `${exitos} adelanto${exitos === 1 ? "" : "s"} cargado${exitos === 1 ? "" : "s"}, ${errores.length} con error — ${errores.join(" · ")}`,
    });
    // Deja cargadas solo las filas que fallaron -- las que sí se guardaron no hace falta reintentarlas.
    setFilas(filasConError.length > 0 ? filasConError : [filaAltaVacia()]);
  }

  return (
    <form onSubmit={onSubmit}>
      <table>
        <thead>
          <tr>
            <th>Agente</th>
            <th>Monto (USD)</th>
            <th>Medio</th>
            <th>Club de origen</th>
            <th>Notas</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td>
                <select value={f.agentId} onChange={(e) => actualizarFila(f.id, { agentId: e.target.value })} style={{ minWidth: 140 }}>
                  <option value="">Elegir...</option>
                  {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </td>
              <td>
                <input
                  value={f.amount}
                  onChange={(e) => actualizarFila(f.id, { amount: e.target.value })}
                  type="number"
                  step="0.01"
                  min="0"
                  style={{ width: 100 }}
                />
              </td>
              <td>
                <select value={f.medio} onChange={(e) => actualizarFila(f.id, { medio: e.target.value as any })}>
                  <option value="">Sin especificar</option>
                  <option value="FICHAS">Fichas</option>
                  <option value="USDT">USDT</option>
                </select>
              </td>
              <td>
                <select value={f.clubOrigenId} onChange={(e) => actualizarFila(f.id, { clubOrigenId: e.target.value })} style={{ minWidth: 130 }}>
                  <option value="">Sin especificar</option>
                  {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </td>
              <td>
                <input
                  value={f.notes}
                  onChange={(e) => actualizarFila(f.id, { notes: e.target.value })}
                  placeholder="Motivo, referencia..."
                  style={{ minWidth: 140 }}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn secondary small"
                  disabled={filas.length === 1}
                  onClick={() => quitarFila(f.id)}
                  style={{ color: "var(--danger, #e5484d)" }}
                >
                  Quitar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn secondary small" onClick={agregarFila} style={{ marginTop: 10 }}>
        + Agregar otro adelanto
      </button>
      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        "Fichas" mueve el stock del agente ya mismo, "USDT" sale de la wallet ya mismo -- en los dos casos se
        descuenta después en la liquidación real. "Sin especificar" es el comportamiento viejo, no mueve nada.
      </div>

      {msg && <div className={msg.ok ? "success" : "error"} style={{ marginTop: 10 }}>{msg.text}</div>}
      <button className="btn" disabled={loading} style={{ marginTop: 10 }}>
        {loading ? "Guardando..." : filas.length > 1 ? `Dar de alta (${filas.length})` : "Dar de alta"}
      </button>
    </form>
  );
}

// Aumento/Reducción/Consumo/Baja sobre UN adelanto puntual — ya no hace falta elegir agente,
// viene fijado por la fila desde la que se abrió.
function AjusteForm({ adelanto, onDone }: { adelanto: any; onDone: () => void }) {
  const [type, setType] = useState<"AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA">("AUMENTO");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const monto = Number(amount) || 0;
    if (type !== "BAJA" && monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.ajustarAdelanto({ advanceId: adelanto.id, type, amount: monto, notes: notes.trim() || undefined });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Adelantado {usd(adelanto.amount)} · consumido {usd(adelanto.consumed)} · pendiente {usd(Number(adelanto.amount) - Number(adelanto.consumed))}.
        {adelanto.medio && (
          <> Medio: {adelanto.medio === "FICHAS" ? "fichas" : "USDT"} — un Aumento va a mover {adelanto.medio === "FICHAS" ? "stock" : "la wallet"} de nuevo; Reducción/Consumo/Baja no mueven nada, solo corrigen cuánto se le sigue debiendo.</>
        )}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Tipo de movimiento</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="AUMENTO">Aumento</option>
            <option value="REDUCCION">Reducción</option>
            <option value="CONSUMO">Consumo (se compensó contra un cierre real)</option>
            <option value="BAJA">Baja (se cancela el adelanto)</option>
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

// Corrección de un error de carga (monto, consumido o club de origen mal tipeados). A propósito
// separada de AjusteForm/ajustarAdelanto: acá se pisa el valor directo (no se suma/resta).
// El motivo es opcional — queda igual en el historial (tipo CORRECCION) para no perder
// trazabilidad, pero no se mezcla con los movimientos reales de negocio (AUMENTO, REDUCCION,
// etc.).
function CorreccionForm({ adelanto, clubes, onDone }: { adelanto: any; clubes: any[]; onDone: () => void }) {
  const [amount, setAmount] = useState(String(adelanto.amount));
  const [consumed, setConsumed] = useState(String(adelanto.consumed));
  const [clubOrigenId, setClubOrigenId] = useState(adelanto.club_origen_id ?? "");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const nuevoAmount = Number(amount);
    const nuevoConsumed = Number(consumed);
    if (!(nuevoAmount >= 0) || !(nuevoConsumed >= 0)) return setMsg({ ok: false, text: "Los montos no pueden ser negativos." });
    if (nuevoConsumed > nuevoAmount) return setMsg({ ok: false, text: "El consumido no puede ser mayor al monto total." });
    setLoading(true);
    try {
      await api.corregirAdelanto({
        advanceId: adelanto.id,
        amount: nuevoAmount,
        consumed: nuevoConsumed,
        clubOrigenId: clubOrigenId || null,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo corregir el adelanto." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Esto pisa el monto/consumido/club directamente — usalo solo para arreglar un error de carga, no para un movimiento real (para eso está "Ajustar").
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Monto total (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
        </div>
        <div className="field">
          <label>Consumido (USD)</label>
          <input value={consumed} onChange={(e) => setConsumed(e.target.value)} type="number" step="0.01" min="0" />
        </div>
        <div className="field">
          <label>Club de origen</label>
          <select value={clubOrigenId} onChange={(e) => setClubOrigenId(e.target.value)}>
            <option value="">Sin especificar</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Motivo de la corrección (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: se cargó 2.600 pero era 1.600, error de tipeo." />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Corregir"}</button>
    </form>
  );
}
