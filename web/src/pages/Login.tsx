import LoginSwitch from "../components/LoginSwitch";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Si la sesión se cortó desde el servidor (ver api.ts), se muestra el motivo una vez.
  const [error, setError] = useState(() => {
    try {
      const m = sessionStorage.getItem("dp_motivo_salida") ?? "";
      sessionStorage.removeItem("dp_motivo_salida");
      return m;
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = useState(false);
  // "Olvidé mi contraseña" (10/11/2026, mockup 89).
  const [olvide, setOlvide] = useState(false);
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const nav = useNavigate();

  async function pedirNueva(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.olvideClave(email.trim());
      setPedidoEnviado(true);
    } catch (err: any) {
      setError(err.message || "No se pudo enviar el pedido.");
    } finally {
      setLoading(false);
    }
  }
  // Si la sesión venció dentro de un panel de la vista dividida, el login se abre a pantalla completa y no adentro del panel.
  useEffect(() => {
    if (window.self !== window.top) window.top!.location.href = "/login";
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token, role, cambiarClave } = await api.login(email, password);
      api.setToken(token);
      if (cambiarClave) return nav("/cambiar-clave");
      nav(
        role === "ADMIN" ? "/dashboard" :
        role === "SUPERVISOR" ? "/mi-supervision" :
        role === "PROVEEDOR" ? "/mi-proveedor" :
        role === "SOCIO" ? "/mi-socio" :
        role === "SUBAGENTE" ? "/mi-subagente" :
        "/mi-cuenta"
      );
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
          <h1 className="login-reveal" style={{ animationDelay: ".45s" }}>Poker Gestión</h1>
          <p className="login-reveal" style={{ animationDelay: ".65s" }}>Sistema de gestión de agentes — club privado.</p>
          <div className="login-dots login-reveal" style={{ animationDelay: ".75s" }}>
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="login-form-panel">
          <LoginSwitch actual="poker" />
          {olvide ? (
            <>
              <h2>¿Olvidaste tu contraseña?</h2>
              <div className="sub">Escribí tu usuario. Le avisamos a quien te dio el acceso para que te pase una contraseña temporal.</div>
              <form onSubmit={pedirNueva}>
                <div className="field">
                  <label>Usuario</label>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="text" autoComplete="username" autoFocus />
                </div>
                {error && <div className="error">{error}</div>}
                {pedidoEnviado ? (
                  <div className="success">
                    <b>✓ Listo, pedido enviado.</b> Si el usuario existe, ya le avisamos a quien te lo creó. Cuando te pase la contraseña temporal,
                    entrá y elegí una propia.
                  </div>
                ) : (
                  <button className="btn" style={{ width: "100%" }} disabled={loading || email.trim().length < 2}>
                    {loading ? "Enviando..." : "Pedir contraseña nueva"}
                  </button>
                )}
              </form>
              <button type="button" className="login-olvide" onClick={() => { setOlvide(false); setPedidoEnviado(false); setError(""); }}>
                ‹ Volver a ingresar
              </button>
            </>
          ) : (
          <>
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
          <button type="button" className="login-olvide login-reveal" style={{ animationDelay: ".56s" }} onClick={() => { setOlvide(true); setError(""); }}>
            ¿Olvidaste tu contraseña?
          </button>
          </>
          )}
          <div className="footnote login-reveal" style={{ animationDelay: ".6s" }}>Acceso exclusivo — club privado</div>
        </div>
      </div>
    </div>
  );
}
