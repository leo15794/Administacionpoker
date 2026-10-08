// Campana de notificaciones del sistema (06/10/2026, pedido de Leo: "una campana de
// notificaciones del sistema? que podria alertar analiza y decime") -- vive en Shell.tsx, al
// lado del buscador global, visible en cualquier pantalla de admin. Las alertas se recalculan
// en el backend en cada pedido (GET /alertas, ver repo/alertas.ts) -- esto solo las muestra y
// lleva la cuenta de "ya vistas" (guardada en localStorage, por navegador, igual que el tema
// claro/oscuro o el orden del menú) para que el número de la campana solo marque lo NUEVO desde
// la última vez que se abrió, no todo de nuevo cada vez.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { dateShort } from "../fmt";
import Loading from "./Loading";

const INTERVALO_REFRESH_MS = 2 * 60 * 1000; // 2 minutos

const RUTA_POR_TIPO: Record<string, string> = {
  SALDO_PENDIENTE: "/dashboard/resumen-agentes",
  MOVIMIENTO_INUSUAL: "/dashboard/movimientos",
  SIN_DEAL: "/dashboard/agentes",
  REVERSION_TARDIA: "/dashboard/resumen-agentes",
};

function getVistas(): Set<string> {
  try {
    const raw = localStorage.getItem("dp_alertas_vistas");
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function guardarVistas(ids: string[]) {
  try {
    localStorage.setItem("dp_alertas_vistas", JSON.stringify(ids));
  } catch {
    /* localStorage no disponible -- la campana sigue funcionando, solo no recuerda qué ya se vio */
  }
}

export default function NotificationBell() {
  const nav = useNavigate();
  const [alertas, setAlertas] = useState<any[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  function refrescar() {
    api
      .alertas()
      .then((lista: any[]) => {
        setAlertas(lista);
        setCargando(false);
      })
      .catch(() => setCargando(false));
  }

  useEffect(() => {
    refrescar();
    const id = setInterval(refrescar, INTERVALO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const vistas = getVistas();
  const sinVer = alertas.filter((a) => !vistas.has(a.id));

  function toggleAbierto() {
    setAbierto((v) => {
      const next = !v;
      if (next) guardarVistas(alertas.map((a) => a.id)); // al abrir, marca todo lo actual como visto
      return next;
    });
  }

  return (
    <div className="notif-bell" ref={boxRef}>
      <button type="button" className="notif-bell-button" onClick={toggleAbierto} title="Notificaciones del sistema">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {sinVer.length > 0 && <span className="notif-bell-badge">{sinVer.length > 9 ? "9+" : sinVer.length}</span>}
      </button>

      {abierto && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">Notificaciones</div>
          {cargando && <Loading compact style={{ padding: 14 }} />}
          {!cargando && alertas.length === 0 && (
            <div className="muted" style={{ padding: 14 }}>Sin novedades por ahora.</div>
          )}
          {!cargando &&
            alertas.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`notif-item notif-item-${a.severidad}`}
                onClick={() => {
                  setAbierto(false);
                  const ruta = RUTA_POR_TIPO[a.tipo];
                  if (ruta) nav(ruta);
                }}
              >
                <div className="notif-item-mensaje">{a.mensaje}</div>
                <div className="notif-item-fecha muted">{dateShort(a.fecha)}</div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
