import { useEffect, useState } from "react";
import Modal from "./Modal";
import { getInstallPromptEvent, onInstallPromptChange, isStandaloneDisplay, isIos } from "../installPrompt";

// Instalar el panel como app en el celular (21/10/2026, pedido de Leo): mismo comportamiento que el banner de TeamBack
// Affiliates (prompt nativo en Android/Chrome; instrucciones manuales en iPhone), pero con su propio aviso de "cerrar"
// y solo visible en pantallas chicas (ver .install-admin en index.css). No aparece si ya está instalada.
export default function InstallAppBanner() {
  const [promptEvent, setPromptEvent] = useState(() => getInstallPromptEvent());
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("dp_install_dismissed") === "1";
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
      localStorage.setItem("dp_install_dismissed", "1");
    } catch {
      /* sin almacenamiento: solo vuelve a aparecer la próxima vez */
    }
  }

  return (
    <>
      <div className="tb-install-banner install-admin">
        <button className="tb-install-dismiss" onClick={cerrar} aria-label="Cerrar">✕</button>
        <div className="tb-install-icon">P</div>
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
