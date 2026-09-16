import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "../components/Modal";

// Selector de agentes/clubes como checklist con buscador — mismo patrón que ya usa Liquidaciones
// para combinar varios agentes en un solo pago. Acá sirve para decidir qué cuentas puede VER un
// mismo login desde "Mi cuenta" (selector cuando tiene más de una).
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
        El primero que tildes queda como cuenta principal (la que usa para entrar). Si tildás más de uno, en
        "Mi cuenta" le aparece un selector para elegir cuál mirar.
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
            {seleccionados[0] === a.id && <span className="badge neutral" style={{ fontSize: 10 }}>Principal</span>}
          </label>
        ))}
        {filtrados.length === 0 && <div className="muted">Sin resultados.</div>}
      </div>
    </div>
  );
}

// Panel de configuración de negocio de un Supervisor — vive acá (no en una pantalla aparte)
// para que, como pidió Leo, "quede todo en el mismo lugar" al crear/editar ese usuario.
// Dos cosas separadas, aunque se editen juntas:
//  1. "Agentes a cargo": asigna/quita agents.supervisor (mecanismo YA existente, el mismo que
//     usa Administración → Agentes → Supervisores) — decide a quién le llega el rakeback
//     centralizado cuando un club tiene rebate_destino = RAKEBACK_SUPERVISOR.
//  2. "Comisiones por referido": % fijo sobre el rake semanal de un agente puntual (no
//     necesariamente a cargo), que se acredita SOLO como saldo separado, automático en cada
//     cierre de ese agente (ver supervisor_referidos / aplicarCierreSemanal).
function PanelSupervisor({ supervisorAgentId, agentes }: { supervisorAgentId: string; agentes: any[] }) {
  const supervisor = agentes.find((a) => a.id === supervisorAgentId);
  const supervisorName: string | undefined = supervisor?.name;
  const [referidos, setReferidos] = useState<any[]>([]);
  const [agenteReferidoId, setAgenteReferidoId] = useState("");
  const [porcentaje, setPorcentaje] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function refrescarReferidos() {
    api.referidosDeSupervisor(supervisorAgentId).then(setReferidos);
  }

  useEffect(() => {
    refrescarReferidos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supervisorAgentId]);

  const otrosAgentes = agentes.filter((a) => a.id !== supervisorAgentId);
  const aCargo = otrosAgentes.filter((a) => a.supervisor === supervisorName);

  async function agregarReferido(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const pct = Number(porcentaje);
    if (!agenteReferidoId || !pct || pct <= 0 || pct > 100) {
      return setMsg({ ok: false, text: "Elegí un agente y un % entre 0 y 100." });
    }
    try {
      await api.crearReferido(supervisorAgentId, { agenteReferidoId, porcentaje: pct });
      setAgenteReferidoId("");
      setPorcentaje("");
      refrescarReferidos();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo agregar." });
    }
  }

  async function cambiarPorcentaje(r: any, nuevo: string) {
    const pct = Number(nuevo);
    if (!pct || pct <= 0 || pct > 100) return;
    await api.actualizarReferido(r.id, { porcentaje: pct });
    refrescarReferidos();
  }

  async function quitarReferido(r: any) {
    if (!confirm(`¿Dejar de acreditarle a ${supervisorName} comisión por ${r.agente_referido_name}? El saldo ya acumulado (${r.saldo}) queda como está, solo se corta la acreditación automática a futuro.`)) return;
    await api.actualizarReferido(r.id, { active: false });
    refrescarReferidos();
  }

  async function toggleACargo(a: any) {
    if (a.supervisor && a.supervisor !== supervisorName) {
      if (!confirm(`${a.name} ya tiene cargado como supervisor a "${a.supervisor}". ¿Reasignarlo a ${supervisorName}?`)) return;
    }
    await api.editarAgente(a.id, { supervisor: a.supervisor === supervisorName ? null : supervisorName ?? null });
    // Fuerza refresco del listado de agentes en el padre recargando la página de datos: como
    // "agentes" viene por props, alcanza con refrescar el propio array local vía window event
    // simple — más simple: recargar toda la lista de usuarios/agentes del padre.
    window.dispatchEvent(new Event("digiplayers:agentes-actualizados"));
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <h3>Configuración de Supervisor — {supervisorName}</h3>

      <div style={{ marginBottom: 18 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          Agentes a cargo (rakeback centralizado — mismo dato que Administración → Agentes → Supervisores).
        </div>
        <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8 }}>
          {otrosAgentes.map((a) => (
            <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={aCargo.includes(a)} onChange={() => toggleACargo(a)} />
              {a.name}
              {a.supervisor && a.supervisor !== supervisorName && (
                <span className="badge neutral" style={{ fontSize: 10 }}>a cargo de {a.supervisor}</span>
              )}
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          Comisiones por referido: % fijo sobre el rake semanal de un agente, acreditado solo (saldo
          separado, se ve en "Mi supervisión") en cada cierre de ese agente.
        </div>
        {referidos.length > 0 && (
          <table style={{ marginBottom: 10 }}>
            <thead><tr><th>Agente referido</th><th>%</th><th>Saldo acumulado</th><th></th></tr></thead>
            <tbody>
              {referidos.map((r) => (
                <tr key={r.id}>
                  <td>{r.agente_referido_name}</td>
                  <td>
                    <input
                      type="number"
                      defaultValue={r.porcentaje}
                      min={0}
                      max={100}
                      step="0.1"
                      style={{ width: 70 }}
                      onBlur={(e) => cambiarPorcentaje(r, e.target.value)}
                    />
                  </td>
                  <td>{r.saldo}</td>
                  <td><button type="button" className="btn secondary small" onClick={() => quitarReferido(r)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={agregarReferido} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label style={{ fontSize: 12 }}>Nuevo agente referido</label>
            <select value={agenteReferidoId} onChange={(e) => setAgenteReferidoId(e.target.value)}>
              <option value="">Elegir agente...</option>
              {otrosAgentes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ width: 90, marginBottom: 0 }}>
            <label style={{ fontSize: 12 }}>%</label>
            <input type="number" min={0} max={100} step="0.1" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} />
          </div>
          <button className="btn secondary small" style={{ marginBottom: 0 }}>+ Agregar</button>
        </form>
        {msg && <div className={msg.ok ? "success" : "error"} style={{ marginTop: 8 }}>{msg.text}</div>}
      </div>
    </div>
  );
}

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);

  function refresh() {
    api.usuarios().then(setUsuarios);
  }

  function refreshAgentes() {
    api.agentes().then(setAgentes);
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

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Usuarios y permisos</h2>
          <div className="muted">
            ADMIN ve y administra todo. SUPERVISOR ve el resumen de su grupo de agentes a cargo. AGENTE ve "Mi cuenta" de sus agentes/clubes asociados, nunca la de otro.
          </div>
        </div>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar formulario" : "+ Nuevo usuario"}</button>
      </div>

      {showForm && <NuevoUsuario agentes={agentes} onCreated={() => { refresh(); setShowForm(false); }} />}

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

function NuevoUsuario({ agentes, onCreated }: { agentes: any[]; onCreated: () => void }) {
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "AGENT" | "SUPERVISOR">("AGENT");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (agentIds.length === 0 || !email.trim() || password.length < 6) {
      return setMsg({ ok: false, text: "Al menos un agente, un usuario y una contraseña de al menos 6 caracteres son obligatorios." });
    }
    setLoading(true);
    try {
      await api.crearUsuario({ agentIds, email: email.trim(), password, role });
      setMsg({ ok: true, text: `Usuario ${email} creado.` });
      setEmail("");
      setPassword("");
      setAgentIds([]);
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
        <SelectorAgentes agentes={agentes} seleccionados={agentIds} onChange={setAgentIds} />
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading} style={{ marginTop: 10 }}>{loading ? "Creando..." : "Crear usuario"}</button>
      </form>
    </div>
  );
}

function EditarUsuario({ usuario, agentes, onDone }: { usuario: any; agentes: any[]; onDone: () => void }) {
  const [email, setEmail] = useState(usuario.email);
  const [password, setPassword] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>((usuario.agentes ?? []).map((a: any) => a.id));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!email.trim() || agentIds.length === 0) {
      return setMsg({ ok: false, text: "El usuario y al menos un agente son obligatorios." });
    }
    if (password && password.length < 6) {
      return setMsg({ ok: false, text: "La nueva contraseña tiene que tener al menos 6 caracteres." });
    }
    setLoading(true);
    try {
      const data: any = { email: email.trim(), agentIds };
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
      <SelectorAgentes agentes={agentes} seleccionados={agentIds} onChange={setAgentIds} />
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading} style={{ marginTop: 10 }}>{loading ? "Guardando..." : "Guardar cambios"}</button>
      {usuario.role === "SUPERVISOR" && usuario.agent_id && (
        <PanelSupervisor supervisorAgentId={usuario.agent_id} agentes={agentes} />
      )}
    </form>
  );
}
