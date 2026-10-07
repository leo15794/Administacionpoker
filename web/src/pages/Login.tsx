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
      nav(role === "ADMIN" ? "/dashboard" : role === "SUPERVISOR" ? "/mi-supervision" : "/mi-cuenta");
    } catch (err: any) {
      setError(err.message || "No se pudo ingresar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-hero-card">
        <div className="login-visual">
          <div className="login-particle login-particle--1" />
          <div className="login-particle login-particle--2" />
          <div className="login-particle login-particle--3" />
          <div className="login-particle login-particle--4" />
          <div className="login-particle login-particle--5" />
          <div className="login-suit login-suit--1">♠</div>
          <div className="login-suit login-suit--2">♦</div>
          <div className="login-suit login-suit--3">♥</div>
          <div className="login-suit login-suit--4">♣</div>
          {/* FIX 07/10/2026 (pedido Leo): dos cartas caen antes de que aparezca la marca --
              el resto del reveal se corrio un poco mas tarde (ver index.css) para que arranque
              recien cuando las cartas terminan de acomodarse. */}
          <div className="login-cards">
            <div className="login-card login-card--1">♠</div>
            <div className="login-card login-card--2">♥</div>
          </div>
          <div className="login-mark login-reveal" style={{ animationDelay: ".45s" }}>D</div>
          <h1 className="login-reveal" style={{ animationDelay: ".55s" }}>DigiPlayers</h1>
          <p className="login-reveal" style={{ animationDelay: ".65s" }}>Sistema de gestión de agentes — club privado.</p>
          <div className="login-dots login-reveal" style={{ animationDelay: ".75s" }}>
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="login-form-panel">
          <h2 className="login-reveal" style={{ animationDelay: ".2s" }}>Ingresar</h2>
          <div className="sub login-reveal" style={{ animationDelay: ".28s" }}>Accedé con tu usuario y contraseña</div>
          <form onSubmit={onSubmit}>
            <div className="field login-reveal" style={{ animationDelay: ".36s" }}>
              <label>Usuario</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" />
            </div>
            <div className="field login-reveal" style={{ animationDelay: ".44s" }}>
              <label>Contraseña</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
            </div>
            {error && <div className="error login-reveal" style={{ animationDelay: "0s" }}>{error}</div>}
            <button className="btn login-reveal" style={{ width: "100%", animationDelay: ".52s" }} disabled={loading}>
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
          <div className="footnote login-reveal" style={{ animationDelay: ".6s" }}>Acceso exclusivo — club privado</div>
        </div>
      </div>
    </div>
  );
}
