import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";

// Cuentas consolidadas para supervisores (30/09/2026, pedido de Leo: "Edwar es un super
// agente, todo lo que pase con sus agentes va todo al mismo lugar") -- sección separada de
// Agentes/Movimientos, a propósito (ver repo/supervisores.ts): un supervisor con
// usa_cuenta_consolidada=true tiene UN SOLO saldo (fichas_reales + cuenta_corriente, no por
// club) que junta todo lo de sus agentes -- esos agentes se ven acá solo como desglose de
// lectura/auditoría, nunca tienen saldo propio mientras esto esté prendido.
const TIPO_LABEL: Record<string, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  AJUSTE: "Ajuste manual",
};

export default function Supervisores() {
  const [supervisores, setSupervisores] = useState<any[] | null>(null);
  const [clubes, setClubes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [seleccionado, setSeleccionado] = useState<any | null>(null);
  const [subordinados, setSubordinados] = useState<any[] | null>(null);
  const [movimientos, setMovimientos] = useState<any[] | null>(null);
  // Desglose de "cómo se compone el saldo" (01/10/2026, pedido de Leo): el saldo de la cuenta
  // consolidada es un pool único (no tiene desglose vivo por agente, ver nota en
  // repo/supervisores.ts), pero el saldo HISTÓRICO inicial que se migró sí quedó registrado
  // línea por línea en supervisor_migracion_historica -- esto lo muestra.
  const [migracion, setMigracion] = useState<any[] | null>(null);
  const [showMovimiento, setShowMovimiento] = useState(false);
  // Ocultar/mostrar un agente de "Agentes a cargo" (01/10/2026, pedido de Leo, caso Uriel):
  // puramente visual, nunca mueve plata -- ver nota en schema.sql / repo/catalog.ts. Arranca
  // colapsado (false) para no mostrar de entrada una lista larga de ocultos.
  const [mostrarOcultos, setMostrarOcultos] = useState(false);
  const [ocultando, setOcultando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.supervisoresConsolidados().then(setSupervisores).catch((e) => setError(e.message));
  }

  useEffect(() => {
    refresh();
    api.clubes().then(setClubes);
  }, []);

  function abrirSupervisor(s: any) {
    setSeleccionado(s);
    setSubordinados(null);
    setMovimientos(null);
    setMostrarOcultos(false);
    setMigracion(null);
    api.subordinadosSupervisor(s.id).then(setSubordinados);
    api.movimientosSupervisor(s.id).then(setMovimientos);
    api.migracionHistoricaSupervisor(s.id).then(setMigracion);
  }

  async function toggleOcultoAgente(agentId: string, agentName: string, ocultar: boolean) {
    if (!seleccionado) return;
    // Esto mueve plata de verdad (resta/suma el saldo actual del agente al pool de Uriel, ver
    // repo/supervisores.ts setOcultoSubordinado) -- confirmación antes de aplicar, mismo criterio
    // que "Revertir" acá abajo.
    const mensaje = ocultar
      ? `¿Ocultar a "${agentName}"? Se le va a restar a esta cuenta el saldo ACTUAL de ese agente (fichas + pendiente de rakeback). Se puede deshacer desde "Movimientos manuales" (Revertir) o volviendo a mostrarlo.`
      : `¿Volver a mostrar a "${agentName}"? Se le va a sumar a esta cuenta el saldo ACTUAL de ese agente en este momento (no el que tenía cuando se ocultó).`;
    if (!confirm(mensaje)) return;
    setOcultando(agentId);
    try {
      await api.ocultarAgenteSupervisor(seleccionado.id, agentId, ocultar);
      const frescos = await api.subordinadosSupervisor(seleccionado.id);
      setSubordinados(frescos);
      refrescarSeleccionado();
    } catch (err: any) {
      setError(err.message || "No se pudo actualizar el agente.");
    } finally {
      setOcultando(null);
    }
  }

  function refrescarSeleccionado() {
    if (!seleccionado) return;
    api.supervisorConsolidado(seleccionado.id).then((s: any) => {
      setSeleccionado(s);
      setSupervisores((prev) => (prev ?? []).map((x) => (x.id === s.id ? s : x)));
    });
    api.movimientosSupervisor(seleccionado.id).then(setMovimientos);
  }

  async function onRevertirMovimiento(id: string) {
    if (!confirm("¿Revertir este movimiento? Aplica el efecto contrario sobre la cuenta.")) return;
    try {
      await api.revertirMovimientoSupervisor(id);
      refrescarSeleccionado();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Supervisores: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!supervisores) return <div className="muted">Cargando...</div>;

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Supervisores (cuenta consolidada)</h2>
          <div className="muted">
            Un supervisor con cuenta consolidada activada (ver Administración → editar agente) junta en un
            único saldo todo lo de los agentes que le reportan -- esos agentes dejan de acumular saldo propio.
          </div>
        </div>
      </div>

      {supervisores.length === 0 ? (
        <div className="panel">
          <div className="muted">
            Todavía no hay ningún supervisor con "Usa cuenta consolidada" activado. Se activa editando un
            agente desde Administración.
          </div>
        </div>
      ) : (
        <div className="panel">
          <h3>Supervisores</h3>
          <table>
            <thead><tr><th>Nombre</th><th>Modelo</th><th>Fichas reales</th><th>Cuenta corriente</th><th>Saldo total</th><th></th></tr></thead>
            <tbody>
              {supervisores.map((s) => {
                const fichas = Number(s.fichas_reales);
                const cc = Number(s.cuenta_corriente);
                return (
                  <tr key={s.id} style={seleccionado?.id === s.id ? { outline: "1px solid var(--gold)" } : undefined}>
                    <td>{s.name}</td>
                    <td className="muted">{s.modelo_cuenta ?? "—"}</td>
                    <td>{usd(fichas)}</td>
                    <td>{usd(cc)}</td>
                    <td className={fichas + cc >= 0 ? "pos" : "neg"}>{usd(fichas + cc)}</td>
                    <td>
                      <button className="btn secondary small" onClick={() => abrirSupervisor(s)}>Ver cuenta</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {seleccionado && (
        <div className="panel">
          <div className="topbar">
            <h3 style={{ margin: 0 }}>{seleccionado.name}</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setShowMovimiento(true)}>+ Carga / Descarga / Ajuste</button>
            </div>
          </div>

          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Fichas reales</div>
              <div className="value">{usd(Number(seleccionado.fichas_reales))}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Cuenta corriente</div>
              <div className="value">{usd(Number(seleccionado.cuenta_corriente))}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Saldo total</div>
              <div className="value">{usd(Number(seleccionado.fichas_reales) + Number(seleccionado.cuenta_corriente))}</div>
            </div>
          </div>

          <h4>Cómo se compone el saldo</h4>
          {!migracion ? (
            <div className="muted">Cargando...</div>
          ) : migracion.length === 0 ? (
            <div className="muted">Todavía no se migró ningún saldo histórico a esta cuenta.</div>
          ) : (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Saldo histórico que se trajo de cada agente al activar la cuenta consolidada (una sola vez, al arrancar) --
                de acá en más el saldo solo cambia con "+ Carga / Descarga / Ajuste" de arriba (ver tabla de abajo).
              </div>
              <table>
                <thead><tr><th>Agente</th><th>Club</th><th className="num">Fichas migradas</th><th className="num">Pendiente migrado</th><th>Fecha</th></tr></thead>
                <tbody>
                  {migracion.map((m) => (
                    <tr key={m.id} title={m.notes || undefined}>
                      <td>{m.agent_name}</td>
                      <td className="muted">{m.club_name ?? "—"}</td>
                      <td className="num">{usd(Number(m.fichas_migradas))}</td>
                      <td className="num">{usd(Number(m.pendiente_migrado))}</td>
                      <td className="muted">{dateShort(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 600 }}>
                    <td colSpan={2}>Total</td>
                    <td className="num">{usd(migracion.reduce((s, m) => s + Number(m.fichas_migradas), 0))}</td>
                    <td className="num">{usd(migracion.reduce((s, m) => s + Number(m.pendiente_migrado), 0))}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}

          <h4>Agentes a cargo (solo lectura -- sin saldo propio)</h4>
          {!subordinados ? (
            <div className="muted">Cargando...</div>
          ) : subordinados.length === 0 ? (
            <div className="muted">
              Ningún agente tiene "Supervisor" = "{seleccionado.name}" todavía -- asignalo desde Administración.
            </div>
          ) : (
            <>
              {(() => {
                const visibles = subordinados.filter((a) => !a.oculto_en_supervisor);
                const ocultos = subordinados.filter((a) => a.oculto_en_supervisor);
                return (
                  <>
                    <table>
                      <thead><tr><th>Nombre</th><th>Sistema</th><th>Activo</th><th></th></tr></thead>
                      <tbody>
                        {visibles.length === 0 && (
                          <tr><td colSpan={4} className="muted">Todos los agentes están ocultos ahora mismo.</td></tr>
                        )}
                        {visibles.map((a) => (
                          <tr key={a.id}>
                            <td>{a.name}</td>
                            <td className="muted">{a.default_system}</td>
                            <td className="muted">{a.active ? "Sí" : "No"}</td>
                            <td>
                              <button
                                className="btn secondary small"
                                disabled={ocultando === a.id}
                                onClick={() => toggleOcultoAgente(a.id, a.name, true)}
                                title="Ocultarlo y restarle a Uriel su saldo actual -- no lo da de baja, se puede volver a mostrar cuando quieras."
                              >
                                {ocultando === a.id ? "..." : "Ocultar"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {ocultos.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <button className="btn secondary small" onClick={() => setMostrarOcultos((v) => !v)}>
                          {mostrarOcultos ? "Ocultar la lista de ocultos" : `Mostrar ocultos (${ocultos.length})`}
                        </button>
                        {mostrarOcultos && (
                          <table style={{ marginTop: 8 }}>
                            <thead><tr><th>Nombre</th><th>Sistema</th><th>Activo</th><th></th></tr></thead>
                            <tbody>
                              {ocultos.map((a) => (
                                <tr key={a.id} style={{ opacity: 0.6 }}>
                                  <td>{a.name}</td>
                                  <td className="muted">{a.default_system}</td>
                                  <td className="muted">{a.active ? "Sí" : "No"}</td>
                                  <td>
                                    <button
                                      className="btn secondary small"
                                      disabled={ocultando === a.id}
                                      onClick={() => toggleOcultoAgente(a.id, a.name, false)}
                                    >
                                      {ocultando === a.id ? "..." : "Mostrar"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}

          <h4>Movimientos manuales</h4>
          {!movimientos ? (
            <div className="muted">Cargando...</div>
          ) : movimientos.length === 0 ? (
            <div className="muted">Todavía no hay movimientos cargados.</div>
          ) : (
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Club</th><th>Agente (informativo)</th><th>Importe</th><th>USDT real</th><th>Notas</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id} className={m.status === "REVERTIDO" ? "muted" : ""}>
                    <td>{dateShort(m.occurred_at)}</td>
                    <td>{TIPO_LABEL[m.type] ?? m.type}</td>
                    <td>{m.club_name}</td>
                    <td>{m.agent_name ?? "—"}</td>
                    <td>{usd(Number(m.amount))}</td>
                    <td className="muted">{m.usdt_real ? "Sí" : "No"}</td>
                    <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                    <td>{m.status === "REVERTIDO" ? <span className="badge neutral">Revertido</span> : <span className="badge pos">Aplicado</span>}</td>
                    <td>
                      {m.status !== "REVERTIDO" && (
                        <button className="btn danger small" onClick={() => onRevertirMovimiento(m.id)}>Revertir</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showMovimiento && seleccionado && (
        <Modal title={`Movimiento — ${seleccionado.name}`} onClose={() => setShowMovimiento(false)}>
          <MovimientoForm
            supervisor={seleccionado}
            clubes={clubes}
            subordinados={subordinados ?? []}
            onDone={() => {
              setShowMovimiento(false);
              refrescarSeleccionado();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function MovimientoForm({
  supervisor,
  clubes,
  subordinados,
  onDone,
}: {
  supervisor: any;
  clubes: any[];
  subordinados: any[];
  onDone: () => void;
}) {
  const [type, setType] = useState<"CARGA" | "DESCARGA" | "AJUSTE">("CARGA");
  const [clubId, setClubId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [amount, setAmount] = useState("");
  const [campoAjuste, setCampoAjuste] = useState<"FICHAS" | "CUENTA_CORRIENTE">("CUENTA_CORRIENTE");
  const [usdtReal, setUsdtReal] = useState(false);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!clubId) return setMsg({ ok: false, text: "El club es obligatorio." });
    if (supervisor.exigir_agente_en_movimientos && !agentId) {
      return setMsg({ ok: false, text: "Este supervisor exige indicar el agente de origen." });
    }
    const amountNum = Number(amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum === 0) return setMsg({ ok: false, text: "Importe inválido." });
    if (type !== "AJUSTE" && amountNum < 0) return setMsg({ ok: false, text: "Para Carga/Descarga el importe va siempre en positivo." });

    setLoading(true);
    try {
      await api.registrarMovimientoSupervisor(supervisor.id, {
        clubId,
        agentId: agentId || null,
        type,
        amount: amountNum,
        campoAjuste: type === "AJUSTE" ? campoAjuste : undefined,
        usdtReal,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="CARGA">Carga (fichas +, cuenta corriente −)</option>
            <option value="DESCARGA">Descarga (resta primero de cuenta corriente, después de fichas)</option>
            <option value="AJUSTE">Ajuste manual</option>
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
          <label>Agente {supervisor.exigir_agente_en_movimientos ? "" : "(opcional, informativo)"}</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">{supervisor.exigir_agente_en_movimientos ? "Elegir..." : "— Ninguno —"}</option>
            {subordinados.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Nunca genera saldo propio para ese agente -- solo queda como dato de a quién correspondía el movimiento.
          </div>
        </div>
        {type === "AJUSTE" && (
          <div className="field">
            <label>Aplicar a</label>
            <select value={campoAjuste} onChange={(e) => setCampoAjuste(e.target.value as any)}>
              <option value="CUENTA_CORRIENTE">Cuenta corriente</option>
              <option value="FICHAS">Fichas reales</option>
            </select>
          </div>
        )}
        <div className="field">
          <label>Importe (USD){type === "AJUSTE" ? " -- puede ser negativo" : ""}</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === "AJUSTE" ? "Ej: -50" : "Ej: 600"} />
        </div>
        {type !== "AJUSTE" && (
          <div className="field">
            <label>
              <input type="checkbox" checked={usdtReal} onChange={(e) => setUsdtReal(e.target.checked)} style={{ marginRight: 6 }} />
              Hubo transferencia real de USDT
            </label>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Esto es solo una reclasificación interna entre fichas y cuenta corriente -- NO toca Wallet Manos salvo
              que tildes esto (además existió una entrada/salida real de USDT: {type === "CARGA" ? "ingreso" : "egreso"} en Wallet Manos por el mismo importe).
            </div>
          </div>
        )}
        <div className="field">
          <label>Observación</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar"}</button>
    </form>
  );
}
