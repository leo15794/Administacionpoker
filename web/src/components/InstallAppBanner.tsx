import { useEffect, useState } from "react";
import Modal from "./Modal";
import { getInstallPromptEvent, onInstallPromptChange, isStandaloneDisplay, isIos } from "../installPrompt";

// Instalar el panel como app en el celular (21/10/2026, pedido de Leo): mismo comportamiento que el banner de TeamBack
// Affiliates (prompt nativo en Android/Chrome; instrucciones manuales en iPhone), pero con su propio aviso de "cerrar"
// y solo visible en pantallas chicas (ver .install-admin en index.css). No aparece si ya está instalada.
// variante "admin": solo celular y se cierra para siempre. variante "portal" (supervisor, proveedor, agente): se ve en cualquier pantalla
// y, si lo cierran, vuelve a aparecer la próxima vez que entren (hasta que instalen la app).
export default function InstallAppBanner({ variante = "admin" }: { variante?: "admin" | "portal" }) {
  const store = variante === "portal" ? sessionStorage : localStorage;
  const clave = variante === "portal" ? "dp_install_dismissed_portal" : "dp_install_dismissed";
  const [promptEvent, setPromptEvent] = useState(() => getInstallPromptEvent());
  const [dismissed, setDismissed] = useState(() => {
    try {
      return store.getItem(clave) === "1";
    } catch {
      return false;
    }
  });
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => onInstallPromptChange(setPromptEvent), []);

  const ios = isIos();
  if (isStandaloneDisplay() || dismissed) return null;
  // Sin el evento del navegador y sin ser iPhone no hay nada que ofrecer (ej. Firefox móvil).
  if (!ios && !promptEvent) return null;

  async function instalar() {
    if (ios) {
      setShowIosHelp(true);
      return;
    }
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
  }

  function cerrar() {
    setDismissed(true);
    try {
      store.setItem(clave, "1");
    } catch {
      /* sin almacenamiento: solo vuelve a aparecer la próxima vez */
    }
  }

  return (
    <>
      <div className={`tb-install-banner ${variante === "admin" ? "install-admin" : ""}`} style={variante === "portal" ? { margin: "0 0 14px" } : undefined}>
        <button className="tb-install-dismiss" onClick={cerrar} aria-label="Cerrar">✕</button>
        <img src="/admin-icon-192.png" alt="" width={40} height={40} style={{ borderRadius: 11, flexShrink: 0 }} />
        <div className="tb-install-text">
          <div className="t1">Instalá Poker Gestión en tu celular</div>
          <div className="t2">Entrás desde un ícono en tu pantalla de inicio, sin abrir el navegador.</div>
        </div>
        <button className="tb-install-btn" onClick={instalar}>Instalar</button>
      </div>
      {showIosHelp && (
        <Modal title="Para instalar en iPhone" onClose={() => setShowIosHelp(false)}>
          <ol style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 14, margin: 0 }}>
            <li>Abrí esta página en <strong>Safari</strong></li>
            <li>Tocá el botón <strong>Compartir</strong> (el ícono con la flecha hacia arriba, en la barra de abajo)</li>
            <li>Elegí <strong>"Agregar a inicio"</strong></li>
            <li>Tocá <strong>"Agregar"</strong> arriba a la derecha</li>
          </ol>
        </Modal>
      )}
    </>
  );
}
