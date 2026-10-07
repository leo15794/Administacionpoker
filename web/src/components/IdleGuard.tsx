import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

// (07/10/2026, pedido de Leo: "tenemos que ver de ponerle tiempo de sesion, asi no queda
// abierto eterno") -- cierra la sesión sola después de 30 minutos SIN NINGUNA actividad
// (mouse, teclado, click, scroll). Cualquier actividad reinicia el reloj; si hay actividad
// no se cierra nunca, sin importar cuánto tiempo lleve la pestaña abierta.
//
// El "reloj" vive en localStorage (dp_last_activity, lo pisa api.setToken/clearToken
// también) en vez de en un estado de React, a propósito: así, si el agente tiene varias
// pestañas del sistema abiertas, actividad en CUALQUIERA de ellas cuenta para todas -- no
// tiene sentido cerrar la sesión de una pestaña que está quieta si la persona está
// activamente trabajando en otra.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos sin actividad
const WARNING_LEAD_MS = 60 * 1000; // avisa con 60s de anticipación
const WRITE_THROTTLE_MS = 5000; // no escribe en localStorage en cada mousemove
const STORAGE_KEY = "dp_last_activity";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"] as const;

function leerUltimaActividad(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : Date.now();
}

export default function IdleGuard() {
  const nav = useNavigate();
  const [segundosRestantes, setSegundosRestantes] = useState<number | null>(null);
  const ultimaEscrituraRef = useRef(0);

  useEffect(() => {
    // Si todavía no hay nada guardado (ej. recién logueado y por alguna razón setToken no
    // llegó a escribirlo), arranca el reloj ahora en vez de asumir que ya pasó el timeout.
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    }

    function registrarActividad() {
      const ahora = Date.now();
      if (ahora - ultimaEscrituraRef.current < WRITE_THROTTLE_MS) return;
      ultimaEscrituraRef.current = ahora;
      localStorage.setItem(STORAGE_KEY, String(ahora));
    }

    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, registrarActividad, { passive: true }));

    const interval = setInterval(() => {
      // Si en el medio se cerró la sesión (logout manual en esta u otra pestaña), no hay
      // nada que vigilar.
      if (!api.getToken()) {
        setSegundosRestantes(null);
        return;
      }

      const restante = IDLE_TIMEOUT_MS - (Date.now() - leerUltimaActividad());

      if (restante <= 0) {
        api.clearToken();
        nav("/login", { replace: true });
        return;
      }
      setSegundosRestantes(restante <= WARNING_LEAD_MS ? Math.ceil(restante / 1000) : null);
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, registrarActividad));
      clearInterval(interval);
    };
  }, [nav]);

  if (segundosRestantes === null) return null;

  return (
    <div className="modal-backdrop confirm-backdrop">
      <div className="modal-box confirm-box">
        <div className="modal-body">
          <h3 style={{ marginTop: 0 }}>¿Seguís ahí?</h3>
          <p style={{ margin: 0 }}>
            Por seguridad, tu sesión se va a cerrar en <strong>{segundosRestantes}s</strong> por inactividad.
          </p>
          <div className="confirm-actions">
            <button
              className="btn"
              autoFocus
              onClick={() => {
                localStorage.setItem(STORAGE_KEY, String(Date.now()));
                setSegundosRestantes(null);
              }}
            >
              Seguir conectado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
