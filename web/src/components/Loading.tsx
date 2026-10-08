import type { CSSProperties } from "react";

// (08/10/2026, pedido de Leo: "cuando queda cargando que aparezca la animacion que hicimos
// ayer") -- NO había ningún bug: la animación de cartas/palos (login-reveal, login-cards, etc.
// en index.css) era SOLO un "reveal" de una sola vez para el login, nunca se armó una versión
// genérica para usar en el resto de la app mientras algo carga -- por eso nunca aparecía
// después de loguearse, siempre se veía el texto plano "Cargando...". Este componente es ese
// reusable: reusa la misma paleta/palos que el login y el mismo pulso (login-dot-pulse, ya
// definido en index.css) pero en loop infinito, pensado para reemplazar cualquier
// `<div className="muted">Cargando...</div>` del resto del sistema.
export default function Loading({
  label = "Cargando...",
  compact = false,
  style,
}: {
  label?: string;
  compact?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={`app-loading${compact ? " app-loading--compact" : ""}`} style={style}>
      <div className="app-loading-suits">
        <span>♠</span>
        <span>♦</span>
        <span>♥</span>
        <span>♣</span>
      </div>
      {label && <div className="app-loading-text">{label}</div>}
    </div>
  );
}
