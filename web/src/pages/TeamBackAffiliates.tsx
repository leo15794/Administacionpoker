// TeamBack Affiliates V1 (25/09/2026, pedido de Leo) -- pantalla TOTALMENTE APARTE del resto
// del sistema (nada de agentes/clubes/liquidaciones de DigiPlayers). Programa de rakeback +
// referidos directo al jugador, sobre Suprema Poker.
// (25/09/2026, pedido de Leo: "necesito que hagamos usuarios y contraseña para esta seccion")
// -- esta pantalla tiene su PROPIO login (ver lib/tbAuth.ts y routes/teambackAuth.ts en el
// backend), totalmente aparte del login del resto del sistema -- aunque ya estés adentro de
// DigiPlayers como admin, para entrar acá hace falta un usuario/contraseña propio de esta
// sección. Dos roles: ADMIN (todo el control, las pestañas de siempre) y PLAYER (portal de
// autoservicio, ve solo su propia liquidación semana a semana).
import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import Modal from "../components/Modal";

type Tab = "resumen" | "jugadores" | "import" | "ganancia" | "config" | "usuarios";

const TB_SESSION_KEY = "tb_session";

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
}

function cerrarTbSession() {
  localStorage.removeItem(TB_SESSION_KEY);
  localStorage.removeItem("tb_token");
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
  return "dark";
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

  if (!session) return <TbLogin onLoggedIn={setSession} />;
  if (session.role === "PLAYER") return <TeamBackPortalJugador session={session} onLogout={() => { cerrarTbSession(); setSession(null); }} />;
  return <TeamBackAdmin session={session} onLogout={() => { cerrarTbSession(); setSession(null); }} />;
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

  return (
    <div className="login-shell">
      <div className="login-box">
        <div className="login-mark">T</div>
        <h1>TeamBack Affiliates</h1>
        <div className="sub">Login propio de esta sección -- no es tu usuario del resto de DigiPlayers.</div>
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Usuario</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <CampoContrasena value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
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

const TB_NAV: { key: Tab; label: string; icon: keyof typeof tbIcon }[] = [
  { key: "resumen", label: "Liquidaciones", icon: "liquidaciones" },
  { key: "jugadores", label: "Jugadores / árbol", icon: "jugadores" },
  { key: "import", label: "Importar semana", icon: "import" },
  { key: "ganancia", label: "Ganancia por semana", icon: "ganancia" },
  { key: "config", label: "Configuración (plantilla)", icon: "config" },
  { key: "usuarios", label: "Usuarios", icon: "usuarios" },
];

// (25/09/2026, pedido de Leo: "hagamos el menu como la administracion de poker") -- mismo
// esquema visual que Shell.tsx (.app-shell / .sidebar / .nav-link), pero acá la navegación es
// por tab de estado (no por ruta react-router): esta sección sigue siendo una sola ruta
// (/teamback) con su propio login aparte, así que los ítems del menú son <button> con la clase
// "nav-link" en vez de <NavLink>, ver ".nav-link" reseteado para <button> en index.css.
function getInitialTbCollapsed() {
  try {
    return localStorage.getItem("dp_sidebar_collapsed") === "1";
  } catch {
    return false;
  }
}

function TeamBackAdmin({ session, onLogout }: { session: TbSession; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("resumen");
  const [collapsed, setCollapsed] = useState(getInitialTbCollapsed);
  const [theme, setTheme] = useState<TbTheme>(leerTemaInicial);
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

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("dp_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* localStorage no disponible */
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
          {collapsed ? tbIcon.expand : tbIcon.collapse}
        </button>

        <div className="brand">
          <div className="brand-mark">T</div>
          {!collapsed && (
            <div>
              <h1>TeamBack</h1>
              <div className="sub" style={{ marginBottom: 0, paddingLeft: 0 }}>Affiliates</div>
            </div>
          )}
        </div>

        <nav>
          <div className="nav-section">
            {TB_NAV.map((item) => (
              <button
                key={item.key}
                className={`nav-link ${tab === item.key ? "active" : ""}`}
                onClick={() => setTab(item.key)}
                title={item.label}
              >
                {tbIcon[item.icon]} {!collapsed && item.label}
              </button>
            ))}
          </div>
          <button
            className="nav-link"
            onClick={toggleTheme}
            title={theme === "dark" ? "Modo día" : "Modo noche"}
            style={{ borderTop: "1px solid var(--border)", borderLeft: "none", borderRight: "none", borderBottom: "none", marginTop: 8, paddingTop: 14 }}
          >
            {theme === "dark" ? tbIcon.sun : tbIcon.moon} {!collapsed && (theme === "dark" ? "Modo día" : "Modo noche")}
          </button>
        </nav>

        <div className="sidebar-footer">
          {!collapsed && <div className="muted" style={{ fontSize: 12, marginBottom: 8, paddingLeft: 4 }}>{session.name}</div>}
          <button
            className="btn secondary"
            onClick={onLogout}
            title="Cerrar sesión"
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
          >
            {tbIcon.logout} {!collapsed && "Cerrar sesión"}
          </button>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div>
            <h2>{tabActual?.label}</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              Programa de rakeback + referidos directo al jugador — Suprema Poker. Sección aparte, no toca nada del resto del sistema.
            </div>
          </div>
        </div>

        {tab === "resumen" && <LiquidacionesTab />}
        {tab === "jugadores" && <JugadoresTab />}
        {tab === "import" && <ImportTab />}
        {tab === "ganancia" && <GananciaSemanalTab />}
        {tab === "config" && <ConfigTab />}
        {tab === "usuarios" && <UsuariosTab />}
      </div>
    </div>
  );
}

// ===================================================================================
// Portal del jugador (autoservicio, solo lectura de su propia liquidación)
// ===================================================================================

function TeamBackPortalJugador({ session, onLogout }: { session: TbSession; onLogout: () => void }) {
  const [cuenta, setCuenta] = useState<any | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  const [seleccion, setSeleccion] = useState<any | null>(null);

  useEffect(() => {
    api.teamback.portal.miCuenta().then(setCuenta);
    api.teamback.portal.historial().then(setHistorial);
  }, []);

  return (
    <div className="page">
      <div className="topbar">
        <h2>Mi liquidación — TeamBack Affiliates</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          {cuenta ? `${cuenta.name} (${cuenta.suprema_player_id})` : session.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn secondary small" onClick={onLogout}>Cerrar sesión</button>
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              <th>Rake propio</th>
              <th>Referidos activos</th>
              <th>Escalón</th>
              <th>Rakeback</th>
              <th>Comisión 3%</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {historial.map((l) => (
              <tr key={l.id}>
                <td>{dateShort(l.week_start)} al {dateShort(l.week_end)}</td>
                <td>{usd(l.rake_propio)}</td>
                <td>{l.referidos_activos_count}</td>
                <td>
                  {pct(l.rakeback_pct)}{" "}
                  <span className="muted" style={{ fontSize: 11 }}>
                    ({l.tier_alcanzado_por === "BASE" ? "base" : l.tier_alcanzado_por === "VOLUMEN" ? "volumen" : "referidos"})
                  </span>
                </td>
                <td>{usd(l.rakeback_generado)}</td>
                <td>
                  {usd(l.comision_3pct_acreditada)}
                  {l.comision_3pct_pausada && (
                    <span className="badge neg" style={{ marginLeft: 6, fontSize: 10 }} title="No tuviste actividad propia en la ventana de semanas configurada -- comisión pausada esta semana.">
                      pausada
                    </span>
                  )}
                </td>
                <td><strong>{usd(l.total_acreditado)}</strong></td>
                <td>
                  <button className="btn secondary small" onClick={() => setSeleccion(l)}>Ver</button>
                </td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">Todavía no tenés ninguna liquidación calculada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {seleccion && (
        <Modal title={`Semana del ${dateShort(seleccion.week_start)}`} onClose={() => setSeleccion(null)}>
          <BloqueLiquidacionCopiable liquidacion={seleccion} />
        </Modal>
      )}
    </div>
  );
}

// ===================================================================================
// Liquidaciones
// ===================================================================================

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function LiquidacionesTab() {
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [filas, setFilas] = useState<any[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [individual, setIndividual] = useState<any | null>(null);
  const [sinConfigurar, setSinConfigurar] = useState<{ playerId: string; playerName: string; supremaPlayerId: string }[]>([]);
  const [eliminando, setEliminando] = useState(false);

  async function cargarSemanas() {
    const r = await api.teamback.semanasDisponibles();
    setSemanas(r);
    if (r[0]) {
      setWeekStart(String(r[0].week_start).slice(0, 10));
      cargarFilas(String(r[0].week_start).slice(0, 10));
    }
  }

  async function cargarFilas(ws: string) {
    if (!ws) return;
    setFilas(await api.teamback.liquidacionesSemana(ws));
  }

  useEffect(() => {
    cargarSemanas();
  }, []);

  async function calcular() {
    if (!weekStart || !weekEnd) return setMsg({ ok: false, text: "Elegí fecha de inicio y fin de semana." });
    setCalculando(true);
    setMsg(null);
    try {
      const r = await api.teamback.calcularLiquidaciones(weekStart, weekEnd);
      setFilas(r.resultados);
      setSinConfigurar(r.sinConfigurar ?? []);
      const avisoSinConfigurar = r.sinConfigurar?.length > 0 ? ` (${r.sinConfigurar.length} jugador(es) salteado(s) por no tener % configurado todavía -- ver abajo)` : "";
      setMsg({ ok: true, text: `Calculado -- ${r.resultados.length} jugador(es) con liquidación esta semana.${avisoSinConfigurar}` });
      cargarSemanas();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo calcular." });
    } finally {
      setCalculando(false);
    }
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
      setWeekEnd("");
      cargarSemanas();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo eliminar la semana." });
    } finally {
      setEliminando(false);
    }
  }

  const totalGeneral = filas.reduce((acc, f) => acc + Number(f.total_acreditado), 0);

  return (
    <div className="panel">
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Semana ya calculada</label>
          <select
            value={weekStart}
            onChange={(e) => {
              setWeekStart(e.target.value);
              cargarFilas(e.target.value);
            }}
          >
            <option value="">Elegir...</option>
            {semanas.map((s) => (
              <option key={s.week_start} value={String(s.week_start).slice(0, 10)}>
                {dateShort(s.week_start)} al {dateShort(s.week_end)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Calcular semana nueva -- inicio</label>
          <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </div>
        <div className="field">
          <label>fin</label>
          <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} max={hoyISO()} />
        </div>
        <div className="field" style={{ alignSelf: "flex-end" }}>
          <button className="btn" disabled={calculando} onClick={calcular}>
            {calculando ? "Calculando..." : "Calcular / recalcular"}
          </button>
        </div>
        {weekStart && filas.length > 0 && (
          <div className="field" style={{ alignSelf: "flex-end" }}>
            <button className="btn secondary" disabled={eliminando} onClick={eliminarSemanaActual} title="Borra la liquidación y el rake importado de esta semana -- para pruebas">
              {eliminando ? "Eliminando..." : "🗑 Eliminar esta semana"}
            </button>
          </div>
        )}
      </div>
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

      <table>
        <thead>
          <tr>
            <th>Jugador</th>
            <th>ID Suprema</th>
            <th>Rake propio</th>
            <th>Referidos activos</th>
            <th>Escalón</th>
            <th>Rakeback</th>
            <th>Rake referidos</th>
            <th>Comisión 3%</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td>{f.player_name}</td>
              <td className="muted">{f.suprema_player_id}</td>
              <td>{usd(f.rake_propio)}</td>
              <td>{f.referidos_activos_count}</td>
              <td>
                {pct(f.rakeback_pct)}{" "}
                <span className="muted" style={{ fontSize: 11 }}>
                  ({f.tier_alcanzado_por === "BASE" ? "base" : f.tier_alcanzado_por === "VOLUMEN" ? "volumen" : "referidos"})
                </span>
              </td>
              <td>{usd(f.rakeback_generado)}</td>
              <td>{usd(f.rake_referidos_directos)}</td>
              <td>
                {usd(f.comision_3pct_acreditada)}
                {f.comision_3pct_pausada && (
                  <span className="badge neg" style={{ marginLeft: 6, fontSize: 10 }} title="El referente no tuvo actividad propia en la ventana de semanas configurada -- comisión pausada esta semana.">
                    pausada
                  </span>
                )}
              </td>
              <td>
                <strong>{usd(f.total_acreditado)}</strong>
              </td>
              <td>
                <button className="btn secondary small" onClick={() => setIndividual({ player_name: f.player_name, weekStart: String(f.week_start).slice(0, 10), playerId: f.player_id })}>
                  Ver liquidación
                </button>
              </td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={10} className="muted">
                Sin datos para esta semana todavía.
              </td>
            </tr>
          )}
        </tbody>
        {filas.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={8}>
                <strong>Total general</strong>
              </td>
              <td>
                <strong>{usd(totalGeneral)}</strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>

      {individual && (
        <Modal title={`Liquidación — ${individual.player_name}`} onClose={() => setIndividual(null)}>
          <LiquidacionIndividual playerId={individual.playerId} weekStart={individual.weekStart} />
        </Modal>
      )}
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
  const [filas, setFilas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pagando, setPagando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function cargar() {
    setCargando(true);
    try {
      setFilas(await api.teamback.gananciaSemanal());
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cargar." });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function pagar(f: any) {
    const confirmado = window.confirm(
      `¿Marcar como pagada la liquidación de la semana del ${dateShort(f.week_start)} al ${dateShort(f.week_end)} (${usd(f.total_liquidado)})?`
    );
    if (!confirmado) return;
    setPagando(f.week_start);
    setMsg(null);
    try {
      await api.teamback.marcarSemanaPagada(f.week_start, f.week_end);
      await cargar();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo marcar como pagada." });
    } finally {
      setPagando(null);
    }
  }

  async function deshacerPago(f: any) {
    const confirmado = window.confirm(`¿Deshacer el pago de la semana del ${dateShort(f.week_start)}?`);
    if (!confirmado) return;
    setPagando(f.week_start);
    setMsg(null);
    try {
      await api.teamback.deshacerSemanaPagada(f.week_start);
      await cargar();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo deshacer el pago." });
    } finally {
      setPagando(null);
    }
  }

  if (cargando) return <div className="panel muted">Cargando...</div>;

  return (
    <div className="panel">
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Ganancia = (rake propio total de la semana × 80%) − total liquidado a los jugadores esa
        semana (rakeback + comisiones). Solo aparecen semanas que ya tienen liquidación calculada
        (pestaña Liquidaciones o el botón de Importar semana).
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <table>
        <thead>
          <tr>
            <th>Semana</th>
            <th>Rake propio total</th>
            <th>Rake al 80%</th>
            <th>Total liquidado</th>
            <th>Ganancia</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.week_start}>
              <td>{dateShort(f.week_start)} al {dateShort(f.week_end)}</td>
              <td>{usd(f.rake_propio_total)}</td>
              <td>{usd(f.rake_al_80_pct)}</td>
              <td>{usd(f.total_liquidado)}</td>
              <td>
                <strong className={f.ganancia >= 0 ? "pos" : "neg"}>{usd(f.ganancia)}</strong>
              </td>
              <td>
                {f.pagada ? (
                  <span className="badge pos" title={f.paid_at ? `Pagada el ${dateShort(f.paid_at)}` : undefined}>Pagada</span>
                ) : (
                  <span className="badge neg">Pendiente</span>
                )}
              </td>
              <td>
                {f.pagada ? (
                  <button className="btn secondary small" disabled={pagando === f.week_start} onClick={() => deshacerPago(f)}>
                    Deshacer pago
                  </button>
                ) : (
                  <button className="btn small" disabled={pagando === f.week_start} onClick={() => pagar(f)}>
                    {pagando === f.week_start ? "..." : "Pagar"}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">Todavía no hay ninguna semana liquidada.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Formato de liquidación lista para copiar/mandarle al jugador -- compartido entre la vista de
// admin (LiquidacionIndividual, pide el dato por playerId+weekStart) y el portal del propio
// jugador (que ya tiene la fila entera de antes, no necesita pedir nada más).
function textoLiquidacion(l: any): string {
  return [
    `Rake propio: ${usd(l.rake_propio)}`,
    `Referidos activos: ${l.referidos_activos_count}`,
    `Rakeback aplicado: ${pct(l.rakeback_pct)}`,
    `Rakeback generado: ${usd(l.rakeback_generado)}`,
    `Rake generado por referidos: ${usd(l.rake_referidos_directos)}`,
    `Comisión de afiliado 3%: ${usd(l.comision_3pct_acreditada)}${l.comision_3pct_pausada ? " (pausada esta semana)" : ""}`,
    `Total acreditado: ${usd(l.total_acreditado)}`,
  ].join("\n");
}

function BloqueLiquidacionCopiable({ liquidacion }: { liquidacion: any }) {
  const texto = textoLiquidacion(liquidacion);
  return (
    <div>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7 }}>{texto}</pre>
      <button
        className="btn secondary small"
        onClick={() => {
          navigator.clipboard?.writeText(texto);
        }}
      >
        Copiar
      </button>
    </div>
  );
}

function LiquidacionIndividual({ playerId, weekStart }: { playerId: string; weekStart: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    api.teamback.liquidacionIndividual(playerId, weekStart).then(setData);
  }, [playerId, weekStart]);

  if (!data) return <div className="muted">Cargando...</div>;
  return <BloqueLiquidacionCopiable liquidacion={data.liquidacion} />;
}

// ===================================================================================
// Jugadores / árbol
// ===================================================================================

function JugadoresTab() {
  const [jugadores, setJugadores] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState<any | null>(null);
  const [configurando, setConfigurando] = useState<any | null>(null);

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

  function filaJugador(j: any) {
    return (
      <tr key={j.id} style={j.active ? undefined : { opacity: 0.55 }}>
        <td>{j.name}</td>
        <td className="muted">{j.suprema_player_id}</td>
        <td>{dateShort(j.fecha_alta)}</td>
        <td className="muted">{j.referido_por_name ?? "—"}</td>
        <td>{j.referidos_count}</td>
        <td>{usd(j.comision_total)}</td>
        <td>
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
    <>
      <div className="panel">
        <div className="topbar" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Jugadores</h3>
          <button className="btn small" onClick={() => setNuevo({})}>+ Nuevo jugador</button>
        </div>
        <div className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
          Cada jugador tiene su propio % de rakeback, escalones y comisión -- no hay un % general
          para todos. Un jugador marcado "Sin % configurar" no se liquida hasta que le cargues el
          suyo (botón "% Configurar").
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 10px" }}>Jugadores directos ({directos.length})</h3>
        <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
          Llegaron solos, sin que nadie los haya referido.
        </div>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>ID Suprema</th>
              <th>Fecha de alta</th>
              <th>Referido por</th>
              <th># Referidos</th>
              <th>Comisión acumulada</th>
              <th>%</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>{directos.map(filaJugador)}</tbody>
        </table>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 10px" }}>Jugadores referidos ({referidos.length})</h3>
        <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
          Entraron referidos por otro jugador (columna "Referido por").
        </div>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>ID Suprema</th>
              <th>Fecha de alta</th>
              <th>Referido por</th>
              <th># Referidos</th>
              <th>Comisión acumulada</th>
              <th>%</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>{referidos.map(filaJugador)}</tbody>
        </table>
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
    </>
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

  if (!cfg) return <div className="muted">Cargando...</div>;

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
      <button className="btn" disabled={loading} onClick={guardar}>
        {loading ? "Guardando..." : "Guardar"}
      </button>
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

      {semanaImportada && !preview && (
        <div className="panel" style={{ marginBottom: 12 }}>
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
                    <th>Rake esta semana</th>
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
                <th>Rake esta semana</th>
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
                  <td>{usd(c.rake)}</td>
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
      <td>{usd(d.rake)}</td>
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

  if (!cfg) return <div className="panel muted">Cargando...</div>;

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

  async function cargar() {
    setUsuarios(await api.teamback.listUsuarios());
    setJugadores(await api.teamback.listPlayers(true));
  }
  useEffect(() => {
    cargar();
  }, []);

  return (
    <div className="panel">
      <div className="topbar" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Usuarios de TeamBack Affiliates</h3>
        <button className="btn small" onClick={() => setNuevo(true)}>+ Nuevo usuario</button>
      </div>
      <div className="muted" style={{ marginBottom: 10, fontSize: 13 }}>
        Login propio de esta sección -- no tiene nada que ver con "Usuarios y permisos" del resto del sistema. Un ADMIN controla todo; un PLAYER solo ve su propia liquidación (un jugador puede tener a lo sumo un login).
      </div>
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
          {usuarios.map((u) => (
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
          {usuarios.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">Sin usuarios todavía.</td>
            </tr>
          )}
        </tbody>
      </table>

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
