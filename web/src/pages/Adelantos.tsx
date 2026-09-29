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
// (29/09/2026, pedido de Leo: "la seccion adelantos deberia desaparecer" -- unificado del todo
// adentro de Movimientos.tsx, que ya tenía "Adelanto de rakeback" como tipo de carga. Ya no es
// una pantalla propia -- Movimientos le pasa agentes/clubes (ya los tiene cargados, evita
// duplicar el fetch) y la renderiza como una sección más, debajo del historial de movimientos.
export function AdelantosPanel({ clubes }: { clubes: any[] }) {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [adelantos, setAdelantos] = useState<any[] | null>(null);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");
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
      <h3 style={{ marginTop: 0 }}>Adelantos de rakeback</h3>
      <div className="muted" style={{ marginBottom: 14 }}>
        Por agente (no por club) — un agente sigue generando rake en varios clubes a la vez, el adelanto se compensa contra cualquiera.
        Un mismo agente puede tener varios adelantos activos a la vez (en momentos y clubes distintos): cada uno es independiente.
        Separado del saldo operativo. Cada alta, aumento, reducción, consumo, baja o corrección queda registrado en el historial. Para
        dar de alta uno nuevo, usá "Adelanto de rakeback" en el tipo de movimiento de arriba.
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
              <tr><th>Agente</th><th>Tipo</th><th>Medio</th><th>Club origen</th><th className="num">Adelantado</th><th className="num">Consumido</th><th className="num">Pendiente</th><th>Notas</th><th>Actualizado</th><th></th></tr>
            </thead>
            <tbody>
              {adelantos.map((a) => (
                <tr key={a.id}>
                  <td>{a.agent_name}</td>
                  <td>
                    {/* kind (29/09/2026, pedido de Leo): distingue el adelanto de rakeback de
                        siempre del nuevo "Adelanto de fichas" (fichas que se le cargan pero
                        todavía nos las debe) -- mismo medio=FICHAS en los dos casos, por eso
                        hace falta esta columna aparte para no mezclarlos. */}
                    {a.kind === "FICHAS_PENDIENTE" ? (
                      <span className="badge neg" title="Fichas cargadas de adelanto, pendientes de cobrar -- no es plata que el agente ya ganó.">Fichas pendientes</span>
                    ) : (
                      <span className="badge neutral">Rakeback</span>
                    )}
                  </td>
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
                  <td className="num money">{usd(a.amount)}</td>
                  <td className="num money">{usd(a.consumed)}</td>
                  <td className="num"><span className="badge neutral">{usd(Number(a.amount) - Number(a.consumed))}</span></td>
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
                      style={{ color: "var(--red)" }}
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
              <tr><th>Fecha</th><th>Agente</th><th>Tipo</th><th className="num">Monto</th><th className="num">Adelanto resultante</th><th className="num">Consumido resultante</th><th>Notas</th><th></th></tr>
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
                      <td className="num money">{m.type === "BAJA" || m.type === "CORRECCION" ? "—" : usd(m.amount)}</td>
                      <td className="num money">{usd(m.resulting_amount)}</td>
                      <td className="num money">{usd(m.resulting_consumed)}</td>
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

  const esFichasPendiente = adelanto.kind === "FICHAS_PENDIENTE";

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Adelantado {usd(adelanto.amount)} · consumido {usd(adelanto.consumed)} · pendiente {usd(Number(adelanto.amount) - Number(adelanto.consumed))}.
        {adelanto.medio && (
          esFichasPendiente ? (
            <> Fichas pendientes de cobrar — un Aumento va a mover stock de nuevo; Consumo genera un cobro real (así queda asentado el pago); Reducción/Baja no mueven nada, solo corrigen cuánto se le sigue debiendo.</>
          ) : (
            <> Medio: {adelanto.medio === "FICHAS" ? "fichas" : "USDT"} — un Aumento va a mover {adelanto.medio === "FICHAS" ? "stock" : "la wallet"} de nuevo; Reducción/Consumo/Baja no mueven nada, solo corrigen cuánto se le sigue debiendo.</>
          )
        )}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Tipo de movimiento</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="AUMENTO">Aumento</option>
            <option value="REDUCCION">Reducción</option>
            <option value="CONSUMO">{esFichasPendiente ? "Consumo (cobro real -- el agente pagó)" : "Consumo (se compensó contra un cierre real)"}</option>
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
  // (28/09/2026, pedido de Leo: "sacarle esa liquidación y ajustarla después") -- precargada con
  // la nota actual del adelanto (la que se ve en la columna "Notas" de la lista): suele quedar
  // pegada de un cruce viejo (ej. "Liquidación X — cierre Y") aunque ese cruce ya se haya
  // revertido/liberado -- ni "Deshacer cruce" ni revertirTodosLosCruces.ts tocan esta columna,
  // así que si quedó desactualizada hay que poder editarla/borrarla acá a mano.
  const [notasAdelanto, setNotasAdelanto] = useState(adelanto.notes ?? "");
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
        notasAdelanto: notasAdelanto.trim() || null,
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
        <label>Nota del adelanto (lo que se ve en la lista — editable/borrable)</label>
        <input
          value={notasAdelanto}
          onChange={(e) => setNotasAdelanto(e.target.value)}
          placeholder="Ej: vacío, o una referencia propia -- dejalo vacío para sacar una leyenda vieja."
        />
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
