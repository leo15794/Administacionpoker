import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token, role } = await api.login(email, password);
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
        <div className="login-mark">D</div>
        <h1>DigiPlayers</h1>
        <div className="sub">Sistema de gestión de agentes</div>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username" />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn" style={{ width: "100%" }} disabled={loading}>
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
