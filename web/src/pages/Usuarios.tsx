import { useEffect, useState } from "react";
import { api } from "../api";

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);

  function refresh() {
    api.usuarios().then(setUsuarios);
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes);
  }, []);

  async function toggleActive(u: any) {
    await api.actualizarUsuario(u.id, { active: !u.active });
    refresh();
  }

  async function toggleRole(u: any) {
    await api.actualizarUsuario(u.id, { role: u.role === "ADMIN" ? "AGENT" : "ADMIN" });
    refresh();
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Usuarios y permisos</h2>
          <div className="muted">ADMIN ve y administra todo. AGENTE solo ve su propia cuenta (Mi cuenta), nunca la de otro.</div>
        </div>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar formulario" : "+ Nuevo usuario"}</button>
      </div>

      {showForm && <NuevoUsuario agentes={agentes} onCreated={refresh} />}

      <div className="panel">
        <table>
          <thead>
            <tr><th>Email</th><th>Agente</th><th>Rol</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.agent_name}</td>
                <td><span className={`badge ${u.role === "ADMIN" ? "pos" : "neutral"}`}>{u.role}</span></td>
                <td><span className={`badge ${u.active ? "pos" : "neg"}`}>{u.active ? "Activo" : "Desactivado"}</span></td>
                <td style={{ display: "flex", gap: 6 }}>
                  <button className="btn secondary small" onClick={() => toggleRole(u)}>
                    Hacer {u.role === "ADMIN" ? "agente" : "admin"}
                  </button>
                  <button className="btn secondary small" onClick={() => toggleActive(u)}>
                    {u.active ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NuevoUsuario({ agentes, onCreated }: { agentes: any[]; onCreated: () => void }) {
  const [agentId, setAgentId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId || !email.trim() || password.length < 6) {
      return setMsg({ ok: false, text: "Agente, email y una contraseña de al menos 6 caracteres son obligatorios." });
    }
    setLoading(true);
    try {
      await api.crearUsuario({ agentId, email: email.trim(), password, role });
      setMsg({ ok: true, text: `Usuario ${email} creado.` });
      setEmail("");
      setPassword("");
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
            <label>Agente asociado</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Elegir...</option>
              {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
          </div>
          <div className="field">
            <label>Rol</label>
            <select value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="AGENT">Agente (solo su cuenta)</option>
              <option value="ADMIN">Admin (control total)</option>
            </select>
          </div>
        </div>
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading}>{loading ? "Creando..." : "Crear usuario"}</button>
      </form>
    </div>
  );
}
