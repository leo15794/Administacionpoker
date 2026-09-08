import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

// TEMPORAL: sin contraseña, solo email, para destrabar el acceso mientras se resuelve
// el problema de login. Hay que volver a pedir contraseña antes de usar esto fuera de tu máquina.
export default function Login() {
  const [email, setEmail] = useState("admin@digiplayers.local");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token, role } = await api.login(email);
      api.setToken(token);
      nav(role === "ADMIN" ? "/dashboard" : "/mi-cuenta");
    } catch (err: any) {
      setError(err.message || "No se pudo ingresar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-box">
        <h1>DigiPlayers</h1>
        <div className="sub">Sistema de gestión de agentes</div>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
        <div className="hint">
          Sin contraseña por ahora (temporal).
          <br />
          Admin: admin@digiplayers.local
          <br />
          Agente demo: prodigio@digiplayers.local
        </div>
      </div>
    </div>
  );
}
