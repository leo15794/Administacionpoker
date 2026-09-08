import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Shell({ role }: { role: "ADMIN" | "AGENT" }) {
  const nav = useNavigate();

  function logout() {
    api.clearToken();
    nav("/login");
  }

  return (
    <div className="app-shell">
      <div className="sidebar">
        <h1>DigiPlayers</h1>
        <div className="sub">{role === "ADMIN" ? "Panel administrativo" : "Portal de agente"}</div>
        {role === "ADMIN" ? (
          <>
            <NavLink to="/dashboard" className="nav-link">Resumen</NavLink>
            <NavLink to="/dashboard/agentes" className="nav-link">Agentes</NavLink>
            <NavLink to="/dashboard/movimientos" className="nav-link">Cargar movimiento</NavLink>
            <NavLink to="/dashboard/cierres" className="nav-link">Cierres semanales</NavLink>
          </>
        ) : (
          <NavLink to="/mi-cuenta" className="nav-link">Mi cuenta</NavLink>
        )}
        <div style={{ marginTop: 24 }}>
          <button className="btn secondary" onClick={logout} style={{ width: "100%" }}>Cerrar sesión</button>
        </div>
      </div>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
