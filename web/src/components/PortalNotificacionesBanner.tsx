import { useEffect, useState } from "react";
import { api } from "../api";
import { activarNotificaciones, getNotificationPermission, isPushSupported } from "../notifications";
import { isIos, isStandaloneDisplay } from "../installPrompt";

// Activar los avisos en el celular desde el portal de supervisor, proveedor o agente (21/10/2026, pedido de Leo).
// Los avisos los manda el admin a mano; acá cada persona solo autoriza que le lleguen a este dispositivo.
// En iPhone Apple exige que la app esté instalada en la pantalla de inicio: ahí el aviso explica ese paso.
const destino = { subscribe: (sub: any) => api.notificaciones.suscribir(sub), unsubscribe: (e: string) => api.notificaciones.desuscribir(e) };

export default function PortalNotificacionesBanner() {
  const [estado, setEstado] = useState<"cargando" | "ofrecer" | "instalar-primero" | "activo" | "oculto">("cargando");
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!isPushSupported() && !isIos()) return vivo && setEstado("oculto");
      if (getNotificationPermission() === "denied") return vivo && setEstado("oculto");
      if (isIos() && !isStandaloneDisplay()) return vivo && setEstado("instalar-primero");
      if (!isPushSupported()) return vivo && setEstado("oculto");
      try {
        const r: { dispositivos: number } = await api.notificaciones.miEstado();
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (vivo) setEstado(r.dispositivos > 0 && sub ? "activo" : "ofrecer");
      } catch {
        if (vivo) setEstado("oculto");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function activar() {
    setError("");
    setTrabajando(true);
    try {
      const r = await activarNotificaciones(destino);
      if (r === "ok") setEstado("activo");
      else if (r === "denegado") setError("Bloqueaste las notificaciones en este navegador. Activalas desde los permisos del sitio y volvé a probar.");
      else setEstado("oculto");
    } catch (e: any) {
      setError(e?.message || "No se pudieron activar las notificaciones.");
    } finally {
      setTrabajando(false);
    }
  }

  if (estado === "cargando" || estado === "oculto" || estado === "activo") return null;

  return (
    <div className="tb-install-banner" style={{ margin: "0 0 14px" }}>
      <div className="tb-install-icon">🔔</div>
      <div className="tb-install-text">
        <div className="t1">Recibí avisos en tu celular</div>
        <div className="t2">
          {estado === "instalar-primero"
            ? "En iPhone primero instalá la app en tu pantalla de inicio (Compartir → Agregar a inicio) y abrila desde ahí para poder activar los avisos."
            : "Te avisamos cuando tengamos novedades de tus cierres y pagos."}
          {error && <span className="error" style={{ display: "block", marginTop: 4 }}>{error}</span>}
        </div>
      </div>
      {estado === "ofrecer" && (
        <button className="tb-install-btn" onClick={activar} disabled={trabajando}>
          {trabajando ? "Activando..." : "Activar"}
        </button>
      )}
    </div>
  );
}
