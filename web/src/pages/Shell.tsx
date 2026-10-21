import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import GlobalSearch from "../components/GlobalSearch";
import NotificationBell from "../components/NotificationBell";
import IdleGuard from "../components/IdleGuard";
import InstallAppBanner from "../components/InstallAppBanner";
import PortalNotificacionesBanner from "../components/PortalNotificacionesBanner";
import BandejaAvisos from "../components/BandejaAvisos";
import { DockOverlay, useMenuPos } from "../components/MenuDock";
import Notificaciones from "./Notificaciones";

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
  rodeo: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" />
    </svg>
  ),
  resumenAgentes: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /><path d="M9 13h6" /><path d="M9 17h6" />
    </svg>
  ),
  usuarios: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
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
  supervisores: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3" /><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" /><circle cx="19" cy="6" r="2" />
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
  avisos: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
    </svg>
  ),
  notificaciones: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
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
  // Menú hamburguesa / cerrar (15/10/2026, pedido de Leo: responsive mobile) -- abre/cierra el
  // drawer del sidebar en pantallas chicas (ver .mobile-nav-toggle / .sidebar.mobile-open en
  // index.css).
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
};

type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem("dp_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage no disponible, sigue con el default */
  }
  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// Menú tipo dock (21/10/2026, pedido de Leo): por defecto compacto (solo íconos, se abre al pasar el mouse) y con los grupos cerrados.
// Lo que se abre o se fija vive solo en esta sesión (sessionStorage) y se borra al cerrar sesión: la próxima vez vuelve todo comprimido.
const CLAVE_FIJO = "dp_sidebar_pinned";
const CLAVE_GRUPOS = "dp_nav_groups_open";
function getInitialPinned() {
  try {
    return sessionStorage.getItem(CLAVE_FIJO) === "1";
  } catch {
    return false;
  }
}

// Ítems del menú de ADMIN, en su orden por default — se puede reordenar arrastrando (ver
// navOrder más abajo), y ese orden queda guardado por navegador (localStorage), no es una
// preferencia del usuario en la base — cada uno arma el menú a su gusto en su propia máquina.
// (25/09/2026, pedido de Leo: reorganizar el menú en OPERACIÓN / FINANZAS / REPORTES) —
// mismos ítems, mismas rutas, mismos labels; lo único que cambia es a qué sección pertenece
// cada uno. OPERACIÓN = pantallas de uso diario/operativo (cargar cosas, administrar). FINANZAS
// = todo lo que mueve o refleja plata (wallet, garantías, adelantos, etc). REPORTES = pantallas
// de solo-lectura que resumen/analizan datos (los "resumen de..." y "ganancias por...").
const NAV_ITEMS: { key: string; to: string; end?: boolean; icon: keyof typeof icon; label: string; group: "operacion" | "finanzas" | "reportes" }[] = [
  { key: "resumen", to: "/dashboard", end: true, icon: "resumen", label: "Resumen", group: "operacion" },
  { key: "agentes", to: "/dashboard/agentes", icon: "agentes", label: "Administración", group: "operacion" },
  { key: "movimientos", to: "/dashboard/movimientos", icon: "movimientos", label: "Cargar movimiento", group: "operacion" },
  { key: "cierres", to: "/dashboard/cierres", icon: "cierres", label: "Cierres semanales", group: "operacion" },
  { key: "jugadoresBancados", to: "/dashboard/jugadores-bancados", icon: "jugadoresBancados", label: "Jugadores bancados", group: "operacion" },
  { key: "usuarios", to: "/dashboard/usuarios", icon: "usuarios", label: "Usuarios y permisos", group: "operacion" },
  { key: "wallet", to: "/dashboard/wallet", icon: "wallet", label: "Wallet", group: "finanzas" },
  { key: "garantias", to: "/dashboard/garantias", icon: "garantias", label: "Garantías", group: "finanzas" },
  { key: "proveedores", to: "/dashboard/proveedores", icon: "proveedores", label: "Proveedores", group: "finanzas" },
  { key: "supervisores", to: "/dashboard/supervisores", icon: "supervisores", label: "Supervisores", group: "finanzas" },
  { key: "cuentasAgentes", to: "/dashboard/cuentas-agentes", icon: "cuenta", label: "Agentes", group: "finanzas" },
  // "Rakeback pendiente" salió del menú (21/10/2026, pedido de Leo): todos los agentes se manejan desde Supervisores o Agentes. La ruta
  // /dashboard/rakeback-pendiente sigue existiendo (con un aviso) por si hay que volver a usarla.
  { key: "cuentasSocios", to: "/dashboard/cuentas-socios", icon: "cuentasSocios", label: "Cuentas de socios", group: "finanzas" },
  // "Liquidaciones" salió del menú (21/10/2026, pedido de Leo): todo se maneja desde Supervisores y Agentes. La ruta /dashboard/liquidaciones sigue existiendo
  // (con un aviso) como historial y por si hay que volver a usarla.
  { key: "comisionesReferidos", to: "/dashboard/comisiones-referidos", icon: "comisionesReferidos", label: "Comisiones por referido", group: "finanzas" },
  { key: "resumenClub", to: "/dashboard/resumen-club", icon: "resumenClub", label: "Resumen por club", group: "reportes" },
  { key: "rodeo", to: "/dashboard/rodeo", icon: "rodeo", label: "Resumen de Rodeo", group: "reportes" },
  { key: "resumenAgentes", to: "/dashboard/resumen-agentes", icon: "resumenAgentes", label: "Resumen por agente", group: "reportes" },
  { key: "resumenFinanciero", to: "/dashboard/resumen-financiero", icon: "resumenFinanciero", label: "Resumen financiero", group: "reportes" },
];
const DEFAULT_NAV_ORDER = NAV_ITEMS.map((i) => i.key);

// Ícono de cada grupo cuando el menú está compacto y el grupo cerrado.
const GROUP_ICON: Record<"operacion" | "finanzas" | "reportes", keyof typeof icon> = { operacion: "movimientos", finanzas: "wallet", reportes: "resumenClub" };

const NAV_GROUPS: { key: "operacion" | "finanzas" | "reportes"; label: string }[] = [
  { key: "operacion", label: "Operación" },
  { key: "finanzas", label: "Finanzas" },
  { key: "reportes", label: "Reportes" },
];

function getInitialGroupsOpen(): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(CLAVE_GRUPOS);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

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

export default function Shell({ role }: { role: "ADMIN" | "AGENT" | "SUPERVISOR" | "PROVEEDOR" }) {
  const nav = useNavigate();
  const location = useLocation();
  const [pinned, setPinned] = useState(getInitialPinned);
  const [desplegado, setDesplegado] = useState<string | null>(null);
  const { pos, arrastrando, empezarArrastre } = useMenuPos(() => setDesplegado(null));
  // Panel de avisos a la derecha (21/10/2026, pedido de Leo): arranca cerrado, se monta la primera vez que se abre y después queda montado
  // (oculto) para no perder lo que se estaba escribiendo; se puede agrandar a pantalla completa.
  const [avisosAbierto, setAvisosAbierto] = useState(false);
  const [avisosCompleto, setAvisosCompleto] = useState(false);
  const [avisosMontado, setAvisosMontado] = useState(false);
  // Drawer del sidebar en mobile (15/10/2026) -- estado aparte de "collapsed" (que es el
  // colapsar-a-íconos de escritorio, persistido en localStorage): este es un on/off simple,
  // nunca persistido, que arranca siempre cerrado y se cierra solo al navegar.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [navOrder, setNavOrder] = useState<string[]>(getInitialNavOrder);
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>(getInitialGroupsOpen);
  const dragKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // (24/09/2026, pedido de Leo: "a veces hay que apretar F5 para que se actualice") -- en vez de
  // wirear un refresh manual en cada una de las ~25 pantallas, se refresca la pantalla actual
  // sola cuando volvés a esta pestaña después de estar en otra (visibilitychange). El mecanismo
  // es cambiarle la key a <Outlet/> más abajo: React desmonta y vuelve a montar la pantalla
  // activa, lo que dispara el mismo fetch inicial que cada pantalla ya tiene al cargar -- no
  // hace falta tocar ninguna pantalla puntual. OJO: esto resetea cualquier cosa que no esté
  // guardada en esa pantalla (un formulario a medio llenar, un filtro, una fila en edición) --
  // por eso el disparador tiene que ser algo que pase solo cuando REALMENTE tiene sentido asumir
  // que no había nada a medio llenar (volviste de otra pestaña/ventana).
  // (25/09/2026, bug reportado por Leo: "cuando subís el archivo no se carga" en Jugadores
  // Bancados) -- originalmente esto también escuchaba window "focus", pero un <input
  // type="file"> abre un diálogo NATIVO del sistema operativo, que le saca el foco a la ventana
  // del navegador; al elegir el archivo y volver, ese diálogo se cierra y dispara "focus" en la
  // ventana IGUAL que si hubieras cambiado de pestaña -- eso desmontaba la pantalla (y con ella
  // el archivo recién elegido) justo después de seleccionarlo. Se sacó el disparador de foco y
  // quedó solo visibilitychange (que no se dispara con un diálogo nativo, solo con un cambio
  // real de pestaña/minimizado).
  // (25/09/2026, pedido de Leo: revisar si el auto-refresh "hacía lío" en otras pantallas) --
  // también había un segundo disparador acá, un evento "dp:datos-cambiaron" que api.ts lanzaba
  // después de CUALQUIER POST/PUT/PATCH/DELETE exitoso en cualquier parte de la app. Se sacó
  // entero: como react-router solo tiene montada la pantalla activa, ese evento nunca podía
  // ayudar a OTRA pantalla -- solo remontaba la que ya estabas mirando, y cada pantalla ya
  // refresca sola su propia lista después de sus propias acciones (patrón refresh() que ya
  // existía en toda la app, de antes de este cambio). El único efecto real que tenía era el
  // riesgo: CUALQUIER acción en CUALQUIER parte de la pantalla activa (ej. pagar una fila de la
  // lista) podía borrar de golpe un formulario a medio llenar en otra parte de esa misma
  // pantalla (ya pasó dos veces: el archivo elegido en un input, y el resultado de "Analizar
  // archivo" en Bancados/TeamBack). Ver api.ts para el detalle completo.
  const [refreshKey, setRefreshKey] = useState(0);
  const ultimoRefresh = useRef(0);
  useEffect(() => {
    function refrescar() {
      const ahora = Date.now();
      if (ahora - ultimoRefresh.current < 3000) return; // throttle: no más de 1 cada 3s
      ultimoRefresh.current = ahora;
      setRefreshKey((k) => k + 1);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") refrescar();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

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
    try {
      sessionStorage.removeItem(CLAVE_FIJO);
      sessionStorage.removeItem(CLAVE_GRUPOS);
    } catch {
      /* sin almacenamiento: no hay nada que limpiar */
    }
    api.clearToken();
    nav("/login");
  }

  function togglePinned() {
    setPinned((v) => {
      const next = !v;
      try {
        sessionStorage.setItem(CLAVE_FIJO, next ? "1" : "0");
      } catch {
        /* localStorage no disponible, no pasa nada */
      }
      return next;
    });
  }

  // Grupo del ítem activo (según la ruta actual) — se muestra siempre expandido aunque el
  // usuario lo haya contraído, para no esconder "dónde estoy parado" dentro del menú.
  const activeItem = NAV_ITEMS.find((i) => (i.end ? location.pathname === i.to : location.pathname.startsWith(i.to)));
  const activeGroupKey = activeItem?.group;

  function toggleGroup(key: string) {
    setGroupsOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        sessionStorage.setItem(CLAVE_GRUPOS, JSON.stringify(next));
      } catch {
        /* localStorage no disponible, no pasa nada */
      }
      return next;
    });
  }

  // El desplegable de la barra de arriba se cierra al navegar y al hacer clic afuera.
  useEffect(() => {
    setDesplegado(null);
  }, [location.pathname]);
  useEffect(() => {
    if (!desplegado) return;
    const fuera = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest(".topnav")) setDesplegado(null);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [desplegado]);

  const rolLabel =
    role === "ADMIN" ? "Panel administrativo" :
    role === "SUPERVISOR" ? "Portal de supervisor" :
    role === "PROVEEDOR" ? "Portal de proveedor" :
    "Portal de agente";

  return (
    <div className={`app-shell ${pos === "top" ? "menu-top" : ""}`}>
      <DockOverlay arrastrando={arrastrando} />
      <header className="topnav">
        <div className="tn-brand" onPointerDown={empezarArrastre} title="Arrastrá hasta el borde izquierdo para mover el menú">
          <div className="brand-mark" aria-hidden="true">P</div>
          <b>Poker Gestión</b>
        </div>
        <nav className="tn-links">
          {role === "ADMIN" ? (
            NAV_GROUPS.map((grupo) => {
              const keys = navOrder.filter((key) => NAV_ITEMS.find((i) => i.key === key)?.group === grupo.key);
              if (keys.length === 0) return null;
              return (
                <div key={grupo.key} className={`tn-g ${activeGroupKey === grupo.key ? "on" : ""} ${desplegado === grupo.key ? "open" : ""}`}>
                  <button type="button" onClick={() => setDesplegado((d) => (d === grupo.key ? null : grupo.key))}>
                    {grupo.label} <span className="tn-chev">▾</span>
                  </button>
                  {desplegado === grupo.key && (
                    <div className="tn-dd">
                      {keys.map((key) => {
                        const item = NAV_ITEMS.find((i) => i.key === key);
                        if (!item) return null;
                        return (
                          <NavLink key={item.key} to={item.to} end={item.end} className="tn-item">
                            {icon[item.icon]} {item.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <NavLink to={role === "SUPERVISOR" ? "/mi-supervision" : role === "PROVEEDOR" ? "/mi-proveedor" : "/mi-cuenta"} className="tn-item tn-solo">
              {icon.cuenta} {role === "SUPERVISOR" ? "Mi supervisión" : role === "PROVEEDOR" ? "Mi proveedor" : "Mi cuenta"}
            </NavLink>
          )}
        </nav>
        <div className="tn-right">
          <span className="tn-rol">{rolLabel}</span>
          <button className="btn secondary sidebar-tema" onClick={toggleTheme} title={theme === "dark" ? "Modo día" : "Modo noche"} aria-label={theme === "dark" ? "Modo día" : "Modo noche"}>
            {theme === "dark" ? icon.sun : icon.moon}
          </button>
          <button className="btn secondary" onClick={logout} title="Cerrar sesión">
            {icon.logout} Cerrar sesión
          </button>
        </div>
      </header>
      <div className="mobile-topbar">
        <button className="mobile-nav-toggle" onClick={() => setMobileOpen(true)} title="Abrir menú" aria-label="Abrir menú">
          {icon.menu}
        </button>
        <div className="brand-text">
          <div className="t1">Poker Gestión</div>
          <div className="t2">{rolLabel}</div>
        </div>
      </div>
      <div className={`sidebar-backdrop ${mobileOpen ? "show" : ""}`} onClick={() => setMobileOpen(false)} />
      <div className={`sidebar ${pinned ? "" : "rail"} ${mobileOpen ? "mobile-open" : ""}`}>
        {/* Marca y botón de colapsar en la MISMA fila (21/10/2026, pedido de Leo: el botón solo en su propia fila dejaba un espacio muerto arriba). */}
        <div className="brand">
          <div className="brand-mark brand-mark-drag" onPointerDown={empezarArrastre} title="Arrastrá hasta el borde de arriba para mover el menú">P</div>
          <div className="brand-info">
            <h1>Poker Gestión</h1>
            <div className="sub">{rolLabel}</div>
          </div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} title="Cerrar menú" aria-label="Cerrar menú">
            {icon.close}
          </button>
          <button
            className="sidebar-toggle"
            onClick={togglePinned}
            title={pinned ? "Volver a compacto (se abre al pasar el mouse)" : "Dejar el menú abierto"}
          >
            {pinned ? icon.collapse : icon.expand}
          </button>
        </div>

        <nav>
          {role === "ADMIN" ? (
            <>
              {NAV_GROUPS.map((grupo) => {
                const keysDelGrupo = navOrder.filter((key) => NAV_ITEMS.find((i) => i.key === key)?.group === grupo.key);
                if (keysDelGrupo.length === 0) return null;
                const contraido = !groupsOpen[grupo.key] && grupo.key !== activeGroupKey;
                return (
                  <div key={grupo.key} className="nav-section">
                    <button
                      type="button"
                      className="nav-section-label"
                      onClick={() => toggleGroup(grupo.key)}
                      title={contraido ? `Mostrar ${grupo.label}` : `Ocultar ${grupo.label}`}
                    >
                      <span className="nav-section-icon">{icon[GROUP_ICON[grupo.key]]}</span>
                      <span className="nav-section-text">{grupo.label}</span>
                      <span className={`nav-section-chevron ${contraido ? "collapsed" : ""}`}>▾</span>
                    </button>
                    {!contraido && keysDelGrupo.map((key) => {
                      const item = NAV_ITEMS.find((i) => i.key === key);
                      if (!item) return null;
                      return (
                        <div
                          key={item.key}
                          className={`nav-drag-item ${dragOverKey === item.key ? "drag-over" : ""}`}
                          draggable
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
                            <span className="nav-drag-handle" title="Arrastrar para reordenar">⠿</span>
                            {icon[item.icon]} {item.label}
                          </NavLink>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <button
                className="nav-link nav-restablecer"
                onClick={restablecerNavOrder}
                style={{ width: "100%", textAlign: "left", background: "transparent", cursor: "pointer", font: "inherit", border: "none", opacity: 0.6, fontSize: 12 }}
                title="Vuelve el menú al orden original"
              >
                Restablecer orden del menú
              </button>
            </>
          ) : role === "SUPERVISOR" ? (
            <NavLink to="/mi-supervision" className="nav-link" title="Mi supervisión">{icon.cuenta} Mi supervisión</NavLink>
          ) : role === "PROVEEDOR" ? (
            <NavLink to="/mi-proveedor" className="nav-link" title="Mi proveedor">{icon.cuenta} Mi proveedor</NavLink>
          ) : (
            <NavLink to="/mi-cuenta" className="nav-link" title="Mi cuenta">{icon.cuenta} Mi cuenta</NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="btn secondary sidebar-tema" onClick={toggleTheme} title={theme === "dark" ? "Modo día" : "Modo noche"} aria-label={theme === "dark" ? "Modo día" : "Modo noche"}>
            {theme === "dark" ? icon.sun : icon.moon}
          </button>
          <button className="btn secondary sidebar-salir" onClick={logout} title="Cerrar sesión">
            {icon.logout} Cerrar sesión
          </button>
        </div>
      </div>
      <div className={`main ${avisosAbierto && !avisosCompleto ? "main-con-avisos" : ""}`}>
        <InstallAppBanner variante={role === "ADMIN" ? "admin" : "portal"} />
        {role !== "ADMIN" && <BandejaAvisos />}
        {role !== "ADMIN" && <PortalNotificacionesBanner />}
        {role === "ADMIN" && (
          <div className="main-topbar">
            <GlobalSearch />
            <button
              type="button"
              className="np-open"
              title="Enviar avisos a supervisores, agentes y proveedores"
              onClick={() => {
                setAvisosMontado(true);
                setAvisosAbierto((v) => !v);
              }}
            >
              {icon.avisos}
              <span>Avisos</span>
            </button>
            <NotificationBell />
          </div>
        )}
        <Outlet key={`${location.pathname}:${refreshKey}`} />
      </div>
      {/* (19/10/2026, pedido de Leo, mockup aprobado) Barra inferior SOLO en celular y SOLO para el
          admin: 4 accesos de uso diario + "Más", que abre el mismo menú lateral de siempre (que
          sigue teniendo los ~18 ítems). Se oculta por CSS arriba de 768px (ver .bottom-nav). */}
      {role === "ADMIN" && (
        <nav className="bottom-nav" aria-label="Accesos rápidos">
          <NavLink to="/dashboard" end className="bottom-nav-item">{icon.resumen}<span>Resumen</span></NavLink>
          <NavLink to="/dashboard/agentes" className="bottom-nav-item">{icon.agentes}<span>Administración</span></NavLink>
          <NavLink to="/dashboard/movimientos" className="bottom-nav-fab" title="Cargar movimiento" aria-label="Cargar movimiento">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </NavLink>
          <NavLink to="/dashboard/cierres" className="bottom-nav-item">{icon.cierres}<span>Cierres</span></NavLink>
          <button type="button" className="bottom-nav-item" onClick={() => setMobileOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            <span>Más</span>
          </button>
        </nav>
      )}
      {role === "ADMIN" && avisosMontado && (
        <aside className={`np ${avisosCompleto ? "full" : "dock"}`} style={{ display: avisosAbierto ? "flex" : "none" }} aria-label="Enviar avisos">
          <div className="np-h">
            <h3>Notificaciones</h3>
            <button type="button" className="np-ic" title={avisosCompleto ? "Volver al panel" : "Pantalla completa"} onClick={() => setAvisosCompleto((v) => !v)}>{avisosCompleto ? "⤡" : "⤢"}</button>
            <button type="button" className="np-ic" title="Cerrar" onClick={() => { setAvisosAbierto(false); setAvisosCompleto(false); }}>✕</button>
          </div>
          <div className="np-body">
            <Notificaciones layout={avisosCompleto ? "completa" : "panel"} />
          </div>
        </aside>
      )}
      <IdleGuard />
    </div>
  );
}
