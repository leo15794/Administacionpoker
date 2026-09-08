import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";

const icon = {
  resumen: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M18.7 8 13 13.7l-3-3L4 16.6" />
    </svg>
  ),
  agentes: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  movimientos: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3v12" /><path d="M17 15 21 11" /><path d="M17 15 13 11" />
      <path d="M7 21V9" /><path d="M7 9 3 13" /><path d="M7 9l4 4" />
    </svg>
  ),
  cierres: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /><path d="m9 16 2 2 4-4" />
    </svg>
  ),
  usuarios: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  ),
  tesoreria: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3 6 1.5 6 4.5 0 1.4-1.3 2.5-3 2.5s-3-1.1-3-2.5" />
    </svg>
  ),
  cuenta: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  logout: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
    </svg>
  ),
};

export default function Shell({ role }: { role: "ADMIN" | "AGENT" }) {
  const nav = useNavigate();

  function logout() {
    api.clearToken();
    nav("/login");
  }

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <h1>DigiPlayers</h1>
            <div className="sub" style={{ marginBottom: 0, paddingLeft: 0 }}>
              {role === "ADMIN" ? "Panel administrativo" : "Portal de agente"}
            </div>
          </div>
        </div>

        <nav>
          {role === "ADMIN" ? (
            <>
              <NavLink to="/dashboard" end className="nav-link">{icon.resumen} Resumen</NavLink>
              <NavLink to="/dashboard/agentes" className="nav-link">{icon.agentes} Agentes</NavLink>
              <NavLink to="/dashboard/movimientos" className="nav-link">{icon.movimientos} Cargar movimiento</NavLink>
              <NavLink to="/dashboard/cierres" className="nav-link">{icon.cierres} Cierres semanales</NavLink>
              <NavLink to="/dashboard/tesoreria" className="nav-link">{icon.tesoreria} Tesorería</NavLink>
              <NavLink to="/dashboard/usuarios" className="nav-link">{icon.usuarios} Usuarios y permisos</NavLink>
            </>
          ) : (
            <NavLink to="/mi-cuenta" className="nav-link">{icon.cuenta} Mi cuenta</NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="btn secondary" onClick={logout} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {icon.logout} Cerrar sesión
          </button>
        </div>
      </div>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
