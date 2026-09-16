import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";
import { FilaAgenteConJugadores, ACCOUNT_TYPE_LABELS } from "./Agentes";
import { usd } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

// Selector de agentes/clubes como checklist con buscador — mismo patrón que ya usa Liquidaciones
// para combinar varios agentes en un solo pago. Acá sirve para decidir qué cuentas puede VER un
// mismo login desde "Mi cuenta" (selector cuando tiene más de una). A propósito NO hay ninguna
// jerarquía acá — todas las cuentas tildadas pesan igual, cuál es la de acceso "por defecto" se
// elige aparte (ver SelectorCuentaDefault) para no depender del orden en que se tildó cada una.
function SelectorAgentes({
  agentes,
  seleccionados,
  onChange,
}: {
  agentes: any[];
  seleccionados: string[];
  onChange: (ids: string[]) => void;
}) {
  const [filtro, setFiltro] = useState("");
  const filtrados = filtro.trim()
    ? agentes.filter((a) => a.name.toLowerCase().includes(filtro.trim().toLowerCase()))
    : agentes;

  function toggle(id: string) {
    onChange(seleccionados.includes(id) ? seleccionados.filter((x) => x !== id) : [...seleccionados, id]);
  }

  return (
    <div className="field">
      <label>Agentes/clubes que puede ver</label>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        Si tildás más de uno, en "Mi cuenta" le aparece un selector para elegir cuál mirar — todos pesan igual acá.
      </div>
      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar agente..."
        style={{ width: "100%", marginBottom: 8 }}
      />
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8 }}>
        {filtrados.map((a) => (
          <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", cursor: "pointer" }}>
            <input type="checkbox" checked={seleccionados.includes(a.id)} onChange={() => toggle(a.id)} />
            {a.name}
          </label>
        ))}
        {filtrados.length === 0 && <div className="muted">Sin resultados.</div>}
      </div>
    </div>
  );
}

// Cuál de los agentes tildados arriba usa el login/JWT por defecto al entrar — decisión
// explícita y separada del checklist (no "la primera que se tildó"). Si el que estaba elegido
// deja de estar tildado, cae solo al primero que quede disponible.
function SelectorCuentaDefault({
  agentes,
  seleccionados,
  value,
  onChange,
}: {
  agentes: any[];
  seleccionados: string[];
  value: string;
  onChange: (id: string) => void;
}) {
  const opciones = agentes.filter((a) => seleccionados.includes(a.id));
  useEffect(() => {
    if (opciones.length > 0 && !opciones.some((a) => a.id === value)) {
      onChange(opciones[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionados.join(",")]);

  if (opciones.length <= 1) return null;

  return (
    <div className="field">
      <label>Cuenta de acceso por defecto</label>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        Con cuál de las tildadas arriba entra al loguearse — puede cambiar cuál mirar después desde "Mi cuenta".
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {opciones.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    </div>
  );
}

// Panel de configuración de negocio de un Supervisor — vive acá (no en una pantalla aparte)
// para que, como pidió Leo, "quede todo en el mismo lugar" al crear/editar ese usuario.
// UNA sola tabla, un renglón por agente — no dos selectores separados para lo mismo:
//  - "A cargo": asigna/quita agents.supervisor (mecanismo YA existente, el mismo que usa
//    Administración → Agentes → Supervisores) — decide a quién le llega el rakeback
//    centralizado cuando un club tiene rebate_destino = RAKEBACK_SUPERVISOR.
//  - "% comisión por referido": cargás un % ahí mismo, sin re-elegir el agente en otro lado.
//    Se acredita SOLO como saldo separado, automático en cada cierre de ese agente (ver
//    supervisor_referidos / aplicarCierreSemanal) — un agente puede estar "a cargo", tener
//    comisión por referido, las dos cosas, o ninguna: son independientes entre sí.
function FilaAgenteSupervisor({
  agente,
  aCargo,
  supervisorName,
  referido,
  onToggleACargo,
  onGuardarPorcentaje,
}: {
  agente: any;
  aCargo: boolean;
  supervisorName: string | undefined;
  referido: any | undefined;
  onToggleACargo: () => void;
  onGuardarPorcentaje: (valor: string) => void;
}) {
  return (
    <tr>
      <td>
        {agente.name}
        {agente.supervisor && agente.supervisor !== supervisorName && (
          <span className="badge neutral" style={{ fontSize: 10, marginLeft: 6 }}>a cargo de {agente.supervisor}</span>
        )}
      </td>
      <td style={{ textAlign: "center" }}>
        <input type="checkbox" checked={aCargo} onChange={onToggleACargo} />
      </td>
      <td>
        <input
          type="number"
          key={referido?.porcentaje ?? "vacio"}
          defaultValue={referido?.porcentaje ?? ""}
          min={0}
          max={100}
          step="0.1"
          placeholder="—"
          style={{ width: 70 }}
          onBlur={(e) => onGuardarPorcentaje(e.target.value)}
        />
      </td>
      <td className="muted">{referido ? referido.saldo : "—"}</td>
    </tr>
  );
}

function PanelSupervisor({ usuario, agentes, supervisoresData }: { usuario: any; agentes: any[]; supervisoresData: any[] }) {
  const { confirmDialog } = useConfirmDialog();
  // "A cargo" SÍ depende de la cuenta principal (agents.supervisor se resuelve por nombre de
  // agente — mecanismo que ya existía antes de esta feature). "% comisión por referido" NO
  // depende de eso: cuelga directo del login (usuario.id), a propósito, para no obligar a que
  // exista un agente dedicado solo para poder cobrar una comisión.
  const supervisorAgentId: string | undefined = usuario.agent_id;
  const supervisor = agentes.find((a) => a.id === supervisorAgentId);
  const supervisorName: string | undefined = supervisor?.name;
  const [referidos, setReferidos] = useState<any[]>([]);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function refrescarReferidos() {
    api.referidosDeSupervisor(usuario.id).then(setReferidos);
    api.movimientosReferidos(usuario.id).then(setMovimientos);
  }

  useEffect(() => {
    refrescarReferidos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.id]);

  const otrosAgentes = agentes.filter((a) => a.id !== supervisorAgentId);
  const filtrados = filtro.trim()
    ? otrosAgentes.filter((a) => a.name.toLowerCase().includes(filtro.trim().toLowerCase()))
    : otrosAgentes;
  const aCargoIds = new Set(supervisorName ? otrosAgentes.filter((a) => a.supervisor === supervisorName).map((a) => a.id) : []);

  async function toggleACargo(a: any) {
    if (a.supervisor && a.supervisor !== supervisorName) {
      if (!(await confirmDialog(`${a.name} ya tiene cargado como supervisor a "${a.supervisor}". ¿Reasignarlo a ${supervisorName}?`))) return;
    }
    await api.editarAgente(a.id, { supervisor: a.supervisor === supervisorName ? null : supervisorName ?? null });
    window.dispatchEvent(new Event("digiplayers:agentes-actualizados"));
  }

  async function guardarPorcentaje(agente: any, valor: string) {
    setMsg(null);
    const existente = referidos.find((r) => r.agente_referido_id === agente.id);
    const valorLimpio = valor.trim();

    if (!valorLimpio) {
      // Lo dejaron vacío: si tenía comisión cargada, se desactiva (el saldo ya acumulado queda
      // como está, solo se corta la acreditación automática a futuro).
      if (existente) {
        if (!(await confirmDialog(`¿Sacarle a ${agente.name} la comisión por referido? El saldo ya acumulado (${existente.saldo}) queda como está, solo se corta la acreditación a futuro.`))) {
          refrescarReferidos(); // restaura el input al valor que tenía
          return;
        }
        await api.actualizarReferido(existente.id, { active: false });
        refrescarReferidos();
      }
      return;
    }

    const pct = Number(valorLimpio);
    if (!pct || pct <= 0 || pct > 100) {
      setMsg({ ok: false, text: `El % de ${agente.name} tiene que ser un número entre 0 y 100.` });
      refrescarReferidos();
      return;
    }
    try {
      if (existente) {
        if (pct !== Number(existente.porcentaje)) {
          await api.actualizarReferido(existente.id, { porcentaje: pct });
        }
      } else {
        await api.crearReferido(usuario.id, { agenteReferidoId: agente.id, porcentaje: pct });
      }
      refrescarReferidos();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
      refrescarReferidos();
    }
  }

  const agentesACargoConDetalle = otrosAgentes.filter((a) => aCargoIds.has(a.id));
  const rakebackCentralizado = supervisoresData.find((s) => s.id === supervisorAgentId)?.rakeback_centralizado_acreditado ?? 0;
  const saldoReferidosTotal = referidos.reduce((acc, r) => acc + Number(r.saldo), 0);

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="topbar" style={{ marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>Configuración de Supervisor — {usuario.email}</h3>
        {supervisor && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span className={`badge ${Number(supervisor.saldo_total) >= 0 ? "pos" : "neg"}`}>Saldo propio: {usd(supervisor.saldo_total)}</span>
            <span className="badge neutral">Rakeback centralizado: {usd(rakebackCentralizado)}</span>
            <span className="badge neutral">Comisión por referido: {usd(saldoReferidosTotal)}</span>
          </div>
        )}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Por cada agente: tildá "A cargo" si el rakeback centralizado de ese club le llega a este supervisor
        (mismo dato que Administración → Agentes → Supervisores{!supervisorName && " — necesita que la cuenta principal de este usuario sea un agente tipo Supervisor"}),
        y/o cargale un % en "Comisión por referido" para que cobre ese % del rake semanal de ese agente en cada
        cierre (saldo separado, visible en "Mi supervisión") — son dos cosas independientes, un agente puede
        tener una, la otra, las dos, o ninguna.
      </div>
      <input
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Buscar agente..."
        style={{ width: "100%", marginBottom: 8 }}
      />
      <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
        <table>
          <thead>
            <tr><th>Agente</th><th>A cargo</th><th>Comisión por referido (%)</th><th>Saldo acumulado</th></tr>
          </thead>
          <tbody>
            {filtrados.map((a) => (
              <FilaAgenteSupervisor
                key={a.id}
                agente={a}
                aCargo={aCargoIds.has(a.id)}
                supervisorName={supervisorName}
                referido={referidos.find((r) => r.agente_referido_id === a.id)}
                onToggleACargo={() => toggleACargo(a)}
                onGuardarPorcentaje={(valor) => guardarPorcentaje(a, valor)}
              />
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={4} className="muted">Sin resultados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"} style={{ marginTop: 8 }}>{msg.text}</div>}

      {agentesACargoConDetalle.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Detalle de agentes a cargo (mismo árbol que antes veías en Administración → Agentes → Supervisores).
          </div>
          <table>
            <thead><tr><th></th><th>Tipo de cuenta</th><th>Saldo propio</th></tr></thead>
            <tbody>
              {agentesACargoConDetalle.map((a) => (
                <FilaAgenteConJugadores
                  key={a.id}
                  agente={a}
                  extraCols={
                    <>
                      <td><span className="badge neutral">{ACCOUNT_TYPE_LABELS[a.account_type as keyof typeof ACCOUNT_TYPE_LABELS] ?? a.account_type}</span></td>
                      <td><span className={`badge ${Number(a.saldo_total) >= 0 ? "pos" : "neg"}`}>{usd(a.saldo_total)}</span></td>
                    </>
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button type="button" className="btn secondary small" style={{ marginTop: 12 }} onClick={() => setVerHistorial((v) => !v)}>
        {verHistorial ? "Ocultar historial de comisiones" : `Ver historial de comisiones (${movimientos.length})`}
      </button>
      {verHistorial && (
        movimientos.length === 0 ? (
          <div className="muted" style={{ marginTop: 8 }}>Todavía no se acreditó ninguna comisión.</div>
        ) : (
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Agente</th><th>Semana del cierre</th><th>Tipo</th><th>Monto</th><th>Saldo resultante</th></tr></thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr key={m.id}>
                    <td className="muted">{new Date(m.occurred_at).toLocaleDateString("es-AR")}</td>
                    <td>{m.agente_referido_name}</td>
                    <td className="muted">{m.week_start ? `${m.week_start} al ${m.week_end}` : "—"}</td>
                    <td><span className={`badge ${m.type === "COMISION" ? "pos" : "neutral"}`}>{m.type === "COMISION" ? "Comisión" : "Corrección"}</span></td>
                    <td className={Number(m.amount) >= 0 ? "pos" : "neg"}>{m.amount}</td>
                    <td>{m.resulting_saldo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

export default function Usuarios() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [supervisoresInvalidos, setSupervisoresInvalidos] = useState<any[]>([]);
  const [supervisoresData, setSupervisoresData] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);
  const [preseleccionarAgente, setPreseleccionarAgente] = useState<{ id: string; name: string } | null>(null);

  function refresh() {
    api.usuarios().then(setUsuarios);
  }

  function refreshAgentes() {
    api.agentes().then(setAgentes);
    // Antes vivía en Administración → Agentes → Supervisores (16/09/2026: se unificó todo acá
    // para no tener la config de un supervisor repartida en dos pantallas) — de ahí sale la
    // alerta de "mal cargados" Y el rakeback centralizado acreditado que se muestra en el
    // panel de cada supervisor (PanelSupervisor lo busca en supervisoresData por agent_id).
    api.supervisores().then((d: any) => {
      setSupervisoresInvalidos(d.supervisoresInvalidos ?? []);
      setSupervisoresData(d.supervisores ?? []);
    });
  }

  useEffect(() => {
    refresh();
    refreshAgentes();
    window.addEventListener("digiplayers:agentes-actualizados", refreshAgentes);
    return () => window.removeEventListener("digiplayers:agentes-actualizados", refreshAgentes);
  }, []);

  async function toggleActive(u: any) {
    await api.actualizarUsuario(u.id, { active: !u.active });
    refresh();
  }

  async function cambiarRole(u: any, role: "ADMIN" | "AGENT" | "SUPERVISOR") {
    if (role === u.role) return;
    await api.actualizarUsuario(u.id, { role });
    refresh();
  }

  // Agentes tipo Supervisor disponibles para corregir un "supervisor mal cargado" con un
  // par de clicks, sin tener que ir a editar el agente afectado por separado.
  const supervisoresValidos = agentes.filter((a: any) => a.account_type === "SUPERVISOR");

  // Agentes tipo Supervisor que NO tienen un usuario de acceso creado (agent_id de ningún
  // login apunta a ellos) — sin esto, sus "agentes a cargo" quedaban invisibles después de
  // unificar la vieja pestaña Administración → Agentes → Supervisores acá adentro, porque el
  // panel de supervisor solo se abre editando un USUARIO (Leo lo encontró probando: "no creo
  // un usuario para cada uno, están asignados pero no lo podemos ver").
  const supervisoresSinUsuario = supervisoresData.filter(
    (s) => !usuarios.some((u) => u.agent_id === s.id)
  );

  async function eliminarUsuario(u: any) {
    if (!(await confirmDialog(`¿Eliminar el usuario "${u.email}"? Esto borra el acceso al portal (y su configuración de Supervisor si tenía) — no toca el historial de cierres/movimientos del agente, eso queda intacto. No se puede deshacer.`))) return;
    try {
      await api.eliminarUsuario(u.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el usuario.");
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Usuarios y permisos</h2>
          <div className="muted">
            ADMIN ve y administra todo. SUPERVISOR ve el resumen de su grupo de agentes a cargo. AGENTE ve "Mi cuenta" de sus agentes/clubes asociados, nunca la de otro.
          </div>
        </div>
        <button
          className="btn"
          onClick={() => {
            setPreseleccionarAgente(null);
            setShowForm((v) => !v);
          }}
        >
          {showForm ? "Cerrar formulario" : "+ Nuevo usuario"}
        </button>
      </div>

      {showForm && (
        <NuevoUsuario
          agentes={agentes}
          preseleccionado={preseleccionarAgente ? { agentId: preseleccionarAgente.id, agentName: preseleccionarAgente.name, role: "SUPERVISOR" } : undefined}
          onCreated={() => {
            refresh();
            setShowForm(false);
            setPreseleccionarAgente(null);
          }}
        />
      )}

      {supervisoresInvalidos.length > 0 && (
        <div className="panel" style={{ borderColor: "var(--red)" }}>
          <h3>⚠ Supervisores mal cargados</h3>
          <div className="muted" style={{ marginBottom: 10 }}>
            Estos agentes tienen un supervisor cargado que no coincide con ningún agente activo de tipo
            "Supervisor" — puede ser un nombre mal escrito, un agente que no es tipo Supervisor, o uno dado
            de baja. Corregilo acá mismo (elegí el supervisor correcto, o quitáselo) sin tener que entrar a
            editar cada agente por separado.
          </div>
          <table>
            <thead><tr><th>Agente</th><th>Supervisor cargado (no válido)</th><th>Corregir a</th></tr></thead>
            <tbody>
              {supervisoresInvalidos.map((a: any) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className="muted">{a.supervisor}</td>
                  <td>
                    <select
                      defaultValue=""
                      style={{ fontSize: 12.5 }}
                      onChange={async (e) => {
                        const valor = e.target.value;
                        if (!valor) return;
                        await api.editarAgente(a.id, { supervisor: valor === "__quitar__" ? null : valor });
                        refreshAgentes();
                      }}
                    >
                      <option value="" disabled>Elegir...</option>
                      {supervisoresValidos.map((s: any) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                      <option value="__quitar__">— Quitarle el supervisor —</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {supervisoresSinUsuario.length > 0 && (
        <div className="panel">
          <h3>Supervisores sin usuario de acceso</h3>
          <div className="muted" style={{ marginBottom: 14 }}>
            Estos agentes son de tipo "Supervisor" y pueden tener agentes a cargo, pero todavía no tienen un
            usuario de acceso al portal — por eso no aparecen en la tabla de abajo. Acá ves su árbol (a cargo,
            saldo propio, rakeback centralizado), igual que antes en Administración → Agentes → Supervisores.
            Si además querés que puedan entrar al portal o cobrar comisión por referido, creales un usuario
            de acceso con esta cuenta como principal.
          </div>
          {supervisoresSinUsuario.map((s) => (
            <div key={s.id} style={{ marginBottom: 22 }}>
              <div className="topbar" style={{ marginBottom: 8 }}>
                <h4 style={{ margin: 0 }}>{s.name}</h4>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <span className="muted">Rakeback centralizado acreditado: <strong>{usd(s.rakeback_centralizado_acreditado)}</strong></span>
                  <span className={`badge ${Number(s.saldo_total) >= 0 ? "pos" : "neg"}`}>Saldo propio: {usd(s.saldo_total)}</span>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => {
                      setPreseleccionarAgente({ id: s.id, name: s.name });
                      setShowForm(true);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    + Crear usuario para este agente
                  </button>
                </div>
              </div>
              <table>
                <thead><tr><th></th><th>Tipo de cuenta</th><th>Saldo propio</th></tr></thead>
                <tbody>
                  <FilaAgenteConJugadores
                    agente={s}
                    extraCols={
                      <>
                        <td><span className="badge neutral">Supervisor</span></td>
                        <td><span className={`badge ${Number(s.saldo_total) >= 0 ? "pos" : "neg"}`}>{usd(s.saldo_total)}</span></td>
                      </>
                    }
                  />
                  {(s.agentes ?? []).length === 0 ? (
                    <tr><td colSpan={3} className="muted" style={{ fontSize: 13 }}>Sin agentes a cargo.</td></tr>
                  ) : (
                    s.agentes.map((a: any) => (
                      <FilaAgenteConJugadores
                        key={a.id}
                        agente={a}
                        extraCols={
                          <>
                            <td><span className="badge neutral">{ACCOUNT_TYPE_LABELS[a.account_type as keyof typeof ACCOUNT_TYPE_LABELS] ?? a.account_type}</span></td>
                            <td><span className={`badge ${Number(a.saldo_total) >= 0 ? "pos" : "neg"}`}>{usd(a.saldo_total)}</span></td>
                          </>
                        }
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <table>
          <thead>
            <tr><th>Usuario</th><th>Agentes/clubes</th><th>Rol</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td className="muted">{(u.agentes ?? []).map((a: any) => a.name).join(", ")}</td>
                <td>
                  <select value={u.role} onChange={(e) => cambiarRole(u, e.target.value as any)} style={{ fontSize: 12.5 }}>
                    <option value="AGENT">Agente</option>
                    <option value="SUPERVISOR">Supervisor</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </td>
                <td><span className={`badge ${u.active ? "pos" : "neg"}`}>{u.active ? "Activo" : "Desactivado"}</span></td>
                <td className="row-actions">
                  <button className="btn secondary small" onClick={() => setEditando(u)}>Editar</button>
                  <button className="btn secondary small" onClick={() => toggleActive(u)}>
                    {u.active ? "Desactivar" : "Activar"}
                  </button>
                  <button className="btn danger small" onClick={() => eliminarUsuario(u)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <Modal title={`Editar usuario — ${editando.email}`} onClose={() => setEditando(null)} wide>
          <EditarUsuario
            usuario={editando}
            agentes={agentes}
            supervisoresData={supervisoresData}
            onDone={() => {
              setEditando(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function NuevoUsuario({
  agentes,
  onCreated,
  preseleccionado,
}: {
  agentes: any[];
  onCreated: () => void;
  preseleccionado?: { agentId: string; agentName?: string; role?: "ADMIN" | "AGENT" | "SUPERVISOR" };
}) {
  const [agentIds, setAgentIds] = useState<string[]>(preseleccionado ? [preseleccionado.agentId] : []);
  const [defaultAgentId, setDefaultAgentId] = useState(preseleccionado?.agentId ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "AGENT" | "SUPERVISOR">(preseleccionado?.role ?? "AGENT");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function cambiarAgentIds(ids: string[]) {
    setAgentIds(ids);
    // Con uno solo tildado, ese mismo es la cuenta por defecto sin necesidad de elegir nada.
    if (ids.length === 1) setDefaultAgentId(ids[0]);
    else if (!ids.includes(defaultAgentId)) setDefaultAgentId("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (agentIds.length === 0 || !email.trim() || password.length < 6) {
      return setMsg({ ok: false, text: "Al menos un agente, un usuario y una contraseña de al menos 6 caracteres son obligatorios." });
    }
    const defaultId = defaultAgentId || agentIds[0];
    if (!defaultId) {
      return setMsg({ ok: false, text: "Elegí cuál va a ser la cuenta de acceso por defecto." });
    }
    setLoading(true);
    try {
      await api.crearUsuario({ agentIds, defaultAgentId: defaultId, email: email.trim(), password, role });
      setMsg({ ok: true, text: `Usuario ${email} creado.` });
      setEmail("");
      setPassword("");
      setAgentIds([]);
      setDefaultAgentId("");
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo crear el usuario." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h3>Nuevo usuario de acceso</h3>
      {preseleccionado && (
        <div className="muted" style={{ marginBottom: 10 }}>
          {preseleccionado.agentName ?? "Agente"} precargado como cuenta principal — completá usuario y contraseña para darle acceso al portal.
        </div>
      )}
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Usuario (email o texto libre)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="text" placeholder="Ej: juan123 o juan@mail.com" />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
          </div>
          <div className="field">
            <label>Rol</label>
            <select value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="AGENT">Agente (solo sus cuentas)</option>
              <option value="SUPERVISOR">Supervisor (resumen de su grupo)</option>
              <option value="ADMIN">Admin (control total)</option>
            </select>
          </div>
        </div>
        <SelectorAgentes agentes={agentes} seleccionados={agentIds} onChange={cambiarAgentIds} />
        <SelectorCuentaDefault agentes={agentes} seleccionados={agentIds} value={defaultAgentId} onChange={setDefaultAgentId} />
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading} style={{ marginTop: 10 }}>{loading ? "Creando..." : "Crear usuario"}</button>
      </form>
    </div>
  );
}

function EditarUsuario({ usuario, agentes, supervisoresData, onDone }: { usuario: any; agentes: any[]; supervisoresData: any[]; onDone: () => void }) {
  const [email, setEmail] = useState(usuario.email);
  const [password, setPassword] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>((usuario.agentes ?? []).map((a: any) => a.id));
  const [defaultAgentId, setDefaultAgentId] = useState<string>(usuario.agent_id ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function cambiarAgentIds(ids: string[]) {
    setAgentIds(ids);
    if (ids.length === 1) setDefaultAgentId(ids[0]);
    else if (!ids.includes(defaultAgentId)) setDefaultAgentId("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!email.trim() || agentIds.length === 0) {
      return setMsg({ ok: false, text: "El usuario y al menos un agente son obligatorios." });
    }
    if (password && password.length < 6) {
      return setMsg({ ok: false, text: "La nueva contraseña tiene que tener al menos 6 caracteres." });
    }
    const defaultId = defaultAgentId || agentIds[0];
    if (!defaultId) {
      return setMsg({ ok: false, text: "Elegí cuál va a ser la cuenta de acceso por defecto." });
    }
    setLoading(true);
    try {
      const data: any = { email: email.trim(), agentIds, defaultAgentId: defaultId };
      if (password) data.password = password;
      await api.actualizarUsuario(usuario.id, data);
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Usuario (email o texto libre)</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="text" />
        </div>
        <div className="field">
          <label>Nueva contraseña (dejar en blanco para no cambiarla)</label>
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••" />
        </div>
      </div>
      <SelectorAgentes agentes={agentes} seleccionados={agentIds} onChange={cambiarAgentIds} />
      <SelectorCuentaDefault agentes={agentes} seleccionados={agentIds} value={defaultAgentId} onChange={setDefaultAgentId} />
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading} style={{ marginTop: 10 }}>{loading ? "Guardando..." : "Guardar cambios"}</button>
      {usuario.role === "SUPERVISOR" && (
        <PanelSupervisor usuario={usuario} agentes={agentes} supervisoresData={supervisoresData} />
      )}
    </form>
  );
}
