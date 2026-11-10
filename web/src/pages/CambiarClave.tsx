import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { api } from "../api";

// "Elegí tu contraseña" (10/11/2026, seguridad punto 2, mockup 88): aparece al entrar con una contraseña temporal (la puso otro: un admin,
// su supervisor o su agente). Hasta elegir la suya, el servidor no le deja hacer nada más (ver lib/auth.ts, cambiarClave del token).
function datosToken(): { role: string; email: string } | null {
  const t = api.getToken();
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { role: p.role, email: p.email ?? "" };
  } catch {
    return null;
  }
}

const inicio = (role: string) =>
  role === "ADMIN" ? "/dashboard" : role === "SUPERVISOR" ? "/mi-supervision" : role === "PROVEEDOR" ? "/mi-proveedor" : role === "SOCIO" ? "/mi-socio" : role === "SUBAGENTE" ? "/mi-subagente" : "/mi-cuenta";

export default function CambiarClave() {
  const nav = useNavigate();
  const datos = datosToken();
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  if (!datos) return <Navigate to="/login" replace />;

  const reglas = [
    { ok: nueva.length >= 8, txt: "Al menos 8 caracteres" },
    { ok: nueva.length > 0 && nueva.trim().toLowerCase() !== datos.email.trim().toLowerCase(), txt: "Distinta a tu usuario" },
    { ok: nueva.length > 0 && nueva === repetida, txt: "Las dos coinciden" },
  ];
  const todoOk = reglas.every((r) => r.ok);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await api.cambiarClave(nueva);
      api.setToken(r.token);
      nav(inicio(r.role), { replace: true });
    } catch (err: any) {
      setError(err.message || "No se pudo guardar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-hero-card cc-card">
        <div className="login-form-panel">
          <div className="cc-logo">P</div>
          <h2>Elegí tu contraseña</h2>
          <div className="sub">
            Hola, {datos.email}. Entraste con una contraseña temporal: elegí una propia para seguir. Nadie más la va a conocer.
          </div>
          <form onSubmit={guardar}>
            <div className="field">
              <label>Nueva contraseña</label>
              <input value={nueva} onChange={(e) => setNueva(e.target.value)} type={ver ? "text" : "password"} autoComplete="new-password" autoFocus />
            </div>
            <div className="field">
              <label>Repetila</label>
              <input value={repetida} onChange={(e) => setRepetida(e.target.value)} type={ver ? "text" : "password"} autoComplete="new-password" />
            </div>
            <label className="cc-ver">
              <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar contraseña
            </label>
            <div className="cc-reglas">
              {reglas.map((r) => (
                <div key={r.txt} className={r.ok ? "ok" : ""}>{r.ok ? "✓" : "•"} {r.txt}</div>
              ))}
            </div>
            {error && <div className="error">{error}</div>}
            <button className="btn" style={{ width: "100%" }} disabled={loading || !todoOk}>
              {loading ? "Guardando..." : "Guardar y entrar"}
            </button>
          </form>
          <button
            type="button"
            className="cc-salir"
            onClick={() => {
              api.clearToken();
              nav("/login", { replace: true });
            }}
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  );
}
