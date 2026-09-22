import { useEffect, useRef, useState } from "react";
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
  resumenClub: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
    </svg>
  ),
  jugadoresBancados: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="8" r="5" /><path d="M12 3v10" />
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
  garantias: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
  wallet: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /><circle cx="16" cy="15" r="1.5" />
    </svg>
  ),
  proveedores: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 7l2-4h14l2 4" /><path d="M9 11v3" /><path d="M15 11v3" />
    </svg>
  ),
  adelantos: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7" />
    </svg>
  ),
  rakebackPendiente: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
    </svg>
  ),
  cuenta: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  cuentasSocios: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" />
      <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" /><path d="M16 14a4 4 0 0 1 4 4v2" />
    </svg>
  ),
  stockDeudas: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.9 8.5 12 3 3.1 8.5v7L12 21l8.9-5.5z" /><path d="M3.1 8.5 12 14l8.9-5.5" /><path d="M12 14v7" />
    </svg>
  ),
  gananciasPeriodo: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M8 15l2.5 2.5L16 12" />
    </svg>
  ),
  liquidaciones: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  ),
  comisionesReferidos: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="m8 16 8-8" /><circle cx="9" cy="9" r="0.5" fill="currentColor" /><circle cx="15" cy="15" r="0.5" fill="currentColor" />
    </svg>
  ),
  resumenFinanciero: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" />
    </svg>
  ),
  logout: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
    </svg>
  ),
  collapse: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="m14 9-2 3 2 3" />
    </svg>
  ),
  expand: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d="m12 9 2 3-2 3" />
    </svg>
  ),
  sun: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  moon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  ),
};

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("dp_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage no disponible, sigue con el default */
  }
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function getInitialCollapsed() {
  try {
    return localStorage.getItem("dp_sidebar_collapsed") === "1";
  } catch {
    return false;
  }
}

// Ítems del menú de ADMIN, en su orden por default — se puede reordenar arrastrando (ver
// navOrder más abajo), y ese orden queda guardado por navegador (localStorage), no es una
// preferencia del usuario en la base — cada uno arma el menú a su gusto en su propia máquina.
const NAV_ITEMS: { key: string; to: string; end?: boolean; icon: keyof typeof icon; label: string; group: "operacion" | "plata" | "administracion" }[] = [
  { key: "resumen", to: "/dashboard", end: true, icon: "resumen", label: "Resumen", group: "operacion" },
  { key: "agentes", to: "/dashboard/agentes", icon: "agentes", label: "Administración", group: "administracion" },
  { key: "movimientos", to: "/dashboard/movimientos", icon: "movimientos", label: "Cargar movimiento", group: "operacion" },
  { key: "cierres", to: "/dashboard/cierres", icon: "cierres", label: "Cierres semanales", group: "operacion" },
  { key: "resumenClub", to: "/dashboard/resumen-club", icon: "resumenClub", label: "Resumen por club", group: "operacion" },
  { key: "jugadoresBancados", to: "/dashboard/jugadores-bancados", icon: "jugadoresBancados", label: "Jugadores bancados", group: "operacion" },
  { key: "wallet", to: "/dashboard/wallet", icon: "wallet", label: "Wallet", group: "plata" },
  { key: "tesoreria", to: "/dashboard/tesoreria", icon: "tesoreria", label: "Tesorería", group: "plata" },
  { key: "garantias", to: "/dashboard/garantias", icon: "garantias", label: "Garantías", group: "plata" },
  { key: "proveedores", to: "/dashboard/proveedores", icon: "proveedores", label: "Proveedores", group: "plata" },
  { key: "adelantos", to: "/dashboard/adelantos", icon: "adelantos", label: "Adelantos", group: "plata" },
  { key: "rakebackPendiente", to: "/dashboard/rakeback-pendiente", icon: "rakebackPendiente", label: "Rakeback pendiente", group: "plata" },
  { key: "cuentasSocios", to: "/dashboard/cuentas-socios", icon: "cuentasSocios", label: "Cuentas de socios", group: "plata" },
  { key: "gananciasPeriodo", to: "/dashboard/ganancias-por-periodo", icon: "gananciasPeriodo", label: "Ganancias por período", group: "plata" },
  { key: "liquidaciones", to: "/dashboard/liquidaciones", icon: "liquidaciones", label: "Liquidaciones", group: "plata" },
  { key: "stockDeudas", to: "/dashboard/stock-deudas", icon: "stockDeudas", label: "Stock y deudas", group: "plata" },
  { key: "usuarios", to: "/dashboard/usuarios", icon: "usuarios", label: "Usuarios y permisos", group: "administracion" },
  { key: "comisionesReferidos", to: "/dashboard/comisiones-referidos", icon: "comisionesReferidos", label: "Comisiones por referido", group: "plata" },
  { key: "resumenFinanciero", to: "/dashboard/resumen-financiero", icon: "resumenFinanciero", label: "Resumen financiero", group: "plata" },
];
const DEFAULT_NAV_ORDER = NAV_ITEMS.map((i) => i.key);

const NAV_GROUPS: { key: "operacion" | "plata" | "administracion"; label: string }[] = [
  { key: "operacion", label: "Operación" },
  { key: "plata", label: "Plata" },
  { key: "administracion", label: "Administración" },
];

function getInitialNavOrder(): string[] {
  try {
    const raw = localStorage.getItem("dp_nav_order");
    if (!raw) return DEFAULT_NAV_ORDER;
    const stored: string[] = JSON.parse(raw);
    // Si algún día se agrega/saca un ítem del menú, esto no lo pierde ni lo hace desaparecer:
    // descarta keys guardadas que ya no existen y agrega al final las nuevas que falten.
    const vigentes = stored.filter((k) => DEFAULT_NAV_ORDER.includes(k));
    const faltantes = DEFAULT_NAV_ORDER.filter((k) => !vigentes.includes(k));
    return [...vigentes, ...faltantes];
  } catch {
    return DEFAULT_NAV_ORDER;
  }
}

export default function Shell({ role }: { role: "ADMIN" | "AGENT" | "SUPERVISOR" }) {
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [navOrder, setNavOrder] = useState<string[]>(getInitialNavOrder);
  const dragKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  function moverNav(destinoKey: string) {
    const origenKey = dragKey.current;
    setDragOverKey(null);
    if (!origenKey || origenKey === destinoKey) return;
    const origenItem = NAV_ITEMS.find((i) => i.key === origenKey);
    const destinoItem = NAV_ITEMS.find((i) => i.key === destinoKey);
    if (!origenItem || !destinoItem || origenItem.group !== destinoItem.group) return;
    setNavOrder((prev) => {
      const next = prev.filter((k) => k !== origenKey);
      const idx = next.indexOf(destinoKey);
      next.splice(idx, 0, origenKey);
      try {
        localStorage.setItem("dp_nav_order", JSON.stringify(next));
      } catch {
        /* localStorage no disponible — el orden igual se aplica en esta sesión */
      }
      return next;
    });
  }

  function restablecerNavOrder() {
    setNavOrder(DEFAULT_NAV_ORDER);
    try {
      localStorage.removeItem("dp_nav_order");
    } catch {
      /* no pasa nada */
    }
  }

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((v) => {
      const next: Theme = v === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("dp_theme", next);
      } catch {
        /* localStorage no disponible, no pasa nada — el toggle igual funciona en esta sesión */
      }
      return next;
    });
  }

  function logout() {
    api.clearToken();
    nav("/login");
  }

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("dp_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* localStorage no disponible, no pasa nada */
      }
      return next;
    });
  }

  return (
    <div className="app-shell">
      <div className={`sidebar ${collapsed ? "collapsed" : ""}`}>
        <button
          className="sidebar-toggle"
          onClick={toggleCollapsed}
          title={collapsed ? "Expandir menú" : "Contraer menú"}
        >
          {collapsed ? icon.expand : icon.collapse}
        </button>

        <div className="brand">
          <div className="brand-mark">D</div>
          {!collapsed && (
            <div>
              <h1>DigiPlayers</h1>
              <div className="sub" style={{ marginBottom: 0, paddingLeft: 0 }}>
                {role === "ADMIN" ? "Panel administrativo" : role === "SUPERVISOR" ? "Portal de supervisor" : "Portal de agente"}
              </div>
            </div>
          )}
        </div>

        <nav>
          {role === "ADMIN" ? (
            <>
              {NAV_GROUPS.map((grupo) => {
                const keysDelGrupo = navOrder.filter((key) => NAV_ITEMS.find((i) => i.key === key)?.group === grupo.key);
                if (keysDelGrupo.length === 0) return null;
                return (
                  <div key={grupo.key} className="nav-section">
                    {!collapsed && <div className="nav-section-label">{grupo.label}</div>}
                    {keysDelGrupo.map((key) => {
                      const item = NAV_ITEMS.find((i) => i.key === key);
                      if (!item) return null;
                      return (
                        <div
                          key={item.key}
                          className={`nav-drag-item ${dragOverKey === item.key ? "drag-over" : ""}`}
                          draggable={!collapsed}
                          onDragStart={() => {
                            dragKey.current = item.key;
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (dragOverKey !== item.key) setDragOverKey(item.key);
                          }}
                          onDragLeave={() => setDragOverKey((k) => (k === item.key ? null : k))}
                          onDrop={(e) => {
                            e.preventDefault();
                            moverNav(item.key);
                          }}
                          onDragEnd={() => {
                            dragKey.current = null;
                            setDragOverKey(null);
                          }}
                        >
                          <NavLink to={item.to} end={item.end} draggable={false} className="nav-link" title={item.label}>
                            {!collapsed && <span className="nav-drag-handle" title="Arrastrar para reordenar">⠿</span>}
                            {icon[item.icon]} {!collapsed && item.label}
                          </NavLink>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {!collapsed && (
                <button
                  className="nav-link"
                  onClick={restablecerNavOrder}
                  style={{ width: "100%", textAlign: "left", background: "transparent", cursor: "pointer", font: "inherit", border: "none", opacity: 0.6, fontSize: 12 }}
                  title="Vuelve el menú al orden original"
                >
                  Restablecer orden del menú
                </button>
              )}
            </>
          ) : role === "SUPERVISOR" ? (
            <NavLink to="/mi-supervision" className="nav-link" title="Mi supervisión">{icon.cuenta} {!collapsed && "Mi supervisión"}</NavLink>
          ) : (
            <NavLink to="/mi-cuenta" className="nav-link" title="Mi cuenta">{icon.cuenta} {!collapsed && "Mi cuenta"}</NavLink>
          )}
          <button
            className="nav-link"
            onClick={toggleTheme}
            title={theme === "dark" ? "Modo día" : "Modo noche"}
            style={{ width: "100%", textAlign: "left", background: "transparent", cursor: "pointer", font: "inherit", borderTop: "1px solid var(--border)", borderLeft: "none", borderRight: "none", borderBottom: "none", marginTop: 8, paddingTop: 14 }}
          >
            {theme === "dark" ? icon.sun : icon.moon} {!collapsed && (theme === "dark" ? "Modo día" : "Modo noche")}
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            className="btn secondary"
            onClick={logout}
            title="Cerrar sesión"
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {icon.logout} {!collapsed && "Cerrar sesión"}
          </button>
        </div>
      </div>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
