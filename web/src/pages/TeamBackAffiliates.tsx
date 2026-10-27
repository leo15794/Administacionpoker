// TeamBack Affiliates V1 (25/09/2026, pedido de Leo) -- pantalla TOTALMENTE APARTE del resto
// del sistema (nada de agentes/clubes/liquidaciones de DigiPlayers). Programa de rakeback +
// referidos directo al jugador, sobre Suprema Poker.
// (25/09/2026, pedido de Leo: "necesito que hagamos usuarios y contraseña para esta seccion")
// -- esta pantalla tiene su PROPIO login (ver lib/tbAuth.ts y routes/teambackAuth.ts en el
// backend), totalmente aparte del login del resto del sistema -- aunque ya estés adentro de
// DigiPlayers como admin, para entrar acá hace falta un usuario/contraseña propio de esta
// sección. Dos roles: ADMIN (todo el control, las pestañas de siempre) y PLAYER (portal de
// autoservicio, ve solo su propia liquidación semana a semana).
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
// usdCents (19/10/2026): TeamBack maneja montos chicos, se muestran con 2 decimales (ver fmt.ts).
import { usdCents as usd, pct, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import Modal from "../components/Modal";
import Loading from "../components/Loading";
import ActionsMenu from "../components/ActionsMenu";
import TbIdleGuard from "../components/TbIdleGuard";
import CuentasJugadoresTab from "./TeamBackCuentas";
import TeamBackPruebaTab from "./TeamBackPrueba";
import { clearBadge } from "../badge";
import Cifra from "../components/Cifra";
import { usePaginado, WmPaginacion, WmTabs, WmSaldoCard, WmConteos, type WmTab } from "../components/ListaWm";
import LoginSwitch from "../components/LoginSwitch";
import { DockOverlay, useMenuFijo, useMenuPos } from "../components/MenuDock";
import { iconosPoker } from "../components/IconosPoker";
import { getInstallPromptEvent, onInstallPromptChange, isStandaloneDisplay, isIos } from "../installPrompt";
import { isPushSupported, getNotificationPermission, yaEstaSuscripto, activarNotificaciones } from "../notifications";

type Tab = "resumen" | "cuentas" | "jugadores" | "import" | "ganancia" | "config" | "usuarios" | "wallet" | "avisos" | "pagos" | "prueba";

const TB_SESSION_KEY = "tb_session";

// Cómo se pagó una liquidación: USDT, Fichas, o Compensación (descontada de la deuda del jugador, ver Cuentas de jugadores).
function etiquetaMedio(m: string | null | undefined): string {
  return m === "USDT" ? "USDT" : m === "COMPENSACION" ? "Compensación" : "Fichas";
}

interface TbSession {
  token: string;
  role: "ADMIN" | "PLAYER";
  name: string;
  playerId: string | null;
}

function leerTbSession(): TbSession | null {
  try {
    const raw = localStorage.getItem(TB_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.token || !s?.role) return null;
    return s;
  } catch {
    return null;
  }
}

function guardarTbSession(s: TbSession) {
  localStorage.setItem(TB_SESSION_KEY, JSON.stringify(s));
  localStorage.setItem("tb_token", s.token); // lo que lee requestTb()/requestFormTb() en api.ts
  // (09/10/2026, pedido de Leo: cierre de sesión por inactividad, ver TbIdleGuard.tsx) --
  // arranca el reloj de inactividad recién al loguearse de verdad, mismo criterio que
  // api.setToken() para el sistema principal.
  localStorage.setItem("tb_last_activity", String(Date.now()));
}

function cerrarTbSession() {
  localStorage.removeItem(TB_SESSION_KEY);
  localStorage.removeItem("tb_token");
  localStorage.removeItem("tb_last_activity");
}

// Modo dia/noche -- misma key de localStorage ("dp_theme") y mismo mecanismo (atributo
// data-theme en <html>) que Shell.tsx: es UN SOLO tema para todo el sistema, no uno por
// seccion. Se aplica ya en el componente raiz (mas abajo) para que Login y el portal del
// jugador tambien respeten el tema elegido, aunque el control para cambiarlo solo este en el
// sidebar de la vista ADMIN.
type TbTheme = "dark" | "light";

function leerTemaInicial(): TbTheme {
  try {
    const saved = localStorage.getItem("dp_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage no disponible, sigue con el default */
  }
  return "light";
}

function aplicarTema(theme: TbTheme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// (25/09/2026, pedido de Leo: "de paso pone el ojo para ver las contraseñas") -- toggle
// mostrar/ocultar, mismo campo en todos los formularios de contraseña de esta sección.
function CampoContrasena(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input {...props} type={visible ? "text" : "password"} style={{ paddingRight: 36, width: "100%", boxSizing: "border-box" }} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        style={{
          position: "absolute",
          right: 6,
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          fontSize: 15,
          lineHeight: 1,
        }}
      >
        {visible ? "🙈" : "👁"}
      </button>
    </div>
  );
}

export default function TeamBackAffiliates() {
  const [session, setSession] = useState<TbSession | null>(() => leerTbSession());

  useEffect(() => {
    aplicarTema(leerTemaInicial());
  }, []);

  // Número del ícono (23/10/2026): TeamBack cuenta los avisos recibidos desde la última vez que se abrió; al abrir la app (o volver a ella) se borra.
  useEffect(() => {
    if (!session) return;
    clearBadge();
    const alVolver = () => { if (document.visibilityState === "visible") clearBadge(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [session]);

  if (!session) return <TbLogin onLoggedIn={setSession} />;
  const cerrarSesion = () => { cerrarTbSession(); setSession(null); };
  return (
    <>
      {session.role === "PLAYER" ? (
        <TeamBackPortalJugador session={session} onLogout={cerrarSesion} />
      ) : (
        <TeamBackAdmin session={session} onLogout={cerrarSesion} />
      )}
      <TbIdleGuard onLogout={cerrarSesion} />
    </>
  );
}

// ===================================================================================
// Login propio de la sección
// ===================================================================================

function TbLogin({ onLoggedIn }: { onLoggedIn: (s: TbSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) return setError("Completá usuario y contraseña.");
    setLoading(true);
    try {
      const r = await api.teambackAuth.login(username.trim(), password);
      const s: TbSession = { token: r.token, role: r.role, name: r.name, playerId: r.playerId ?? null };
      guardarTbSession(s);
      onLoggedIn(s);
    } catch (err: any) {
      setError(err.message || "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  // (08/10/2026, pedido de Leo: "pasar la estetica que hicimos en poker administracion a
  // teamback afiliates") -- esta pantalla usaba .login-box/.login-mark, clases viejas que ya
  // no tienen ninguna regla en index.css desde el rediseño del login principal (quedó
  // literalmente sin estilo, por eso se veía como texto suelto). Se reemplaza por la MISMA
  // estructura que Login.tsx (login-hero-card, cartas cayendo, palos, reveal) -- ningún CSS
  // nuevo, reusa el que ya existe. Lo único propio de esta sección: usuario (no mail) y el ojo
  // para mostrar/ocultar contraseña (CampoContrasena).
  // FIX (08/10/2026, pedido de Leo): sacó el texto "Login propio de esta sección..." y
  // "sección aparte" del copy -- quedaba redundante/cargado visualmente. El título "TeamBack
  // Affiliates" queda en blanco puro acá (no en Login.tsx -- eso no se tocó).
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
          <div className="login-cards">
            <div className="login-card login-card--1">♠</div>
            <div className="login-card login-card--2">♥</div>
          </div>
          <h1 className="login-reveal" style={{ animationDelay: ".45s", color: "#fff" }}>TeamBack Affiliates</h1>
          <p className="login-reveal" style={{ animationDelay: ".65s" }}>Programa de rakeback y referidos.</p>
          <div className="login-dots login-reveal" style={{ animationDelay: ".75s" }}>
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="login-form-panel">
          <LoginSwitch actual="teamback" />
          <h2 className="login-reveal" style={{ animationDelay: ".2s" }}>Ingresar</h2>
          <form onSubmit={onSubmit}>
            <div className="field login-reveal" style={{ animationDelay: ".36s" }}>
              <label>Usuario</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
            </div>
            <div className="field login-reveal" style={{ animationDelay: ".44s" }}>
              <label>Contraseña</label>
              <CampoContrasena value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <div className="error login-reveal" style={{ animationDelay: "0s" }}>{error}</div>}
            <button className="btn login-reveal" style={{ width: "100%", animationDelay: ".52s" }} disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
          <div className="footnote login-reveal" style={{ animationDelay: ".6s" }}>Acceso exclusivo — TeamBack Affiliates</div>
        </div>
      </div>
    </div>
  );
}

// ===================================================================================
// Vista ADMIN (control total de la sección)
// ===================================================================================

// Iconos del sidebar de esta sección -- mismo estilo (16x16, stroke currentColor) que los de
// Shell.tsx, pero locales acá porque esta sección es TOTALMENTE APARTE del resto (ver comentario
// arriba del import de TeamBackAffiliates en App.tsx) y Shell.tsx no exporta los suyos.
const tbIcon = {
  liquidaciones: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      <path d="M9 15l2 2 4-4" />
    </svg>
  ),
  jugadores: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  import: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" />
    </svg>
  ),
  ganancia: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" />
    </svg>
  ),
  config: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  usuarios: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  ),
  wallet: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  ),
  avisos: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  pagos: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" />
    </svg>
  ),
  logout: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" />
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
  menu: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  ),
  close: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
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
};

// Con el menú arriba: lo de uso diario va suelto y el resto en "Más".
const TB_TOP_PRINCIPALES: Tab[] = ["resumen", "cuentas", "jugadores", "import", "pagos"];

// Íconos de póker del menú (opción "Mesa"); los que no tienen equivalente (configuración, avisos) siguen con el de siempre.
const TB_ICONO_POKER: Partial<Record<Tab, React.ReactNode>> = {
  resumen: iconosPoker.comisionesReferidos,
  cuentas: iconosPoker.jugadoresBancados,
  jugadores: iconosPoker.cuenta,
  import: iconosPoker.proveedores,
  ganancia: iconosPoker.resumenFinanciero,
  usuarios: iconosPoker.usuarios,
  wallet: iconosPoker.wallet,
  pagos: iconosPoker.resumenAgentes,
  prueba: iconosPoker.usuarios,
};

const TB_NAV: { key: Tab; label: string; icon: keyof typeof tbIcon }[] = [
  { key: "resumen", label: "Liquidaciones", icon: "liquidaciones" },
  { key: "cuentas", label: "Cuentas de jugadores", icon: "pagos" },
  { key: "jugadores", label: "Jugadores / árbol", icon: "jugadores" },
  { key: "import", label: "Importar semana", icon: "import" },
  { key: "ganancia", label: "Ganancia por semana", icon: "ganancia" },
  { key: "config", label: "Configuración (plantilla)", icon: "config" },
  { key: "usuarios", label: "Usuarios", icon: "usuarios" },
  { key: "wallet", label: "Wallet (espejo)", icon: "wallet" },
  { key: "avisos", label: "Avisos", icon: "avisos" },
  { key: "pagos", label: "Historial de pagos", icon: "pagos" },
  { key: "prueba", label: "Cuenta de prueba", icon: "usuarios" },
];

// (25/09/2026, pedido de Leo: "hagamos el menu como la administracion de poker") -- mismo
// esquema visual que Shell.tsx (.app-shell / .sidebar / .nav-link), pero acá la navegación es
// por tab de estado (no por ruta react-router): esta sección sigue siendo una sola ruta
// (/teamback) con su propio login aparte, así que los ítems del menú son <button> con la clase
// "nav-link" en vez de <NavLink>, ver ".nav-link" reseteado para <button> en index.css.
function TeamBackAdmin({ session, onLogout }: { session: TbSession; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("resumen");
  // Mismo menú que el sistema principal (21/10/2026, pedido de Leo): compacto con íconos que se abre con el mouse (o fijo abierto) y acoplable a la izquierda o arriba.
  const { fijo, alternarFijo } = useMenuFijo();
  const { pos, arrastrando, empezarArrastre } = useMenuPos(() => setMasAbierto(false));
  const [masAbierto, setMasAbierto] = useState(false);
  useEffect(() => {
    if (!masAbierto) return;
    const fuera = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest(".topnav")) setMasAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [masAbierto]);
  const [theme, setTheme] = useState<TbTheme>(leerTemaInicial);
  // Drawer del menú en celular (19/10/2026): hasta hoy esta sección no tenía el botón de menú que
  // sí tiene el sistema principal (Shell.tsx), así que en <=768px el sidebar quedaba fuera de
  // pantalla y no había forma de abrirlo. Mismas clases/CSS que Shell (.mobile-topbar, etc.).
  const [mobileOpen, setMobileOpen] = useState(false);
  // Lugar en el encabezado donde Liquidaciones pone el selector de semanas (ver createPortal).
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  const tabActual = TB_NAV.find((i) => i.key === tab);

  useEffect(() => {
    aplicarTema(theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((v) => {
      const next: TbTheme = v === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("dp_theme", next);
      } catch {
        /* localStorage no disponible, el toggle igual funciona en esta sesion */
      }
      return next;
    });
  }

  return (
    <div className={`app-shell ${pos === "top" ? "menu-top" : ""}`}>
      <DockOverlay arrastrando={arrastrando} />
      <header className="topnav">
        <div className="tn-brand" onPointerDown={empezarArrastre} title="Arrastrá hasta el borde izquierdo para mover el menú">
          <div className="brand-mark" aria-hidden="true">T</div>
          <b>TeamBack Affiliates</b>
        </div>
        <nav className="tn-links">
          {TB_NAV.filter((i) => TB_TOP_PRINCIPALES.includes(i.key)).map((item) => (
            <div key={item.key} className={`tn-g ${tab === item.key ? "on" : ""}`}>
              <button type="button" onClick={() => { setTab(item.key); setMasAbierto(false); }}>{item.label}</button>
            </div>
          ))}
          <div className={`tn-g ${TB_NAV.some((i) => !TB_TOP_PRINCIPALES.includes(i.key) && i.key === tab) ? "on" : ""} ${masAbierto ? "open" : ""}`}>
            <button type="button" onClick={() => setMasAbierto((v) => !v)}>Más <span className="tn-chev">▾</span></button>
            {masAbierto && (
              <div className="tn-dd">
                {TB_NAV.filter((i) => !TB_TOP_PRINCIPALES.includes(i.key)).map((item) => (
                  <button key={item.key} type="button" className={`tn-item ${tab === item.key ? "active" : ""}`} style={{ width: "100%", border: 0, background: "transparent", font: "inherit", textAlign: "left", cursor: "pointer" }} onClick={() => { setTab(item.key); setMasAbierto(false); }}>
                    {TB_ICONO_POKER[item.key] ?? tbIcon[item.icon]} {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="tn-right">
          <span className="tn-rol">{session.name}</span>
          <button className="btn secondary sidebar-tema" onClick={toggleTheme} title={theme === "dark" ? "Modo día" : "Modo noche"} aria-label={theme === "dark" ? "Modo día" : "Modo noche"}>
            {theme === "dark" ? tbIcon.sun : tbIcon.moon}
          </button>
          <button className="btn secondary" onClick={onLogout} title="Cerrar sesión">
            {tbIcon.logout} Cerrar sesión
          </button>
        </div>
      </header>
      <div className="mobile-topbar">
        <button className="mobile-nav-toggle" onClick={() => setMobileOpen(true)} title="Abrir menú" aria-label="Abrir menú">
          {tbIcon.menu}
        </button>
        <div className="brand-text">
          <div className="t1">TeamBack Affiliates</div>
          <div className="t2">Panel administrativo</div>
        </div>
      </div>
      <div className={`sidebar-backdrop ${mobileOpen ? "show" : ""}`} onClick={() => setMobileOpen(false)} />
      <div className={`sidebar ${fijo ? "" : "rail"} ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark brand-mark-drag" onPointerDown={empezarArrastre} title="Arrastrá hasta el borde de arriba para mover el menú">T</div>
          <div className="brand-info">
            <h1>TeamBack</h1>
            <div className="sub" style={{ marginBottom: 0, paddingLeft: 0 }}>Affiliates</div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={alternarFijo}
            title={fijo ? "Volver a compacto (se abre al pasar el mouse)" : "Dejar el menú abierto"}
          >
            {fijo ? tbIcon.collapse : tbIcon.expand}
          </button>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} title="Cerrar menú" aria-label="Cerrar menú">
            {tbIcon.close}
          </button>
        </div>

        <nav>
          <div className="nav-section">
            {TB_NAV.map((item) => (
              <button
                key={item.key}
                className={`nav-link ${tab === item.key ? "active" : ""}`}
                onClick={() => {
                  setTab(item.key);
                  setMobileOpen(false);
                }}
                title={item.label}
              >
                {TB_ICONO_POKER[item.key] ?? tbIcon[item.icon]} {item.label}
              </button>
            ))}
          </div>
          <button
            className="nav-link"
            onClick={toggleTheme}
            title={theme === "dark" ? "Modo día" : "Modo noche"}
            style={{ borderTop: "1px solid var(--border)", borderLeft: "none", borderRight: "none", borderBottom: "none", marginTop: 8, paddingTop: 14 }}
          >
            {theme === "dark" ? tbIcon.sun : tbIcon.moon} {theme === "dark" ? "Modo día" : "Modo noche"}
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="muted tb-sess-name" style={{ fontSize: 12, marginBottom: 8, paddingLeft: 4 }}>{session.name}</div>
          <button
            className="btn secondary sidebar-salir"
            onClick={onLogout}
            title="Cerrar sesión"
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {tbIcon.logout} Cerrar sesión
          </button>
        </div>
      </div>

      <div className="main">
        <div className="topbar tb-topbar">
          <div>
            <h2>{tabActual?.label}</h2>
            {tab !== "resumen" && (
              <div className="muted" style={{ fontSize: 13 }}>
                Programa de rakeback + referidos directo al jugador — Suprema Poker. Sección aparte, no toca nada del resto del sistema.
              </div>
            )}
          </div>
          <div className="tb-topbar-slot" ref={setTopbarSlot} />
        </div>

        {tab === "resumen" && <LiquidacionesTab topbarSlot={topbarSlot} />}
        {tab === "cuentas" && <CuentasJugadoresTab />}
        {tab === "jugadores" && <JugadoresTab />}
        {tab === "import" && <ImportTab />}
        {tab === "ganancia" && <GananciaSemanalTab />}
        {tab === "config" && <ConfigTab />}
        {tab === "usuarios" && <UsuariosTab />}
        {tab === "wallet" && <WalletEspejoTab />}
        {tab === "avisos" && <AvisosTab />}
        {tab === "pagos" && <HistorialPagosTab />}
        {tab === "prueba" && <TeamBackPruebaTab />}
      </div>
    </div>
  );
}

// ===================================================================================
// Portal del jugador (autoservicio, solo lectura de su propia liquidación)
// ===================================================================================

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

// Instalar como app (13/10/2026, pedido de Leo, ver mockup que aprobó: banner con botón
// "Instalar" debajo del saludo). En Android/Chrome/Edge dispara el prompt nativo de
// instalación; Safari/iOS nunca ofrece ese evento, ahí el mismo botón abre instrucciones
// manuales (Compartir -> Agregar a inicio -> Agregar). No se muestra si ya está instalada
// (display-mode: standalone / navigator.standalone) ni si el usuario la cerró con la X
// (se guarda en localStorage, no vuelve a aparecer en ese dispositivo).
function InstallAppBanner() {
  const [promptEvent, setPromptEvent] = useState(() => getInstallPromptEvent());
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("tb_install_dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [showIosHelp, setShowIosHelp] = useState(false);
  const standalone = isStandaloneDisplay();
  const ios = isIos();

  useEffect(() => onInstallPromptChange(setPromptEvent), []);

  if (standalone || dismissed) return null;
  // Sin el evento de Chrome/Android y sin ser iOS no hay nada que ofrecer (ej. Firefox mobile,
  // que no soporta instalación) -- no mostrar un botón que no va a hacer nada.
  if (!ios && !promptEvent) return null;

  async function onInstall() {
    if (ios) {
      setShowIosHelp(true);
      return;
    }
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
  }

  function onDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem("tb_install_dismissed", "1");
    } catch {
      /* localStorage no disponible, no pasa nada -- solo vuelve a aparecer la próxima vez */
    }
  }

  return (
    <>
      <div className="tb-install-banner">
        <button className="tb-install-dismiss" onClick={onDismiss} aria-label="Cerrar">✕</button>
        <div className="tb-install-icon">⬇</div>
        <div className="tb-install-text">
          <div className="t1">Instalá la app</div>
          <div className="t2">Acceso directo desde tu pantalla de inicio, sin abrir el navegador</div>
        </div>
        <button className="tb-install-btn" onClick={onInstall}>Instalar</button>
      </div>
      {showIosHelp && (
        <Modal title="Para instalar en iPhone" onClose={() => setShowIosHelp(false)}>
          <ol style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 14, margin: 0 }}>
            <li>Tocá el botón <strong>Compartir</strong> (el ícono con la flecha hacia arriba, en la barra de abajo de Safari)</li>
            <li>Elegí <strong>"Agregar a inicio"</strong></li>
            <li>Tocá <strong>"Agregar"</strong> arriba a la derecha</li>
          </ol>
        </Modal>
      )}
    </>
  );
}

// Activar notificaciones (13/10/2026, pedido de Leo) -- banner separado del de instalar (ver
// InstallAppBanner arriba): en Android/desktop funciona instalada o no, pero en iPhone Apple
// exige que la app ya esté instalada en la pantalla de inicio para poder activarlas -- por eso
// ahí este banner queda oculto hasta que isStandaloneDisplay() sea true (el de instalar ya se
// encarga de ese paso previo). Una vez que el usuario ya está suscripto, o si el permiso quedó
// denegado del lado del navegador, no tiene sentido seguir mostrando el botón.
function NotificationsBanner() {
  const [estado, setEstado] = useState<"cargando" | "ofrecer" | "suscripto" | "denegado" | "oculto">("cargando");
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("tb_notif_dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [activando, setActivando] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isPushSupported()) return setEstado("oculto");
      if (isIos() && !isStandaloneDisplay()) return setEstado("oculto"); // iPhone: primero instalar
      const permiso = getNotificationPermission();
      if (permiso === "denied") return setEstado("denegado");
      if (await yaEstaSuscripto()) return setEstado("suscripto");
      setEstado("ofrecer");
    })();
  }, []);

  function onDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem("tb_notif_dismissed", "1");
    } catch {
      /* no pasa nada -- solo vuelve a aparecer la próxima vez */
    }
  }

  async function onActivar() {
    setActivando(true);
    try {
      const r = await activarNotificaciones();
      if (r === "ok") setEstado("suscripto");
      else if (r === "denegado") setEstado("denegado");
    } finally {
      setActivando(false);
    }
  }

  if (estado === "cargando" || estado === "oculto" || estado === "suscripto" || dismissed) return null;

  return (
    <div className="tb-install-banner">
      <button className="tb-install-dismiss" onClick={onDismiss} aria-label="Cerrar">✕</button>
      <div className="tb-install-icon">🔔</div>
      <div className="tb-install-text">
        <div className="t1">{estado === "denegado" ? "Notificaciones bloqueadas" : "Activá las notificaciones"}</div>
        <div className="t2">
          {estado === "denegado"
            ? "Las bloqueaste antes -- para activarlas tenés que habilitarlas desde los ajustes del navegador."
            : "Enterate apenas se calcule o te paguemos tu liquidación."}
        </div>
      </div>
      {estado === "ofrecer" && (
        <button className="tb-install-btn" onClick={onActivar} disabled={activando}>
          {activando ? "..." : "Activar"}
        </button>
      )}
    </div>
  );
}

function TeamBackPortalJugador({ session, onLogout }: { session: TbSession; onLogout: () => void }) {
  const [cuenta, setCuenta] = useState<any | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  // (09/10/2026, pedido de Leo: "lo mejor seria que se despliegue abajo y se pueda ver los
  // jugadores") -- antes abria un Modal; ahora la semana elegida se despliega inline, debajo de
  // su propia fila (ver la tabla mas abajo). null = ninguna semana desplegada.
  const [expandida, setExpandida] = useState<string | null>(null);

  useEffect(() => {
    api.teamback.portal.miCuenta().then(setCuenta);
    api.teamback.portal.historial().then(setHistorial);
  }, []);

  const nombreJugador = cuenta?.name || session.name;
  const totalHistorico = historial.reduce((acc, l) => acc + Number(l.total_acreditado), 0);
  const totalPagado = historial.filter((l) => l.pagado).reduce((acc, l) => acc + Number(l.total_acreditado), 0);
  const totalPendiente = totalHistorico - totalPagado;
  const referidosActivosUltimaSemana = historial[0]?.referidos_activos_count ?? 0;
  // Próximo escalón de rakeback (19/10/2026): usa los umbrales que ya quedaron guardados en la
  // liquidación más reciente (config_snapshot) -- nada nuevo en el backend. Hay dos caminos y
  // alcanza con uno (ver engine/teambackAffiliates.ts, calcularEscalonRakeback).
  const escalonSiguiente = (() => {
    const u = historial[0];
    const c = u?.config_snapshot;
    if (!u || !c) return null;
    const actual = Number(u.rakeback_pct);
    const meta =
      actual < Number(c.pctTier2) - 1e-9
        ? { pct: Number(c.pctTier2), refsMeta: Number(c.umbralReferidosTier2), rakeMeta: Number(c.umbralVolumenTier2Usd) }
        : actual < Number(c.pctTier3) - 1e-9
          ? { pct: Number(c.pctTier3), refsMeta: Number(c.umbralReferidosTier3), rakeMeta: Number(c.umbralVolumenTier3Usd) }
          : null;
    if (!meta) return null;
    return { ...meta, refs: Number(u.referidos_activos_count), rake: Number(u.rake_propio) };
  })();
  const isMobile = useIsMobile();
  // En celular, la semana más reciente arranca desplegada (con el desglose por referido ya a la
  // vista) -- 19/10/2026, mockup aprobado. Solo la primera vez que llega el historial.
  useEffect(() => {
    if (isMobile && historial.length > 0) setExpandida((cur) => cur ?? String(historial[0].week_start).slice(0, 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historial, isMobile]);

  return (
    <div className="page tb-portal-jugador">
      <div className="welcome-row">
        <div>
          <div className="eyebrow">TeamBack Affiliates</div>
          <h1 className="greeting">¡Hola, {nombreJugador}! 👋</h1>
        </div>
        <div className="welcome-actions">
          {cuenta && <span className="id-tag">ID Suprema {cuenta.suprema_player_id}</span>}
          <button className="btn secondary small" onClick={onLogout}>Cerrar sesión</button>
        </div>
      </div>

      <InstallAppBanner />
      <NotificationsBanner />

      {historial.length > 0 && (
        <>
          {/* (19/10/2026, mockup aprobado) Una cifra manda: lo que falta cobrar. Antes eran 4
              tarjetas del mismo peso y "Pendiente" salía en rojo -- para el jugador es plata a
              su favor, no un error. */}
          <div className="tb-hero">
            <div className="tb-hero-label">{totalPendiente > 0.004 ? "Te falta cobrar" : "Estás al día"}</div>
            <div className={`tb-hero-amount${totalPendiente > 0.004 ? "" : " ok"}`}><Cifra texto={usd(totalPendiente > 0.004 ? totalPendiente : totalPagado)} /></div>
            <div className="tb-bar">
              <i style={{ width: `${totalHistorico > 0 ? Math.min(100, (totalPagado / totalHistorico) * 100) : 0}%`, background: "var(--green)" }} />
            </div>
            <div className="tb-hero-foot">
              <span>Cobrado {usd(totalPagado)}</span>
              <span>
                {historial.length} semana{historial.length === 1 ? "" : "s"} liquidada{historial.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="label">Total histórico</div>
              <div className="value"><Cifra texto={usd(totalHistorico)} retraso={150} /></div>
            </div>
            <div className="kpi-card">
              <div className="label">Escalón actual</div>
              <div className="value">{pctTxt(historial[0].rakeback_pct)}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{referidosActivosUltimaSemana} referido{referidosActivosUltimaSemana === 1 ? "" : "s"} activo{referidosActivosUltimaSemana === 1 ? "" : "s"}</div>
            </div>
          </div>
          {escalonSiguiente ? (
            <div className="tb-camino">
              <div className="tb-camino-head">
                <div className="t">Camino al {pctTxt(escalonSiguiente.pct)}</div>
                <span className="pill gold">Próximo escalón</span>
              </div>
              <div className="tb-camino-row">
                <span>Referidos activos</span>
                <b>{escalonSiguiente.refs} de {escalonSiguiente.refsMeta}</b>
              </div>
              <div className="tb-bar"><i style={{ width: `${Math.min(100, (escalonSiguiente.refs / escalonSiguiente.refsMeta) * 100)}%` }} /></div>
              <div className="tb-camino-row">
                <span>o rake propio</span>
                <b>{usd(escalonSiguiente.rake)} de US$ {escalonSiguiente.rakeMeta.toLocaleString("es-AR")}</b>
              </div>
              <div className="tb-bar"><i style={{ width: `${Math.min(100, (escalonSiguiente.rake / escalonSiguiente.rakeMeta) * 100)}%` }} /></div>
              <div className="liq-sub" style={{ marginTop: 8 }}>
                Según tu última semana liquidada ({diaMes(historial[0].week_start)} al {diaMes(historial[0].week_end)}). Alcanza con cumplir uno de los dos.
              </div>
            </div>
          ) : (
            <div className="tb-camino">
              <div className="tb-camino-head">
                <div className="t">¡Estás en el escalón más alto!</div>
                <span className="pill g">{pctTxt(historial[0].rakeback_pct)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {isMobile ? (
        <div className="week-list">
          {historial.map((l) => {
            const weekKey = String(l.week_start).slice(0, 10);
            const abierta = expandida === weekKey;
            return (
              <div className={`week-card${abierta ? " open" : ""}${l.pagado ? " pagada" : " pendiente"}`} key={l.id}>
                <div className="week-head" onClick={() => setExpandida(abierta ? null : weekKey)}>
                  <div className="dates">
                    {dateShort(l.week_start)} al {dateShort(l.week_end)}
                    <span className="foot">
                      {l.referidos_activos_count} referido{l.referidos_activos_count === 1 ? "" : "s"} · escalón {pctTxt(l.rakeback_pct)}
                    </span>
                  </div>
                  <div className="right">
                    <div className="total">{usd(l.total_acreditado)}</div>
                    <div className="chev">▾</div>
                  </div>
                </div>
                <div className="badge-row">
                  {l.pagado ? (
                    <span className="pill g" title={l.paid_at ? `Pagada el ${dateShort(l.paid_at)}` : undefined}>
                      Pagado{l.medio_pago ? ` (${etiquetaMedio(l.medio_pago)})` : ""}
                    </span>
                  ) : (
                    <span className="pill a">Por cobrar</span>
                  )}
                  {l.comision_3pct_pausada && (
                    <span className="badge neg" title="No tuviste actividad propia en la ventana de semanas configurada -- comisión pausada esta semana.">
                      pausada
                    </span>
                  )}
                </div>
                {abierta && (
                  <div className="detail">
                    <div className="item">
                      <div className="label">Rake propio</div>
                      <div className="val">{usd(l.rake_propio)}</div>
                    </div>
                    <div className="item">
                      <div className="label">Rakeback</div>
                      <div className="val">{usd(l.rakeback_generado)}</div>
                    </div>
                    <div className="item span2">
                      <div className="label">Comisión 3%</div>
                      <div className="val">{usd(l.comision_3pct_acreditada)}</div>
                    </div>
                    <div className="item span2">
                      <MiLiquidacionSemana weekStart={weekKey} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {historial.length === 0 && (
            <div className="muted" style={{ padding: "4px 2px" }}>Todavía no tenés ninguna liquidación calculada.</div>
          )}
        </div>
      ) : (
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th className="num">Rake propio</th>
                <th className="num">Referidos activos</th>
                <th className="num">Escalón</th>
                <th className="num">Rakeback</th>
                <th className="num">Comisión 3%</th>
                <th className="num">Total</th>
                <th>Pago</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {historial.map((l) => {
                const weekKey = String(l.week_start).slice(0, 10);
                const abierta = expandida === weekKey;
                return (
                  <Fragment key={l.id}>
                    <tr>
                      <td>{dateShort(l.week_start)} al {dateShort(l.week_end)}</td>
                      <td className="num">{usd(l.rake_propio)}</td>
                      <td className="num">{l.referidos_activos_count}</td>
                      <td className="num">
                        {pct(l.rakeback_pct)}{" "}
                        <span className="muted" style={{ fontSize: 11 }}>
                          ({l.tier_alcanzado_por === "BASE" ? "base" : l.tier_alcanzado_por === "VOLUMEN" ? "volumen" : "referidos"})
                        </span>
                      </td>
                      <td className="num">{usd(l.rakeback_generado)}</td>
                      <td className="num">
                        {usd(l.comision_3pct_acreditada)}
                        {l.comision_3pct_pausada && (
                          <span className="badge neg" style={{ marginLeft: 6, fontSize: 10 }} title="No tuviste actividad propia en la ventana de semanas configurada -- comisión pausada esta semana.">
                            pausada
                          </span>
                        )}
                      </td>
                      <td className="num"><strong>{usd(l.total_acreditado)}</strong></td>
                      <td>
                        {l.pagado ? (
                          <span className="pill g" title={l.paid_at ? `Pagada el ${dateShort(l.paid_at)}` : undefined}>
                            Pagado{l.medio_pago ? ` (${etiquetaMedio(l.medio_pago)})` : ""}
                          </span>
                        ) : (
                          <span className="pill a">Por cobrar</span>
                        )}
                      </td>
                      <td>
                        <button className="btn secondary small" onClick={() => setExpandida(abierta ? null : weekKey)}>
                          {abierta ? "Ocultar" : "Ver"}
                        </button>
                      </td>
                    </tr>
                    {abierta && (
                      <tr>
                        <td colSpan={9} style={{ background: "var(--bg-soft, rgba(255,255,255,0.03))" }}>
                          <MiLiquidacionSemana weekStart={weekKey} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">Todavía no tenés ninguna liquidación calculada.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

// (09/10/2026, pedido de Leo: "deberiamos poder ver el desglose de cada jugador y que generó
// para que el lo pueda ver") -- analogo a LiquidacionIndividual (vista admin) mas abajo, pero
// pide el endpoint del PORTAL (siempre scopeado a uno mismo del lado del backend, nunca a un
// playerId elegido acá) para que el propio jugador vea, semana por semana, el desglose de lo que
// generó cada uno de sus referidos.
function MiLiquidacionSemana({ weekStart }: { weekStart: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    api.teamback.portal.liquidacionSemana(weekStart).then(setData);
  }, [weekStart]);

  if (!data) return <Loading />;
  return <BloqueLiquidacionCopiable liquidacion={data.liquidacion} referidos={data.referidos} soloReferidos />;
}

// ===================================================================================
// Liquidaciones
// ===================================================================================

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// Helpers de presentación de Liquidaciones / portal (19/10/2026).
function diaMes(d: string) {
  const [, m, dd] = String(d).slice(0, 10).split("-");
  return `${dd}/${m}`;
}
function pctTxt(p: number | string) {
  return `${Number((Number(p) * 100).toFixed(2))}%`;
}
function origenEscalon(t: string) {
  return t === "BASE" ? "base" : t === "VOLUMEN" ? "volumen" : "referidos";
}
function EscalonPill({ l }: { l: any }) {
  return (
    <span className={`pill${l.tier_alcanzado_por === "BASE" ? "" : " gold"}`} title={`Escalón de rakeback alcanzado por ${origenEscalon(l.tier_alcanzado_por)}`}>
      {pctTxt(l.rakeback_pct)} · {origenEscalon(l.tier_alcanzado_por)}
    </span>
  );
}
function EstadoPill({ l }: { l: any }) {
  return l.pagado ? (
    <>
      <span className="pill g" title={l.paid_at ? `Pagada el ${dateShort(l.paid_at)}` : undefined}>
        Pagado · {etiquetaMedio(l.medio_pago)}
      </span>
      {l.paid_at && <div className="liq-sub">{diaMes(l.paid_at)}</div>}
    </>
  ) : (
    <>
      <span className="pill a">Pendiente de pago</span>
      {Number(l.compensado) > 0 && <div className="liq-sub">Compensó {usd(l.compensado)} de la deuda · a pagar {usd(Number(l.total_acreditado) - Number(l.compensado))}</div>}
    </>
  );
}

function LiquidacionesTab({ topbarSlot }: { topbarSlot: HTMLElement | null }) {
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [filas, setFilas] = useState<any[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [individual, setIndividual] = useState<any | null>(null);
  const [sinConfigurar, setSinConfigurar] = useState<{ playerId: string; playerName: string; supremaPlayerId: string }[]>([]);
  const [eliminando, setEliminando] = useState(false);
  const [pagandoId, setPagandoId] = useState<string | null>(null);
  // (09/10/2026, pedido de Leo: "que aparezcan en USDT o en Fichas") -- liquidación para la que
  // se está eligiendo el medio de pago (ver Modal + FormPagarLiquidacion, más abajo). null =
  // ningún modal de pago abierto.
  const [pagando, setPagando] = useState<any | null>(null);
  // Notificaciones push (13/10/2026, pedido de Leo) -- TODAS manuales, ningún push se manda
  // solo. notificando guarda qué botón está en curso ("semana" | "referidos" | el id de una
  // liquidación puntual) para deshabilitar solo ESE botón mientras tarda.
  const [notificando, setNotificando] = useState<string | null>(null);
  // Vista (19/10/2026, mockup aprobado): filtro por estado de pago y panel de "Semana nueva…".
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "pendientes" | "pagados">("todos");
  const [buscaLiq, setBuscaLiq] = useState("");
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [nuevaInicio, setNuevaInicio] = useState("");
  const [nuevaFin, setNuevaFin] = useState("");

  async function notificarLiquidacionSemana() {
    if (!weekStart) return;
    setNotificando("semana");
    setMsg(null);
    try {
      const r = await api.teamback.push.notificarLiquidacionCerrada(weekStart);
      setMsg({ ok: true, text: `Notificados ${r.jugadoresNotificados} jugador(es) -- ${r.pushEnviados} push enviados.` });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo notificar." });
    } finally {
      setNotificando(null);
    }
  }

  async function notificarReferidosActivosSemana() {
    if (!weekStart) return;
    setNotificando("referidos");
    setMsg(null);
    try {
      const r = await api.teamback.push.notificarReferidosActivos(weekStart);
      setMsg({ ok: true, text: `Notificados ${r.referentesNotificados} referente(s) -- ${r.pushEnviados} push enviados.` });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo notificar a los referentes." });
    } finally {
      setNotificando(null);
    }
  }

  async function notificarPago(f: any) {
    setNotificando(f.id);
    setMsg(null);
    try {
      const r = await api.teamback.push.notificarLiquidacionPagada(f.id);
      setMsg({ ok: true, text: `${r.jugador} notificado -- ${r.pushEnviados} push enviados.` });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo notificar el pago." });
    } finally {
      setNotificando(null);
    }
  }

  // seleccion: semana a dejar elegida (por ejemplo, la que se acaba de recalcular). Sin ella, la más
  // reciente -- igual que antes.
  async function cargarSemanas(seleccion?: string) {
    const r = await api.teamback.semanasDisponibles();
    setSemanas(r);
    const claves = r.map((x: any) => String(x.week_start).slice(0, 10));
    const elegida = seleccion && claves.includes(seleccion) ? seleccion : claves[0];
    if (elegida) {
      setWeekStart(elegida);
      cargarFilas(elegida);
    }
  }

  async function cargarFilas(ws: string) {
    if (!ws) return;
    setFilas(await api.teamback.liquidacionesSemana(ws));
  }

  useEffect(() => {
    cargarSemanas();
  }, []);

  async function calcular(ws: string, we: string) {
    if (!ws || !we) return setMsg({ ok: false, text: "Elegí fecha de inicio y fin de semana." });
    setCalculando(true);
    setMsg(null);
    try {
      const r = await api.teamback.calcularLiquidaciones(ws, we);
      setFiltroEstado("todos");
      setSinConfigurar(r.sinConfigurar ?? []);
      const avisoSinConfigurar = r.sinConfigurar?.length > 0 ? ` (${r.sinConfigurar.length} jugador(es) salteado(s) por no tener % configurado todavía -- ver abajo)` : "";
      setMsg({ ok: true, text: `Calculado -- ${r.resultados.length} jugador(es) con liquidación esta semana.${avisoSinConfigurar}` });
      await cargarSemanas(ws);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo calcular." });
    } finally {
      setCalculando(false);
    }
  }

  // "Calcular / recalcular" recalcula la semana elegida arriba (mismas fechas que ya tiene
  // guardadas); para una semana que todavía no existe se usa "Semana nueva…".
  function recalcularSeleccionada() {
    const sem = semanas.find((x) => String(x.week_start).slice(0, 10) === weekStart);
    if (!sem) {
      setNuevaAbierta(true);
      return;
    }
    calcular(weekStart, String(sem.week_end).slice(0, 10));
  }

  async function calcularNueva() {
    await calcular(nuevaInicio, nuevaFin);
    setNuevaAbierta(false);
    setNuevaInicio("");
    setNuevaFin("");
  }

  // (25/09/2026, pedido de Leo: "botones para eliminar cierres de la semana ya que ahora
  // estamos haciendo pruebas") -- borra la liquidación Y el rake importado de esa semana, para
  // poder reimportar/recalcular desde cero sin arrastrar nada de la prueba anterior.
  async function eliminarSemanaActual() {
    if (!weekStart) return;
    const etiqueta = semanas.find((s) => String(s.week_start).slice(0, 10) === weekStart);
    const confirmado = window.confirm(
      `¿Eliminar el cierre de la semana del ${dateShort(weekStart)}${etiqueta ? ` al ${dateShort(etiqueta.week_end)}` : ""}?

Esto borra la liquidación calculada Y el rake importado de esa semana. No se puede deshacer.`
    );
    if (!confirmado) return;
    setEliminando(true);
    setMsg(null);
    try {
      const r = await api.teamback.eliminarSemana(weekStart);
      setMsg({ ok: true, text: `Semana eliminada -- ${r.liquidacionesEliminadas} liquidación(es) y ${r.importsEliminados} import(s) borrados.` });
      setFilas([]);
      setWeekStart("");
      cargarSemanas();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo eliminar la semana." });
    } finally {
      setEliminando(false);
    }
  }

  // (25/09/2026, pedido de Leo: "en liquidaciones recorda lo del boton de PAGAR y despues
  // Pagado") -- se paga liquidación por liquidación (jugador+semana), no la semana entera de
  // una. Al pagar se suma solo a "Comisiones pagadas" DE ESE jugador (Jugadores/árbol).
  //
  // (09/10/2026, pedido de Leo: "que aparezcan en USDT o en Fichas") -- "Pagar" ahora abre
  // FormPagarLiquidacion (más abajo) para elegir el medio antes de confirmar, en vez de un
  // simple confirm().

  async function deshacerPago(f: any) {
    const confirmado = window.confirm(`¿Deshacer el pago de ${f.player_name}?`);
    if (!confirmado) return;
    setPagandoId(f.id);
    try {
      await api.teamback.marcarLiquidacionNoPagada(f.id);
      await cargarFilas(weekStart);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo deshacer el pago." });
    } finally {
      setPagandoId(null);
    }
  }

  const totalGeneral = filas.reduce((acc, f) => acc + Number(f.total_acreditado), 0);
  const totalPagado = filas.filter((f) => f.pagado).reduce((acc, f) => acc + Number(f.total_acreditado), 0);
  const totalPendiente = totalGeneral - totalPagado;
  const nPagadas = filas.filter((f) => f.pagado).length;
  const nPendientes = filas.length - nPagadas;
  const referidosActivosTotal = filas.reduce((acc, f) => acc + Number(f.referidos_activos_count || 0), 0);
  // Pendientes primero (después, de mayor a menor total) -- lo que falta pagar queda a la vista.
  const filasOrdenadas = [...filas].sort(
    (a, b) => Number(!!a.pagado) - Number(!!b.pagado) || Number(b.total_acreditado) - Number(a.total_acreditado)
  );
  const qLiq = buscaLiq.trim().toLowerCase();
  const filasVista = filasOrdenadas.filter(
    (f) => (filtroEstado === "todos" ? true : filtroEstado === "pendientes" ? !f.pagado : !!f.pagado) && (qLiq === "" || `${f.player_name} ${f.suprema_player_id}`.toLowerCase().includes(qLiq))
  );
  // Estilo de la Wallet (23/10/2026, pedido de Leo, mockup aprobado): paginación de las filas.
  const pgLiq = usePaginado(filasVista, "dp_tb_liq_tamano", [weekStart, filtroEstado, buscaLiq]);

  function itemsFila(f: any) {
    const verLiquidacion = {
      label: "Ver liquidación",
      onClick: () => setIndividual({ player_name: f.player_name, weekStart: String(f.week_start).slice(0, 10), playerId: f.player_id }),
    };
    if (!f.pagado) return [verLiquidacion];
    return [
      verLiquidacion,
      { label: "Avisarle al jugador del pago", disabled: notificando === f.id, onClick: () => notificarPago(f) },
      { label: "Deshacer pago", danger: true, disabled: pagandoId === f.id, onClick: () => deshacerPago(f) },
    ];
  }

  return (
    <div className="tb-liq">
      {topbarSlot &&
        semanas.length > 0 &&
        createPortal(
          <div className="tb-week-chips">
            {semanas.map((sm) => {
              const ws = String(sm.week_start).slice(0, 10);
              return (
                <button
                  key={ws}
                  className={`chip${ws === weekStart ? " chip-active" : ""}`}
                  onClick={() => {
                    setWeekStart(ws);
                    setSinConfigurar([]);
                    setMsg(null);
                    setFiltroEstado("todos");
                    cargarFilas(ws);
                  }}
                >
                  {diaMes(sm.week_start)} – {diaMes(sm.week_end)}
                </button>
              );
            })}
          </div>,
          topbarSlot
        )}

      {filas.length > 0 && (
        <WmSaldoCard
          etiqueta={`TOTAL DE LA SEMANA${weekStart ? ` · ${diaMes(weekStart)} AL ${diaMes(semanas.find((x) => String(x.week_start).slice(0, 10) === weekStart)?.week_end ?? weekStart)}` : ""}`}
          monto={usd(totalGeneral)}
          sub={`${filas.length} jugador${filas.length === 1 ? "" : "es"} con liquidación`}
        >
          <WmConteos
            items={[
              { etiqueta: "PAGADO", valor: <span style={{ color: "var(--green)" }}>{usd(totalPagado)}</span> },
              { etiqueta: "PENDIENTE DE PAGO", valor: <span style={nPendientes > 0 ? { color: "var(--amber)" } : undefined}>{usd(totalPendiente)}</span> },
              { etiqueta: "REFERIDOS ACTIVOS", valor: referidosActivosTotal },
            ]}
          />
        </WmSaldoCard>
      )}

      <div className="wm-card wm-tabla">
        <div className="liq-toolbar">
          <button className="btn" disabled={calculando} onClick={recalcularSeleccionada}>
            {calculando ? "Calculando..." : "Calcular / recalcular"}
          </button>
          <button className="btn secondary" onClick={() => setNuevaAbierta((v) => !v)} aria-expanded={nuevaAbierta}>
            Semana nueva…
          </button>
          {weekStart && filas.length > 0 && (
            <ActionsMenu
              label="🔔 Notificar ▾"
              align="left"
              title="Avisos push a los jugadores -- siempre manuales, nunca se mandan solos"
              items={[
                {
                  label: "Notificar liquidación (a todos los jugadores de la semana)",
                  disabled: notificando === "semana",
                  onClick: notificarLiquidacionSemana,
                },
                {
                  label: "Notificar referidos activos",
                  disabled: notificando === "referidos",
                  onClick: notificarReferidosActivosSemana,
                },
              ]}
            />
          )}
          {weekStart && filas.length > 0 && (
            <ActionsMenu
              items={[
                {
                  label: eliminando ? "Eliminando..." : "Eliminar esta semana…",
                  danger: true,
                  disabled: eliminando,
                  onClick: eliminarSemanaActual,
                },
              ]}
            />
          )}
          <span className="liq-toolbar-spacer" />
          {filas.length > 0 && (
            <input className="wm-in" placeholder="Buscar jugador..." value={buscaLiq} onChange={(e) => setBuscaLiq(e.target.value)} style={{ minWidth: 200 }} />
          )}
        </div>

        {filas.length > 0 && (
          <WmTabs
            actual={filtroEstado}
            onChange={setFiltroEstado}
            tabs={
              [
                { k: "todos", t: "Todos", n: filas.length },
                { k: "pendientes", t: "Pendientes", n: nPendientes },
                { k: "pagados", t: "Pagados", n: nPagadas },
              ] as WmTab<typeof filtroEstado>[]
            }
          />
        )}

        {nuevaAbierta && (
          <div className="liq-nueva">
            <div className="field">
              <label>Inicio de la semana</label>
              <input type="date" value={nuevaInicio} onChange={(e) => setNuevaInicio(e.target.value)} />
            </div>
            <div className="field">
              <label>Fin de la semana</label>
              <input type="date" value={nuevaFin} onChange={(e) => setNuevaFin(e.target.value)} max={hoyISO()} />
            </div>
            <div className="field" style={{ alignSelf: "flex-end" }}>
              <button className="btn" disabled={calculando || !nuevaInicio || !nuevaFin} onClick={calcularNueva}>
                {calculando ? "Calculando..." : "Calcular semana nueva"}
              </button>
            </div>
          </div>
        )}

        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}

        {sinConfigurar.length > 0 && (
          <div className="error" style={{ marginBottom: 12 }}>
            {sinConfigurar.length} jugador(es) con rake esta semana pero SIN % configurado todavía -- no se les calculó liquidación. Andá a "Jugadores / árbol" y cargales su % primero, después volvé a calcular esta semana:
            <ul>
              {sinConfigurar.map((s) => (
                <li key={s.playerId}>{s.playerName} ({s.supremaPlayerId})</li>
              ))}
            </ul>
          </div>
        )}

        <div className="liq-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jugador</th>
                <th className="num">Rake propio</th>
                <th>Escalón</th>
                <th className="num">Rakeback</th>
                <th className="num">Comisión 3%</th>
                <th className="num">Total</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pgLiq.recorte.map((f) => (
                <tr key={f.id} className={f.pagado ? "" : "fila-pendiente"}>
                  <td>
                    <div className="wm-who">
                      <span className="wm-av">{String(f.player_name ?? "?").trim().slice(0, 2).toUpperCase()}</span>
                      <div>
                        <div className="liq-name">{f.player_name}</div>
                        <div className="liq-sub">ID {f.suprema_player_id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num">{usd(f.rake_propio)}</td>
                  <td><EscalonPill l={f} /></td>
                  <td className="num">{usd(f.rakeback_generado)}</td>
                  <td className="num">
                    {usd(f.comision_3pct_acreditada)}
                    {Number(f.rake_referidos_directos) > 0 && (
                      <div className="liq-sub">
                        {f.referidos_activos_count} ref. activo{Number(f.referidos_activos_count) === 1 ? "" : "s"} · rake {usd(f.rake_referidos_directos)}
                      </div>
                    )}
                    {f.comision_3pct_pausada && (
                      <div>
                        <span className="pill a" title="El referente no tuvo actividad propia en la ventana de semanas configurada -- comisión pausada esta semana.">
                          comisión pausada
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="num"><span className="liq-total">{usd(f.total_acreditado)}</span></td>
                  <td><EstadoPill l={f} /></td>
                  <td style={{ width: 130 }}>
                    <div className="row-actions">
                      {!f.pagado && (
                        <button className="btn small" onClick={() => setPagando(f)}>
                          Pagar
                        </button>
                      )}
                      <ActionsMenu items={itemsFila(f)} />
                    </div>
                  </td>
                </tr>
              ))}
              {filasVista.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {filas.length === 0 ? "Sin datos para esta semana todavía." : "Ningún jugador coincide con este filtro."}
                  </td>
                </tr>
              )}
            </tbody>
            {filasVista.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    <strong>{filtroEstado === "todos" ? "Total general" : "Total del filtro"}</strong>
                  </td>
                  <td className="num">
                    <strong>{usd(filasVista.reduce((acc, f) => acc + Number(f.total_acreditado), 0))}</strong>
                  </td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="liq-cards">
          {pgLiq.recorte.map((f) => (
            <div key={f.id} className={`liq-card${f.pagado ? " pagada" : " pendiente"}`}>
              <div className="liq-card-body">
                <div className="liq-card-top">
                  <div>
                    <span className="liq-name">{f.player_name}</span> <span className="liq-sub">ID {f.suprema_player_id}</span>
                  </div>
                  <div className="liq-total">{usd(f.total_acreditado)}</div>
                </div>
                <div className="liq-card-pills">
                  <div><EstadoPill l={f} /></div>
                  <EscalonPill l={f} />
                </div>
                <div className="liq-card-grid">
                  <div>Rake propio<b>{usd(f.rake_propio)}</b></div>
                  <div>Rakeback<b>{usd(f.rakeback_generado)}</b></div>
                  <div>Comisión 3%<b>{usd(f.comision_3pct_acreditada)}</b></div>
                </div>
                <div className="liq-card-actions">
                  {!f.pagado && (
                    <>
                      <button className="btn small" style={{ flex: 1 }} onClick={() => setPagando(f)}>
                        Pagar
                      </button>
                      <button
                        className="btn secondary small"
                        style={{ flex: 1 }}
                        onClick={() => setIndividual({ player_name: f.player_name, weekStart: String(f.week_start).slice(0, 10), playerId: f.player_id })}
                      >
                        Ver liquidación
                      </button>
                    </>
                  )}
                  <ActionsMenu items={itemsFila(f)} />
                </div>
              </div>
            </div>
          ))}
          {filasVista.length === 0 && (
            <div className="muted">{filas.length === 0 ? "Sin datos para esta semana todavía." : "Ningún jugador coincide con este filtro."}</div>
          )}
        </div>
        {filasVista.length > 0 && <WmPaginacion p={pgLiq} unidad="liquidaciones" />}
      </div>

      {individual && (
        <Modal title={`Liquidación — ${individual.player_name}`} onClose={() => setIndividual(null)}>
          <LiquidacionIndividual playerId={individual.playerId} weekStart={individual.weekStart} />
        </Modal>
      )}

      {pagando && (
        <Modal title={`Pagar — ${pagando.player_name}`} onClose={() => setPagando(null)}>
          <FormPagarLiquidacion
            liquidacion={pagando}
            onPagado={() => {
              setPagando(null);
              cargarFilas(weekStart);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

// (09/10/2026, pedido de Leo: "que aparezcan en USDT o en Fichas... al pagar en USDT deberia
// mover la wallet en el otro sistema") -- elige el medio de pago antes de confirmar. Si es
// USDT, el backend (marcarLiquidacionPagada) registra un egreso real en la Wallet del sistema
// principal (WALLET_MANOS) -- acá solo se avisa que eso va a pasar, el movimiento en sí lo hace
// el backend. Fichas nunca toca la Wallet.
function FormPagarLiquidacion({ liquidacion, onPagado }: { liquidacion: any; onPagado: () => void }) {
  const [medioPago, setMedioPago] = useState<"USDT" | "FICHAS">("USDT");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function confirmar() {
    setLoading(true);
    setMsg(null);
    try {
      await api.teamback.marcarLiquidacionPagada(liquidacion.id, medioPago);
      onPagado();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo marcar como pagada." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        Monto a pagar: <strong>{usd(Number(liquidacion.total_acreditado) - Number(liquidacion.compensado ?? 0))}</strong>
        {Number(liquidacion.compensado) > 0 && <span className="muted" style={{ fontSize: 12 }}> (de {usd(liquidacion.total_acreditado)}: {usd(liquidacion.compensado)} ya se compensaron contra la deuda)</span>}
      </div>
      <div className="field">
        <label>Medio de pago</label>
        <select value={medioPago} onChange={(e) => setMedioPago(e.target.value as "USDT" | "FICHAS")}>
          <option value="USDT">USDT</option>
          <option value="FICHAS">Fichas</option>
        </select>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {medioPago === "USDT"
          ? `Se va a registrar un egreso de ${usd(Number(liquidacion.total_acreditado) - Number(liquidacion.compensado ?? 0))} en la Wallet del sistema principal.`
          : "Pago en fichas del club -- no mueve la Wallet."}
      </div>
      {msg && (
        <div className={msg.ok ? "success" : "error"} style={{ marginTop: 10 }}>
          {msg.text}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={loading} onClick={confirmar}>
          {loading ? "Confirmando..." : "Confirmar pago"}
        </button>
      </div>
    </div>
  );
}

// ===================================================================================
// Ganancia por semana (25/09/2026, pedido de Leo: "el rake total al 80% menos el total (de
// liquidaciones), esa diferencia es nuestra ganancia" + "un boton que pagar dejar asentado que
// se pago la liquidacion") -- ganancia de la CASA, no de los jugadores. Se calcula al vuelo en
// el backend a partir de las liquidaciones ya calculadas de cada semana (ver
// repo/teamback.ts getGananciaPorSemana) -- si recalculás una semana, esto se actualiza solo.
// ===================================================================================

function GananciaSemanalTab() {
  // (25/09/2026, pedido de Leo: "en ganancia por semana eliminar el boton pagar y estado. ya lo
  // vamos a hacer en el otro lugar" + "necesitariamos hacer la suma de la ganancia y que quede y
  // se vaya acumulando") -- esta pantalla dejó de manejar pagos (eso ahora vive en Liquidaciones,
  // ver LiquidacionesTab) y pasó a ser de solo lectura, con el acumulado de todas las semanas.
  const [datos, setDatos] = useState<{ semanas: any[]; acumulado: any } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function cargar() {
    setCargando(true);
    try {
      setDatos(await api.teamback.gananciaSemanal());
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cargar." });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  if (cargando) return <div className="panel"><Loading /></div>;

  const filas = datos?.semanas ?? [];
  const acumulado = datos?.acumulado;

  return (
    <div className="wm">
      {acumulado && (
        <WmSaldoCard
          etiqueta="GANANCIA ACUMULADA · TEAMBACK"
          monto={usd(acumulado.ganancia)}
          signo={acumulado.ganancia >= 0 ? "pos" : "neg"}
          sub={`${filas.length} semana${filas.length === 1 ? "" : "s"} liquidada${filas.length === 1 ? "" : "s"}`}
        >
          <WmConteos
            items={[
              { etiqueta: "RAKE PROPIO ACUMULADO", valor: usd(acumulado.rake_propio_total) },
              { etiqueta: "TOTAL LIQUIDADO ACUMULADO", valor: usd(acumulado.total_liquidado) },
            ]}
          />
        </WmSaldoCard>
      )}
      <div className="wm-card wm-tabla">
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Ganancia = (rake propio total de la semana × 80%) − total liquidado a los jugadores esa
        semana (rakeback + comisiones). Solo aparecen semanas que ya tienen liquidación calculada
        (pestaña Liquidaciones o el botón de Importar semana). El pago se marca desde Liquidaciones.
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}

      <table>
        <thead>
          <tr>
            <th>Semana</th>
            <th className="num">Rake propio total</th>
            <th className="num">Rake al 80%</th>
            <th className="num">Total liquidado</th>
            <th className="num">Ganancia</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.week_start}>
              <td>{dateShort(f.week_start)} al {dateShort(f.week_end)}</td>
              <td className="num">{usd(f.rake_propio_total)}</td>
              <td className="num">{usd(f.rake_al_80_pct)}</td>
              <td className="num">{usd(f.total_liquidado)}</td>
              <td className="num">
                <strong className={f.ganancia >= 0 ? "pos" : "neg"}>{usd(f.ganancia)}</strong>
              </td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">Todavía no hay ninguna semana liquidada.</td>
            </tr>
          )}
        </tbody>
        {filas.length > 0 && acumulado && (
          <tfoot>
            <tr>
              <td><strong>Acumulado</strong></td>
              <td className="num"><strong>{usd(acumulado.rake_propio_total)}</strong></td>
              <td className="num"><strong>{usd(acumulado.rake_al_80_pct)}</strong></td>
              <td className="num"><strong>{usd(acumulado.total_liquidado)}</strong></td>
              <td className="num"><strong className={acumulado.ganancia >= 0 ? "pos" : "neg"}>{usd(acumulado.ganancia)}</strong></td>
            </tr>
          </tfoot>
        )}
      </table>
      </div>
    </div>
  );
}

// (09/10/2026, pedido de Leo: "podemos poner en espejo la wallet de adm poker... en modo
// espejo") -- pestaña NUEVA (no mezclada con Resumen/KPIs existentes), SOLO LECTURA, visible
// únicamente para ADMIN (la ruta de abajo ya exige requireTbAdmin, nunca requireTbPlayer). No
// hay ningún botón para mover ni ajustar la Wallet acá -- es un espejo, no un control remoto.
function WalletEspejoTab() {
  const [saldo, setSaldo] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function cargar() {
    setCargando(true);
    try {
      const r = await api.teamback.walletEspejo();
      setSaldo(r.saldo);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cargar el saldo de la Wallet." });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  if (cargando) return <div className="panel"><Loading /></div>;

  return (
    <div className="wm">
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      {saldo !== null && (
        <WmSaldoCard
          etiqueta="SALDO WALLET (ESPEJO)"
          monto={usd(saldo)}
          signo={saldo >= 0 ? "pos" : "neg"}
          sub="Espejo de solo lectura de la Wallet de Poker Gestión (sistema principal). Se actualiza al abrir esta pestaña. Acá no se puede cargar, ajustar ni mover la Wallet -- para eso hay que entrar al sistema principal."
        />
      )}
    </div>
  );
}

// Avisos (13/10/2026, pedido de Leo: "Nuevo Torneo 10k Garantizados!") -- anuncio libre por push,
// a todos los jugadores con notificaciones activadas o a uno puntual. Siempre manual, lo manda
// quien está en este panel cuando quiere, nunca se dispara solo.
function AvisosTab() {
  const [jugadores, setJugadores] = useState<any[]>([]);
  const [titulo, setTitulo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [destino, setDestino] = useState(""); // "" = todos
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  // Imagen (13/10/2026, pedido de Leo: "podemos pushear una imagen?" y después "podemos
  // cargar nosotros la imagen?") -- se puede subir un archivo directo (sube a Vercel Blob, ver
  // onArchivoSeleccionado más abajo) o pegar un link si ya está hosteada en otro lado -- ambos
  // caminos terminan llenando este mismo estado.
  const [imagenUrl, setImagenUrl] = useState("");
  const [borrandoId, setBorrandoId] = useState<string | null>(null);
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [fileKey, setFileKey] = useState(0); // cambia para "resetear" el <input type=file>

  async function cargarHistorial() {
    try {
      setHistorial(await api.teamback.push.log({ tipo: "broadcast" }));
    } catch {
      /* si falla, el historial simplemente queda vacío -- no es crítico para poder mandar un aviso nuevo */
    }
  }

  useEffect(() => {
    api.teamback.listPlayers(false).then(setJugadores);
    cargarHistorial();
  }, []);

  async function enviar() {
    if (!titulo.trim() || !mensaje.trim()) return setMsg({ ok: false, text: "Completá título y mensaje." });
    setEnviando(true);
    setMsg(null);
    try {
      const r = await api.teamback.push.broadcast(titulo.trim(), mensaje.trim(), destino || null, imagenUrl.trim() || null);
      setMsg({ ok: true, text: `Enviado -- ${r.pushEnviados} push entregados.` });
      setTitulo("");
      setMensaje("");
      setDestino("");
      setImagenUrl("");
      setFileKey((k) => k + 1);
      cargarHistorial();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo mandar el aviso." });
    } finally {
      setEnviando(false);
    }
  }

  async function borrarAviso(id: string) {
    const confirmado = window.confirm("¿Borrar este aviso del historial? (No revoca la notificación ya entregada, solo lo saca de esta lista.)");
    if (!confirmado) return;
    setBorrandoId(id);
    try {
      await api.teamback.push.deleteLog(id);
      cargarHistorial();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo borrar el aviso." });
    } finally {
      setBorrandoId(null);
    }
  }

  // (13/10/2026, pedido de Leo: "podemos cargar nosotros la imagen?") -- sube el archivo elegido
  // a Vercel Blob (vía el backend) y, si sale bien, lo deja como si hubieras pegado el link a
  // mano en el campo de abajo.
  async function onArchivoSeleccionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubiendoImagen(true);
    setMsg(null);
    try {
      const r = await api.teamback.push.subirImagen(file);
      setImagenUrl(r.url);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo subir la imagen." });
      setFileKey((k) => k + 1);
    } finally {
      setSubiendoImagen(false);
    }
  }

  function quitarImagen() {
    setImagenUrl("");
    setFileKey((k) => k + 1);
  }

  return (
    <div className="wm-card wm-tabla">
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Mandá una notificación push libre -- novedades, torneos, lo que necesites avisar. Solo le
        llega a quien ya activó las notificaciones en su celular/navegador.
      </div>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Para</label>
          <select value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Todos los jugadores</option>
            {jugadores.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Título</label>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: ¡Nuevo torneo!" maxLength={80} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Mensaje</label>
          <input value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Ej: Torneo 10k Garantizados hoy a las 21hs." maxLength={180} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Imagen (opcional)</label>
          <input key={fileKey} type="file" accept="image/*" disabled={subiendoImagen} onChange={onArchivoSeleccionado} />
          {subiendoImagen && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Subiendo...</div>}
          {imagenUrl && !subiendoImagen && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <img src={imagenUrl} alt="" style={{ height: 48, borderRadius: 4, border: "1px solid var(--border)" }} />
              <button className="btn secondary small" type="button" onClick={quitarImagen}>Quitar</button>
            </div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            O si ya está subida en otro lado, pegá el link directamente:{" "}
            <input
              value={imagenUrl}
              onChange={(e) => setImagenUrl(e.target.value)}
              placeholder="https://..."
              style={{ marginTop: 4 }}
            />
          </div>
        </div>
        <div className="field" style={{ alignSelf: "flex-end" }}>
          <button className="btn" disabled={enviando} onClick={enviar}>
            {enviando ? "Enviando..." : "🔔 Mandar aviso"}
          </button>
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}

      <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: 15 }}>Últimos avisos mandados</h3>
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Para</th>
            <th>Título</th>
            <th>Mensaje</th>
            <th className="num">Entregados</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {historial.map((h) => (
            <tr key={h.id}>
              <td className="muted">{dateShort(h.created_at)}</td>
              <td>{h.player_name || "Todos"}</td>
              <td>{h.titulo}</td>
              <td className="muted">{h.mensaje}</td>
              <td className="num">{h.enviado_a}</td>
              <td>
                <button className="btn secondary small" disabled={borrandoId === h.id} onClick={() => borrarAviso(h.id)} title="Borrar este aviso del historial">
                  {borrandoId === h.id ? "..." : "🗑"}
                </button>
              </td>
            </tr>
          ))}
          {historial.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">Todavía no mandaste ningún aviso.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Historial de pagos (14/10/2026, pedido de Leo: "deberíamos tener en algún lado el historial de
// pagos, si fueron en USDT o en Fichas") -- junta todos los jugadores y todas las semanas en una
// sola tabla, con filtro por fecha/jugador/medio de pago y los totales de cada medio arriba. Los
// totales siempre reflejan el rango de fecha + jugador elegidos, SIN aplicar el filtro de medio
// de pago (así se ve el desglose completo aunque la tabla esté filtrada a uno solo).
function HistorialPagosTab() {
  const [filas, setFilas] = useState<any[]>([]);
  const [totales, setTotales] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // Estilo de la Wallet (23/10/2026, pedido de Leo, mockup aprobado): pestañas por medio de pago, buscador, fechas en "Más filtros" y paginación.
  const [busca, setBusca] = useState("");
  const [masFiltros, setMasFiltros] = useState(false);
  const [medioTab, setMedioTab] = useState<"todos" | "FICHAS" | "COMPENSACION" | "USDT" | "PENDIENTE">("todos");

  async function cargar() {
    setCargando(true);
    setMsg(null);
    try {
      const r = await api.teamback.historialPagos({ desde: desde || undefined, hasta: hasta || undefined });
      setFilas(r.filas);
      setTotales(r.totales);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cargar el historial de pagos." });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const medioDe = (f: any) => (f.pagado ? (f.medio_pago ?? "FICHAS") : "PENDIENTE");
  const q = busca.trim().toLowerCase();
  const base = filas.filter((f) => q === "" || String(f.player_name).toLowerCase().includes(q));
  const cuentas = {
    todos: base.length,
    FICHAS: base.filter((f) => medioDe(f) === "FICHAS").length,
    COMPENSACION: base.filter((f) => medioDe(f) === "COMPENSACION").length,
    USDT: base.filter((f) => medioDe(f) === "USDT").length,
    PENDIENTE: base.filter((f) => medioDe(f) === "PENDIENTE").length,
  };
  const visibles = base.filter((f) => medioTab === "todos" || medioDe(f) === medioTab);
  const pg = usePaginado(visibles, "dp_tb_pagos_tamano", [busca, medioTab, filas]);
  const totalVisible = visibles.reduce((a, f) => a + Number(f.total_acreditado), 0);
  const iniciales = (n: string) => String(n ?? "?").trim().slice(0, 2).toUpperCase();

  function exportar() {
    exportCsv(
      "historial_pagos_teamback.csv",
      visibles.map((f) => ({
        jugador: f.player_name,
        semana_inicio: dateShort(f.week_start),
        semana_fin: dateShort(f.week_end),
        total_liquidado: f.total_acreditado,
        estado: f.pagado ? (etiquetaMedio(f.medio_pago)) : "Pendiente",
        fecha_pago: f.paid_at ? dateShort(f.paid_at) : "",
      }))
    );
  }

  return (
    <div className="wm">
      {msg && <div className="error" style={{ marginBottom: 12 }}>{msg.text}</div>}

      {totales && (
        <WmSaldoCard
          etiqueta="TOTAL PAGADO · TEAMBACK"
          monto={usd(Number(totales.total_usdt) + Number(totales.total_fichas))}
          signo="pos"
          sub={`${totales.count_fichas} pago${totales.count_fichas === "1" ? "" : "s"} en fichas · ${totales.count_usdt} en USDT`}
        >
          <WmConteos
            items={[
              { etiqueta: "PAGADO EN USDT", valor: usd(totales.total_usdt) },
              { etiqueta: "PAGADO EN FICHAS", valor: usd(totales.total_fichas) },
              { etiqueta: "PENDIENTE", valor: <span style={{ color: "var(--amber)" }}>{usd(totales.total_pendiente)}</span> },
            ]}
          />
        </WmSaldoCard>
      )}

      <div className="wm-card">
        <div className="wm-cab">
          <div className="wm-h">Pagos <span className="wm-n">{visibles.length}</span></div>
          <div className="wm-fil">
            <input className="wm-in" placeholder="Buscar jugador..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            <button type="button" className={`wm-in wm-btn ${masFiltros || desde || hasta ? "on" : ""}`} onClick={() => setMasFiltros((v) => !v)}>⚲ Fechas ▾</button>
            <button type="button" className="wm-in wm-btn" onClick={exportar} disabled={visibles.length === 0}>Exportar CSV</button>
          </div>
        </div>
        {(masFiltros || desde || hasta) && (
          <div className="wm-mas">
            <label>Desde<input className="wm-in" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label>Hasta<input className="wm-in" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
            <button type="button" className="btn small" onClick={cargar} disabled={cargando}>{cargando ? "Buscando..." : "Aplicar fechas"}</button>
          </div>
        )}
        <WmTabs
          actual={medioTab}
          onChange={setMedioTab}
          tabs={
            [
              { k: "todos", t: "Todos", n: cuentas.todos },
              { k: "FICHAS", t: "Fichas", n: cuentas.FICHAS },
              { k: "COMPENSACION", t: "Compensación", n: cuentas.COMPENSACION },
              { k: "USDT", t: "USDT", n: cuentas.USDT },
              { k: "PENDIENTE", t: "Pendientes", n: cuentas.PENDIENTE },
            ] as WmTab<typeof medioTab>[]
          }
        />

        {cargando ? (
          <Loading />
        ) : (
          <>
            <div className="hp-th">
              <span>JUGADOR</span><span>SEMANA</span><span>TOTAL LIQUIDADO</span><span>MEDIO DE PAGO</span><span>FECHA DE PAGO</span>
            </div>
            {pg.recorte.map((f) => (
              <div className="hp-fila" key={f.id}>
                <div className="wm-who">
                  <span className="wm-av">{iniciales(f.player_name)}</span>
                  <div><div className="saldo-name">{f.player_name}</div></div>
                </div>
                <span className="ds">{dateShort(f.week_start)} al {dateShort(f.week_end)}</span>
                <span className="t">{usd(f.total_acreditado)}</span>
                <span>
                  {f.pagado ? (
                    <span className={`wm-pill ${f.medio_pago === "COMPENSACION" ? "neutro" : "in"}`}>{etiquetaMedio(f.medio_pago)}</span>
                  ) : (
                    <span className="wm-pill gris">Por cobrar</span>
                  )}
                </span>
                <span className="ds">{f.paid_at ? dateShort(f.paid_at) : "—"}</span>
              </div>
            ))}
            {visibles.length === 0 && <div className="muted" style={{ padding: "16px 8px" }}>No hay pagos que coincidan con estos filtros.</div>}
            <div className="wm-pie">
              <div className="wm-tot">
                <span>Total liquidado de lo filtrado <b className="in">{usd(totalVisible)}</b></span>
                <small>{visibles.length} pago{visibles.length === 1 ? "" : "s"}</small>
              </div>
            </div>
            <WmPaginacion p={pg} unidad="pagos" />
          </>
        )}
      </div>
    </div>
  );
}


// Formato de liquidación lista para copiar/mandarle al jugador -- compartido entre la vista de
// admin (LiquidacionIndividual, pide el dato por playerId+weekStart) y el portal del propio
// jugador (que ya tiene la fila entera de antes, no necesita pedir nada más).
function textoLiquidacion(l: any, referidos?: ReferidoDesgloseUI[]): string {
  const base = [
    `Rake propio: ${usd(l.rake_propio)}`,
    `Referidos activos: ${l.referidos_activos_count}`,
    `Rakeback aplicado: ${pct(l.rakeback_pct)}`,
    `Rakeback generado: ${usd(l.rakeback_generado)}`,
    `Rake generado por referidos: ${usd(l.rake_referidos_directos)}`,
    `Comisión de afiliado 3%: ${usd(l.comision_3pct_acreditada)}${l.comision_3pct_pausada ? " (pausada esta semana)" : ""}`,
    `Total acreditado: ${usd(l.total_acreditado)}`,
  ];
  // (09/10/2026, pedido de Leo: "deberiamos poder ver el desglose de cada jugador y que
  // generó") -- detalle jugador por jugador, para que el texto que Leo copia y manda por
  // WhatsApp también lo explique (no solo la pantalla). Si no hay ningún referido (jugador sin
  // nadie abajo en el árbol) no se agrega nada, para no ensuciar el texto con una lista vacía.
  if (referidos && referidos.length > 0) {
    base.push("", "Desglose por referido:");
    for (const r of referidos) {
      base.push(
        `- ${r.playerName} (${r.supremaPlayerId}): rake ${usd(r.rake)}${r.activo ? "" : " (inactivo esta semana)"} -> comisión ${usd(r.comisionAportada)}`
      );
    }
  }
  return base.join("\n");
}

interface ReferidoDesgloseUI {
  playerId: string;
  playerName: string;
  supremaPlayerId: string;
  rake: number;
  activo: boolean;
  comisionAportada: number;
}

function BloqueLiquidacionCopiable({
  liquidacion,
  referidos,
  soloReferidos,
}: {
  liquidacion: any;
  referidos?: ReferidoDesgloseUI[];
  soloReferidos?: boolean;
}) {
  const texto = textoLiquidacion(liquidacion, referidos);
  // (13/10/2026, pedido de Leo: screenshot del portal mobile -- la tabla de desglose por
  // referido obliga a arrastrar para el costado en un celular, y lo que queda cortado es
  // justo "Comisión aportada". En mobile se reemplaza por una tarjeta por referido (mismo
  // patrón visual que .week-card); en desktop sigue siendo la tabla de siempre. Mismo
  // componente para el portal del jugador (soloReferidos) y la vista admin
  // (LiquidacionIndividual) -- el breakpoint de useIsMobile ya vive en este mismo archivo.
  const isMobile = useIsMobile();
  return (
    <div>
      {!soloReferidos && (
        <>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7 }}>{texto}</pre>
          <button
            className="btn secondary small"
            onClick={() => {
              navigator.clipboard?.writeText(texto);
            }}
          >
            Copiar
          </button>
        </>
      )}

      {referidos && referidos.length === 0 && soloReferidos && (
        <div className="muted" style={{ fontSize: 13 }}>No tenés referidos activos esta semana.</div>
      )}

      {referidos && referidos.length > 0 && (
        <div style={{ marginTop: soloReferidos ? 0 : 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Desglose por referido -- qué generó cada uno esta semana.
          </div>
          {isMobile ? (
            <div className="tb-ref-list">
              {referidos.map((r) => (
                <div className="tb-ref-card" key={r.playerId}>
                  <div className="tb-ref-head">
                    <div className="tb-ref-name">{r.playerName}</div>
                    {r.activo ? (
                      <span className="badge pos">activo</span>
                    ) : (
                      <span className="badge neg" title="No llegó al umbral de referido activo esta semana.">inactivo</span>
                    )}
                  </div>
                  <div className="tb-ref-id">ID Suprema {r.supremaPlayerId}</div>
                  <div className="tb-ref-grid">
                    <div className="tb-ref-item">
                      <div className="label">Rake</div>
                      <div className="val">{usd(r.rake)}</div>
                    </div>
                    <div className="tb-ref-item">
                      <div className="label">Comisión aportada</div>
                      <div className="val">{usd(r.comisionAportada)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Jugador</th>
                    <th>ID Suprema</th>
                    <th className="num">Rake</th>
                    <th>Estado</th>
                    <th className="num">Comisión aportada</th>
                  </tr>
                </thead>
                <tbody>
                  {referidos.map((r) => (
                    <tr key={r.playerId}>
                      <td>{r.playerName}</td>
                      <td className="muted">{r.supremaPlayerId}</td>
                      <td className="num">{usd(r.rake)}</td>
                      <td>
                        {r.activo ? (
                          <span className="badge pos">activo</span>
                        ) : (
                          <span className="badge neg" title="No llegó al umbral de referido activo esta semana.">inactivo</span>
                        )}
                      </td>
                      <td className="num">{usd(r.comisionAportada)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiquidacionIndividual({ playerId, weekStart }: { playerId: string; weekStart: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    api.teamback.liquidacionIndividual(playerId, weekStart).then(setData);
  }, [playerId, weekStart]);

  if (!data) return <Loading />;
  return <BloqueLiquidacionCopiable liquidacion={data.liquidacion} referidos={data.referidos} />;
}

// ===================================================================================
// Jugadores / árbol
// ===================================================================================

function JugadoresTab() {
  const [jugadores, setJugadores] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState<any | null>(null);
  const [configurando, setConfigurando] = useState<any | null>(null);
  // Estilo de la Wallet (23/10/2026, pedido de Leo, mockup aprobado): pestañas, buscador y paginación en una sola lista.
  const [tabJug, setTabJug] = useState<"todos" | "directos" | "referidos" | "sinconfig" | "inactivos">("todos");
  const [buscaJug, setBuscaJug] = useState("");

  async function cargar() {
    setJugadores(await api.teamback.listPlayers(true));
  }
  useEffect(() => {
    cargar();
  }, []);

  // (25/09/2026, pedido de Leo: "separar el jugador del jugador referido") -- antes era una
  // sola tabla con todos mezclados (columna "Referido por" en "—" para la mayoría). Ahora son
  // dos tablas separadas: jugadores directos (llegaron solos) y jugadores referidos (entraron
  // por el link/código de otro jugador). Mismos datos, mismas acciones, solo se separan las
  // filas -- no cambia nada de cómo se cargan, editan o liquidan.
  const directos = jugadores.filter((j) => !j.referido_por_id);
  const referidos = jugadores.filter((j) => j.referido_por_id);
  const qJ = buscaJug.trim().toLowerCase();
  const baseJug = jugadores.filter((j) => qJ === "" || `${j.name} ${j.suprema_player_id} ${j.referido_por_name ?? ""}`.toLowerCase().includes(qJ));
  const visiblesJug = baseJug.filter((j) =>
    tabJug === "todos" ? true : tabJug === "directos" ? !j.referido_por_id : tabJug === "referidos" ? !!j.referido_por_id : tabJug === "sinconfig" ? !j.tiene_config : !j.active
  );
  const pgJug = usePaginado(visiblesJug, "dp_tb_jugadores_tamano", [tabJug, buscaJug]);

  function filaJugador(j: any) {
    return (
      <tr key={j.id} style={j.active ? undefined : { opacity: 0.55 }}>
        <td>{j.name}</td>
        <td className="muted">{j.suprema_player_id}</td>
        <td>{dateShort(j.fecha_alta)}</td>
        <td className="muted">{j.referido_por_name ?? "—"}</td>
        <td className="num">{j.referidos_count}</td>
        <td className="num">{usd(j.comision_total)}</td>
        <td className="num">{usd(j.comision_pagada)}</td>
        <td className="num">
          {j.tiene_config ? (
            <span className="badge pos">Configurado</span>
          ) : (
            <span className="badge neg" title="Sin % propio cargado -- no se liquida hasta que se configure.">Sin % configurar</span>
          )}
        </td>
        <td>{j.active ? <span className="badge pos">Activo</span> : <span className="badge neg">Inactivo</span>}</td>
        <td style={{ display: "flex", gap: 6 }}>
          <button className="btn secondary small" onClick={() => setNuevo(j)}>
            Editar
          </button>
          <button className="btn secondary small" onClick={() => setConfigurando(j)}>
            % Configurar
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="wm">
      <WmSaldoCard
        etiqueta="COMISIÓN ACUMULADA · JUGADORES"
        monto={usd(jugadores.reduce((a, j) => a + Number(j.comision_total ?? 0), 0))}
        sub={`${jugadores.length} jugador${jugadores.length === 1 ? "" : "es"} · ${directos.length} directos y ${referidos.length} referidos`}
      >
        <WmConteos
          items={[
            { etiqueta: "COMISIONES PAGADAS", valor: usd(jugadores.reduce((a, j) => a + Number(j.comision_pagada ?? 0), 0)) },
            { etiqueta: "SIN % CONFIGURAR", valor: jugadores.filter((j) => !j.tiene_config).length },
            { etiqueta: "INACTIVOS", valor: jugadores.filter((j) => !j.active).length },
          ]}
        />
      </WmSaldoCard>

      <div className="wm-card wm-tabla">
        <div className="wm-cab">
          <div className="wm-h">Jugadores <span className="wm-n">{visiblesJug.length}</span></div>
          <div className="wm-fil">
            <input className="wm-in" placeholder="Buscar jugador, ID o referente..." value={buscaJug} onChange={(e) => setBuscaJug(e.target.value)} />
            <button type="button" className="btn small" onClick={() => setNuevo({})}>+ Nuevo jugador</button>
          </div>
        </div>
        <div className="muted" style={{ marginBottom: 8, fontSize: 12.5 }}>
          Cada jugador tiene su propio % de rakeback, escalones y comisión -- no hay un % general para todos. Un jugador marcado "Sin % configurar" no se liquida hasta que le cargues el suyo (botón "% Configurar").
        </div>
        <WmTabs
          actual={tabJug}
          onChange={setTabJug}
          tabs={
            [
              { k: "todos", t: "Todos", n: baseJug.length },
              { k: "directos", t: "Directos", n: baseJug.filter((j) => !j.referido_por_id).length },
              { k: "referidos", t: "Referidos", n: baseJug.filter((j) => !!j.referido_por_id).length },
              { k: "sinconfig", t: "Sin % configurar", n: baseJug.filter((j) => !j.tiene_config).length },
              { k: "inactivos", t: "Inactivos", n: baseJug.filter((j) => !j.active).length },
            ] as WmTab<typeof tabJug>[]
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>ID Suprema</th>
                <th>Fecha de alta</th>
                <th>Referido por</th>
                <th className="num"># Referidos</th>
                <th className="num">Comisión acumulada</th>
                <th className="num">Comisiones pagadas</th>
                <th className="num">%</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pgJug.recorte.map(filaJugador)}
              {visiblesJug.length === 0 && (
                <tr><td colSpan={10} className="muted">Ningún jugador coincide con estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <WmPaginacion p={pgJug} unidad="jugadores" />
      </div>

      {nuevo && (
        <Modal title={nuevo.id ? `Editar — ${nuevo.name}` : "Nuevo jugador"} onClose={() => setNuevo(null)}>
          <FormJugador jugador={nuevo} jugadores={jugadores} onSaved={() => { setNuevo(null); cargar(); }} />
        </Modal>
      )}
      {configurando && (
        <Modal title={`% de ${configurando.name}`} onClose={() => setConfigurando(null)}>
          <FormConfigJugador jugador={configurando} onSaved={() => { setConfigurando(null); cargar(); }} />
        </Modal>
      )}
    </div>
  );
}

function FormJugador({ jugador, jugadores, onSaved }: { jugador: any; jugadores: any[]; onSaved: () => void }) {
  const [supremaPlayerId, setSupremaPlayerId] = useState(jugador.suprema_player_id ?? "");
  const [name, setName] = useState(jugador.name ?? "");
  const [fechaAlta, setFechaAlta] = useState(jugador.fecha_alta ? String(jugador.fecha_alta).slice(0, 10) : hoyISO());
  const [referidoPorId, setReferidoPorId] = useState(jugador.referido_por_id ?? "");
  const [active, setActive] = useState(jugador.active ?? true);
  const [notes, setNotes] = useState(jugador.notes ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!supremaPlayerId.trim() || !name.trim()) return setMsg({ ok: false, text: "ID de Suprema y nombre son obligatorios." });
    setLoading(true);
    try {
      const data = { supremaPlayerId: supremaPlayerId.trim(), name: name.trim(), fechaAlta, referidoPorId: referidoPorId || null, notes: notes.trim() || null };
      if (jugador.id) await api.teamback.actualizarPlayer(jugador.id, { ...data, active });
      else await api.teamback.crearPlayer(data);
      onSaved();
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
          <label>ID / nickname de Suprema</label>
          <input value={supremaPlayerId} onChange={(e) => setSupremaPlayerId(e.target.value)} />
        </div>
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Fecha de alta</label>
          <input type="date" value={fechaAlta} onChange={(e) => setFechaAlta(e.target.value)} />
        </div>
        <div className="field">
          <label>Referido por (opcional)</label>
          <select value={referidoPorId} onChange={(e) => setReferidoPorId(e.target.value)}>
            <option value="">Nadie (llegó directo)</option>
            {jugadores.filter((j) => j.id !== jugador.id).map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.suprema_player_id})
              </option>
            ))}
          </select>
        </div>
        {jugador.id && (
          <div className="field">
            <label>Estado</label>
            <select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </div>
        )}
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Notas (opcional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>
        {loading ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}

// (25/09/2026, pedido de Leo: "deberiamos poder configurar a los jugadores y sus % no en
// general como esta ahi") -- % de rakeback/escalones/comisión de UN jugador puntual. Si todavía
// no tiene nada cargado, se prellena con la plantilla global (Configuración) como punto de
// partida -- pero hay que guardar explícitamente para que quede activo, no se aplica solo.
const CAMPOS_CONFIG: { key: string; label: string; step: string; pct?: boolean }[] = [
  { key: "pctBase", label: "Rakeback base (%)", step: "0.1", pct: true },
  { key: "pctTier2", label: "Rakeback escalón 2 (%)", step: "0.1", pct: true },
  { key: "pctTier3", label: "Rakeback escalón 3 (%)", step: "0.1", pct: true },
  { key: "umbralVolumenTier2Usd", label: "Volumen propio para escalón 2 (USD/semana)", step: "1" },
  { key: "umbralVolumenTier3Usd", label: "Volumen propio para escalón 3 (USD/semana)", step: "1" },
  { key: "umbralReferidosTier2", label: "# Referidos activos para escalón 2", step: "1" },
  { key: "umbralReferidosTier3", label: "# Referidos activos para escalón 3", step: "1" },
  { key: "umbralReferidoActivoUsd", label: 'Mínimo de rake para que un referido cuente como "activo" (USD/semana)', step: "1" },
  { key: "pctComisionReferido", label: "Comisión de afiliado (%, sobre rake de referidos directos)", step: "0.1", pct: true },
  { key: "ventanaActividadSemanas", label: "Ventana de actividad para mantener la comisión (semanas)", step: "1" },
];

// (25/09/2026, pedido de Leo: "estaria bueno que diga los %, no que diga el 0.6 asi eviamos
// confusiones") -- en base de datos y en el motor de cálculo, un % se guarda como fracción
// (0.60 = 60%, ver TbConfig en engine/teambackAffiliates.ts) -- eso no cambia. Lo que cambia es
// SOLO cómo se muestra/edita en el input: acá se multiplica x100 para mostrar y se divide /100
// al guardar, así el campo dice "60" en vez de "0,6".
function campoPorcentaje(cfg: any, setCfg: (fn: (c: any) => any) => void, key: string) {
  return {
    value: cfg[key] === "" || cfg[key] == null ? "" : Number((Number(cfg[key]) * 100).toFixed(4)),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setCfg((c: any) => ({ ...c, [key]: v === "" ? "" : Number(v) / 100 }));
    },
  };
}

function FormConfigJugador({ jugador, onSaved }: { jugador: any; onSaved: () => void }) {
  const [cfg, setCfg] = useState<any | null>(null);
  const [yaTeniaConfig, setYaTeniaConfig] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  // Vista previa (13/10/2026, pedido de Leo: "que se modifique en tiempo real lo que tiene que
  // pasar") -- simula, contra la semana más reciente importada, cómo quedaría ESTE jugador con
  // los valores de arriba SIN guardar nada todavía. Se limpia sola en cuanto se toca cualquier
  // campo, para no dejar en pantalla un resultado que ya no corresponde a lo que hay tipeado.
  const [preview, setPreview] = useState<any | null>(null);
  const [previsualizando, setPrevisualizando] = useState(false);

  useEffect(() => {
    (async () => {
      const propia = await api.teamback.getPlayerConfig(jugador.id);
      if (propia) {
        setCfg(propia);
        setYaTeniaConfig(true);
      } else {
        // Sin config propia todavía -- se prellena con la plantilla global como punto de
        // partida, pero aplicarUmbralAComision no viene en CAMPOS_CONFIG (checkbox aparte).
        setCfg(await api.teamback.getConfig());
        setYaTeniaConfig(false);
      }
    })();
  }, [jugador.id]);

  useEffect(() => {
    setPreview(null);
  }, [cfg]);

  async function previsualizar() {
    setPrevisualizando(true);
    setMsg(null);
    try {
      setPreview(await api.teamback.previsualizarPlayerConfig(jugador.id, cfg));
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo previsualizar." });
    } finally {
      setPrevisualizando(false);
    }
  }

  if (!cfg) return <Loading />;

  function num(key: string) {
    return {
      value: cfg[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCfg((c: any) => ({ ...c, [key]: Number(e.target.value) })),
    };
  }

  async function guardar() {
    setLoading(true);
    setMsg(null);
    try {
      await api.teamback.updatePlayerConfig(jugador.id, cfg);
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {!yaTeniaConfig && (
        <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
          {jugador.name} todavía no tiene su propio % cargado -- estos valores son los de la
          plantilla general (pestaña Configuración), como punto de partida. Ajustalos si
          corresponde y guardá para que queden activos para este jugador.
        </div>
      )}
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Los porcentajes van de 0 a 1 (ej. 0.60 = 60%). Cambiar esto NO recalcula liquidaciones ya guardadas -- cada una queda con el % vigente al momento en que se calculó.
      </div>
      <div className="form-grid">
        {CAMPOS_CONFIG.map((c) => (
          <div className="field" key={c.key}>
            <label>{c.label}</label>
            <input type="number" step={c.step} {...(c.pct ? campoPorcentaje(cfg, setCfg, c.key) : num(c.key))} />
          </div>
        ))}
        <div className="field">
          <label>¿El umbral de "referido activo" también aplica a la comisión?</label>
          <select
            value={cfg.aplicarUmbralAComision ? "1" : "0"}
            onChange={(e) => setCfg((c: any) => ({ ...c, aplicarUmbralAComision: e.target.value === "1" }))}
          >
            <option value="0">No -- comisión sobre cualquier rake de referido, sin piso</option>
            <option value="1">Sí -- solo si el referido llegó al umbral esa semana</option>
          </select>
        </div>
      </div>
      {msg && <div className="error">{msg.text}</div>}

      {preview && (
        <div className="panel" style={{ background: "var(--panel-2)", marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Simulación con semana {dateShort(preview.weekStart)} - {dateShort(preview.weekEnd)} (la última importada) -- no se guardó nada todavía.
          </div>
          <div className="kpi-sub-grid">
            <div className="kpi-sub-card">
              <div className="kpi-sub-label">Rakeback ({(preview.rakebackPct * 100).toFixed(1)}%)</div>
              <div className="kpi-sub-value">{usd(preview.rakebackGenerado)}</div>
            </div>
            <div className="kpi-sub-card">
              <div className="kpi-sub-label">Comisión de afiliado{preview.comision3pctPausada ? " (pausada)" : ""}</div>
              <div className="kpi-sub-value">{usd(preview.comision3pctAcreditada)}</div>
            </div>
            <div className="kpi-sub-card">
              <div className="kpi-sub-label">Total acreditado</div>
              <div className="kpi-sub-value" style={{ color: "var(--green)" }}>{usd(preview.totalAcreditado)}</div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={loading} onClick={guardar}>
          {loading ? "Guardando..." : "Guardar"}
        </button>
        <button type="button" className="btn secondary" disabled={previsualizando} onClick={previsualizar}>
          {previsualizando ? "Calculando..." : "Vista previa (sin guardar)"}
        </button>
      </div>
    </div>
  );
}

// ===================================================================================
// Import semanal
// ===================================================================================

function ImportTab() {
  const [file, setFile] = useState<File | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [preview, setPreview] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // (25/09/2026, pedido de Leo: "el seleccionador tiene que contar con seleccionar varios todos
  // o destildar todos") -- de los "conocidos" del archivo, cuáles se importan realmente. Por
  // default entran todos tildados (mismo comportamiento de antes), pero ahora se puede destildar
  // alguno puntual o todos de una.
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  // (25/09/2026, pedido de Leo: "que ahi mismo podamos elegir a jugadores si todavia no estan en
  // la lista y quien lo refirio") -- lista de jugadores ya dados de alta, para el select de
  // "Referido por" al dar de alta uno nuevo sin salir de esta pantalla.
  const [jugadores, setJugadores] = useState<any[]>([]);
  // (25/09/2026, pedido de Leo: "cuando hagamos el cierre en importar semana tiene que haber un
  // lugar donde hagamos click y se liquide") -- semana recién importada (queda acá para poder
  // calcular la liquidación sin tener que ir a la pestaña Resumen y volver a tipear las fechas.
  // Al calcularla se guarda en tb_weekly_liquidations, así que ya aparece sola en Resumen.
  const [semanaImportada, setSemanaImportada] = useState<{ weekStart: string; weekEnd: string } | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [resultadoLiquidacion, setResultadoLiquidacion] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.teamback.listPlayers(true).then(setJugadores);
  }, []);

  async function analizar() {
    if (!file) return setMsg({ ok: false, text: "Elegí un archivo." });
    setLoading(true);
    setMsg(null);
    try {
      const r = await api.teamback.previsualizarImport(file);
      setPreview(r);
      setSeleccionados(new Set(r.conocidos.map((c: any) => c.player.id)));
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo leer el archivo." });
    } finally {
      setLoading(false);
    }
  }

  function toggleSeleccionado(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function seleccionarTodos() {
    if (!preview) return;
    setSeleccionados(new Set(preview.conocidos.map((c: any) => c.player.id)));
  }

  function destildarTodos() {
    setSeleccionados(new Set());
  }

  async function aplicar() {
    if (!preview || !weekStart || !weekEnd) return setMsg({ ok: false, text: "Elegí fecha de inicio y fin de semana." });
    if (seleccionados.size === 0) return setMsg({ ok: false, text: "No seleccionaste ningún jugador para importar." });
    setLoading(true);
    setMsg(null);
    try {
      const rows = preview.conocidos
        .filter((c: any) => seleccionados.has(c.player.id))
        .map((c: any) => ({ supremaPlayerId: c.player.suprema_player_id, supremaPlayerName: c.player.name, rake: c.rake }));
      const r = await api.teamback.aplicarImport({ weekStart, weekEnd, rows, importSource: file?.name });
      setMsg({ ok: true, text: `Importado -- ${r.importados} jugador(es) cargado(s).` });
      setSemanaImportada({ weekStart, weekEnd });
      setResultadoLiquidacion(null);
      setPreview(null);
      setFile(null);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo importar." });
    } finally {
      setLoading(false);
    }
  }

  async function calcularLiquidacionDeSemanaImportada() {
    if (!semanaImportada) return;
    setCalculando(true);
    setResultadoLiquidacion(null);
    try {
      const r = await api.teamback.calcularLiquidaciones(semanaImportada.weekStart, semanaImportada.weekEnd);
      const avisoSinConfigurar = r.sinConfigurar?.length > 0 ? ` (${r.sinConfigurar.length} jugador(es) salteado(s) por no tener % configurado -- cargalo en "Jugadores / árbol" y volvé a calcular)` : "";
      setResultadoLiquidacion({ ok: true, text: `Liquidado -- ${r.resultados.length} jugador(es) con liquidación esta semana.${avisoSinConfigurar} Ya la podés ver en la pestaña Resumen.` });
    } catch (err: any) {
      setResultadoLiquidacion({ ok: false, text: err.message || "No se pudo calcular la liquidación." });
    } finally {
      setCalculando(false);
    }
  }

  // Da de alta un jugador desconocido del archivo sin salir de esta pantalla, y vuelve a
  // analizar el mismo archivo para que pase de "desconocidos" a "conocidos" (con su rake ya
  // calculado) automáticamente.
  async function darDeAltaDesconocido(d: any, referidoPorId: string) {
    setLoading(true);
    setMsg(null);
    try {
      await api.teamback.crearPlayer({
        supremaPlayerId: d.supremaPlayerId,
        name: d.supremaPlayerName,
        referidoPorId: referidoPorId || null,
      });
      setJugadores(await api.teamback.listPlayers(true));
      if (file) {
        const r = await api.teamback.previsualizarImport(file);
        setPreview(r);
        setSeleccionados((prev) => new Set([...prev, ...r.conocidos.map((c: any) => c.player.id)]));
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo dar de alta el jugador." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Archivo de Suprema (.xlsx)</label>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="field" style={{ alignSelf: "flex-end" }}>
          <button className="btn secondary" disabled={loading} onClick={analizar}>
            {loading ? "Leyendo..." : "Analizar archivo"}
          </button>
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}

      {preview && (
        <>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Inicio de semana</label>
              <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Fin de semana</label>
              <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} max={hoyISO()} />
            </div>
            <div className="field" style={{ alignSelf: "flex-end" }}>
              <button className="btn" disabled={loading || seleccionados.size === 0} onClick={aplicar}>
                Importar {seleccionados.size} jugador(es) seleccionado(s)
              </button>
            </div>
          </div>

          {preview.desconocidos.length > 0 && (
            <div className="panel" style={{ marginBottom: 12, background: "var(--panel-2, transparent)" }}>
              <div className="error" style={{ marginBottom: 10 }}>
                {preview.desconocidos.length} jugador(es) del archivo NO están dados de alta todavía -- dalos de alta acá mismo (con quién lo refirió, si corresponde) para que se sumen a la importación:
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Jugador (del archivo)</th>
                    <th>ID Suprema</th>
                    <th className="num">Rake esta semana</th>
                    <th>Referido por</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {preview.desconocidos.map((d: any) => (
                    <FilaDesconocido key={d.supremaPlayerId} d={d} jugadores={jugadores} loading={loading} onAlta={darDeAltaDesconocido} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox"
                    checked={preview.conocidos.length > 0 && seleccionados.size === preview.conocidos.length}
                    onChange={(e) => (e.target.checked ? seleccionarTodos() : destildarTodos())}
                    title="Seleccionar/destildar todos"
                  />
                </th>
                <th>Jugador</th>
                <th>ID Suprema</th>
                <th className="num">Rake esta semana</th>
              </tr>
            </thead>
            <tbody>
              {preview.conocidos.map((c: any) => (
                <tr key={c.player.id}>
                  <td>
                    <input type="checkbox" checked={seleccionados.has(c.player.id)} onChange={() => toggleSeleccionado(c.player.id)} />
                  </td>
                  <td>{c.player.name}</td>
                  <td className="muted">{c.player.suprema_player_id}</td>
                  <td className="num">{usd(c.rake)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            <button className="btn secondary small" onClick={seleccionarTodos} style={{ marginRight: 6 }}>Seleccionar todos</button>
            <button className="btn secondary small" onClick={destildarTodos}>Destildar todos</button>
          </div>
        </>
      )}

      {/* (25/09/2026, pedido de Leo: "estaria bueno que el boton de liquidar este abajo") --
          va al final del panel, no arriba, para que el flujo se lea de arriba a abajo: elegir
          archivo -> revisar/seleccionar jugadores -> importar -> liquidar. */}
      {semanaImportada && !preview && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="topbar" style={{ marginBottom: resultadoLiquidacion ? 10 : 0 }}>
            <div className="muted" style={{ fontSize: 13 }}>
              Semana del {dateShort(semanaImportada.weekStart)} al {dateShort(semanaImportada.weekEnd)} importada. Ahora podés calcular (o recalcular) la liquidación de esa semana:
            </div>
            <button className="btn" disabled={calculando} onClick={calcularLiquidacionDeSemanaImportada}>
              {calculando ? "Calculando..." : "Calcular liquidación de esta semana"}
            </button>
          </div>
          {resultadoLiquidacion && <div className={resultadoLiquidacion.ok ? "success" : "error"}>{resultadoLiquidacion.text}</div>}
        </div>
      )}
    </div>
  );
}

// Fila del importador para un jugador que el archivo trae pero todavía no está dado de alta --
// permite cargarlo (con su "referido por") sin salir de la pantalla de importación.
function FilaDesconocido({
  d,
  jugadores,
  loading,
  onAlta,
}: {
  d: any;
  jugadores: any[];
  loading: boolean;
  onAlta: (d: any, referidoPorId: string) => void;
}) {
  const [referidoPorId, setReferidoPorId] = useState("");
  return (
    <tr>
      <td>{d.supremaPlayerName}</td>
      <td className="muted">{d.supremaPlayerId}</td>
      <td className="num">{usd(d.rake)}</td>
      <td>
        <select value={referidoPorId} onChange={(e) => setReferidoPorId(e.target.value)}>
          <option value="">Nadie (llegó directo)</option>
          {jugadores.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name} ({j.suprema_player_id})
            </option>
          ))}
        </select>
      </td>
      <td>
        <button className="btn secondary small" disabled={loading} onClick={() => onAlta(d, referidoPorId)}>
          + Dar de alta
        </button>
      </td>
    </tr>
  );
}

// ===================================================================================
// Configuración
// ===================================================================================

function ConfigTab() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.teamback.getConfig().then(setCfg);
  }, []);

  if (!cfg) return <div className="panel"><Loading /></div>;

  function num(key: string) {
    return {
      value: cfg[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCfg((c: any) => ({ ...c, [key]: Number(e.target.value) })),
    };
  }

  async function guardar() {
    setLoading(true);
    setMsg(null);
    try {
      setCfg(await api.teamback.updateConfig(cfg));
      setMsg({ ok: true, text: "Configuración guardada." });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        (25/09/2026) Esto YA NO es el % que se le aplica a todos los jugadores -- cada jugador
        tiene el suyo propio (ver "Jugadores / árbol" → "% Configurar"). Esto es solo la
        PLANTILLA: los valores con los que arranca precargado el formulario cuando configurás a
        un jugador por primera vez, para no tener que tipear todo de cero cada vez. Los
        campos de % ya se muestran en formato porcentaje (60 = 60%).
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Rakeback base (%)</label>
          <input type="number" step="0.1" {...campoPorcentaje(cfg, setCfg, "pctBase")} />
        </div>
        <div className="field">
          <label>Rakeback escalón 2 (%)</label>
          <input type="number" step="0.1" {...campoPorcentaje(cfg, setCfg, "pctTier2")} />
        </div>
        <div className="field">
          <label>Rakeback escalón 3 (%)</label>
          <input type="number" step="0.1" {...campoPorcentaje(cfg, setCfg, "pctTier3")} />
        </div>
        <div className="field">
          <label>Volumen propio para escalón 2 (USD/semana)</label>
          <input type="number" step="1" {...num("umbralVolumenTier2Usd")} />
        </div>
        <div className="field">
          <label>Volumen propio para escalón 3 (USD/semana)</label>
          <input type="number" step="1" {...num("umbralVolumenTier3Usd")} />
        </div>
        <div className="field">
          <label># Referidos activos para escalón 2</label>
          <input type="number" step="1" {...num("umbralReferidosTier2")} />
        </div>
        <div className="field">
          <label># Referidos activos para escalón 3</label>
          <input type="number" step="1" {...num("umbralReferidosTier3")} />
        </div>
        <div className="field">
          <label>Mínimo de rake para que un referido cuente como "activo" (USD/semana)</label>
          <input type="number" step="1" {...num("umbralReferidoActivoUsd")} />
        </div>
        <div className="field">
          <label>Comisión de afiliado (%, sobre rake de referidos directos)</label>
          <input type="number" step="0.1" {...campoPorcentaje(cfg, setCfg, "pctComisionReferido")} />
        </div>
        <div className="field">
          <label>Ventana de actividad para mantener la comisión (semanas)</label>
          <input type="number" step="1" {...num("ventanaActividadSemanas")} />
        </div>
        <div className="field">
          <label>¿El mínimo de USD también aplica a la comisión del 3%?</label>
          <select value={cfg.aplicarUmbralAComision ? "1" : "0"} onChange={(e) => setCfg((c: any) => ({ ...c, aplicarUmbralAComision: e.target.value === "1" }))}>
            <option value="0">No -- la comisión se paga sobre lo que rakee cada referido, sin piso (default)</option>
            <option value="1">Sí -- un referido por debajo del mínimo no genera comisión esa semana</option>
          </select>
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading} onClick={guardar}>
        {loading ? "Guardando..." : "Guardar configuración"}
      </button>
    </div>
  );
}

// ===================================================================================
// Usuarios de la sección (25/09/2026, pedido de Leo: "necesito que hagamos usuarios y
// contraseña para esta seccion") -- crear/administrar logins ADMIN (control total) y PLAYER
// (portal de autoservicio, uno por jugador). Todo admin-only.
// ===================================================================================

function UsuariosTab() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [jugadores, setJugadores] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);
  // Estilo de la Wallet (23/10/2026, pedido de Leo): pestañas por rol, buscador y paginación.
  const [rolTab, setRolTab] = useState<"todos" | "admin" | "jugador" | "inactivos">("todos");
  const [buscaU, setBuscaU] = useState("");
  const qU = buscaU.trim().toLowerCase();
  const baseU = usuarios.filter((u) => qU === "" || `${u.name} ${u.username} ${u.player_name ?? ""}`.toLowerCase().includes(qU));
  const visiblesU = baseU.filter((u) => (rolTab === "todos" ? true : rolTab === "admin" ? u.role === "ADMIN" : rolTab === "jugador" ? u.role !== "ADMIN" : !u.active));
  const pgU = usePaginado(visiblesU, "dp_tb_usuarios_tamano", [rolTab, buscaU]);

  async function cargar() {
    setUsuarios(await api.teamback.listUsuarios());
    setJugadores(await api.teamback.listPlayers(true));
  }
  useEffect(() => {
    cargar();
  }, []);

  return (
    <div className="wm-card wm-tabla">
      <div className="wm-cab">
        <div className="wm-h">Usuarios de TeamBack Affiliates <span className="wm-n">{visiblesU.length}</span></div>
        <div className="wm-fil">
          <input className="wm-in" placeholder="Buscar usuario o jugador..." value={buscaU} onChange={(e) => setBuscaU(e.target.value)} />
          <button type="button" className="btn small" onClick={() => setNuevo(true)}>+ Nuevo usuario</button>
        </div>
      </div>
      <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
        Login propio de esta sección -- no tiene nada que ver con "Usuarios y permisos" del resto del sistema. Un ADMIN controla todo; un PLAYER solo ve su propia liquidación (un jugador puede tener a lo sumo un login).
      </div>
      <WmTabs
        actual={rolTab}
        onChange={setRolTab}
        tabs={
          [
            { k: "todos", t: "Todos", n: baseU.length },
            { k: "admin", t: "Admins", n: baseU.filter((u) => u.role === "ADMIN").length },
            { k: "jugador", t: "Jugadores", n: baseU.filter((u) => u.role !== "ADMIN").length },
            { k: "inactivos", t: "Inactivos", n: baseU.filter((u) => !u.active).length },
          ] as WmTab<typeof rolTab>[]
        }
      />
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Usuario</th>
            <th>Rol</th>
            <th>Jugador</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pgU.recorte.map((u) => (
            <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
              <td>{u.name}</td>
              <td className="muted">{u.username}</td>
              <td>{u.role === "ADMIN" ? <span className="badge pos">Admin</span> : <span className="badge">Jugador</span>}</td>
              <td className="muted">{u.player_name ? `${u.player_name} (${u.suprema_player_id})` : "—"}</td>
              <td>{u.active ? <span className="badge pos">Activo</span> : <span className="badge neg">Inactivo</span>}</td>
              <td>
                <button className="btn secondary small" onClick={() => setEditando(u)}>Editar</button>
              </td>
            </tr>
          ))}
          {visiblesU.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">{usuarios.length === 0 ? "Sin usuarios todavía." : "Ningún usuario coincide con estos filtros."}</td>
            </tr>
          )}
        </tbody>
      </table>
      <WmPaginacion p={pgU} unidad="usuarios" />

      {nuevo && (
        <Modal title="Nuevo usuario" onClose={() => setNuevo(false)}>
          <FormUsuario jugadores={jugadores} onSaved={() => { setNuevo(false); cargar(); }} />
        </Modal>
      )}
      {editando && (
        <Modal title={`Editar — ${editando.name}`} onClose={() => setEditando(null)}>
          <FormEditarUsuario usuario={editando} onSaved={() => { setEditando(null); cargar(); }} />
        </Modal>
      )}
    </div>
  );
}

// (25/09/2026, pedido de Leo: "los usuarios van a tener usuarios con su nombre no con su ID de
// juego, asi evitamos confusiones") -- convierte el nombre del jugador en un usuario de login
// legible (sin tildes, en minúsculas, separado por puntos): "Juan Pérez" -> "juan.perez". Se usa
// como valor por defecto (obligatorio, se autocompleta solo) al elegir el jugador -- se puede
// editar a mano después si ya está tomado por otro login.
function nombreAUsuario(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function FormUsuario({ jugadores, onSaved }: { jugadores: any[]; onSaved: () => void }) {
  const [role, setRole] = useState<"ADMIN" | "PLAYER">("ADMIN");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Jugadores que todavía no tienen login -- no tiene sentido ofrecer uno que ya tiene.
  const jugadoresSinLogin = jugadores; // el backend igual rechaza un duplicado; simple por ahora.

  // Al elegir el jugador, se autocompletan Nombre y Usuario en base a SU nombre (no a su ID de
  // Suprema) -- el usuario por defecto queda asignado sí o sí, y sigue siendo editable por si
  // ya está tomado (ver "Tester" / "Tester_2" en la lista: mismo nombre, login distinto).
  function elegirJugador(id: string) {
    setPlayerId(id);
    const j = jugadoresSinLogin.find((x) => x.id === id);
    if (j) {
      setName(j.name);
      setUsername(nombreAUsuario(j.name));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim() || !username.trim() || !password) return setMsg({ ok: false, text: "Nombre, usuario y contraseña son obligatorios." });
    if (role === "PLAYER" && !playerId) return setMsg({ ok: false, text: "Elegí a qué jugador corresponde este login." });
    setLoading(true);
    try {
      await api.teamback.crearUsuario({ role, name: name.trim(), username: username.trim(), password, playerId: role === "PLAYER" ? playerId : null });
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo crear." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Rol</label>
          <select value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="ADMIN">Admin (control total de la sección)</option>
            <option value="PLAYER">Jugador (portal, solo su propia liquidación)</option>
          </select>
        </div>
        {role === "PLAYER" && (
          <div className="field">
            <label>Jugador</label>
            <select value={playerId} onChange={(e) => elegirJugador(e.target.value)}>
              <option value="">Elegir...</option>
              {jugadoresSinLogin.map((j) => (
                <option key={j.id} value={j.id}>{j.name} ({j.suprema_player_id})</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Usuario</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" name="tb-nuevo-usuario" />
          {role === "PLAYER" && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              Se arma solo a partir del nombre del jugador -- cambialo acá si ya está en uso.
            </div>
          )}
        </div>
        <div className="field">
          <label>Contraseña</label>
          <CampoContrasena value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>
        {loading ? "Creando..." : "Crear usuario"}
      </button>
    </form>
  );
}

function FormEditarUsuario({ usuario, onSaved }: { usuario: any; onSaved: () => void }) {
  const [active, setActive] = useState(usuario.active);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function guardar() {
    setMsg(null);
    if (password && password.length < 6) return setMsg({ ok: false, text: "La contraseña tiene que tener al menos 6 caracteres." });
    setLoading(true);
    try {
      await api.teamback.actualizarUsuario(usuario.id, { active, ...(password ? { password } : {}) });
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label>Estado</label>
          <select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Activo</option>
            <option value="0">Inactivo</option>
          </select>
        </div>
        <div className="field">
          <label>Resetear contraseña (opcional)</label>
          <CampoContrasena placeholder="Dejar vacío para no cambiarla" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading} onClick={guardar}>
        {loading ? "Guardando..." : "Guardar"}
      </button>
    </div>
  );
}
