import { Link } from "react-router-dom";

// Selector de dónde entrar (21/10/2026, pedido de Leo): las dos secciones tienen usuarios y claves propios, pero comparten la puerta. Se muestra arriba
// del formulario en las dos pantallas de login; cada una conserva su sesión.
export default function LoginSwitch({ actual }: { actual: "poker" | "teamback" }) {
  return (
    <div className="login-switch login-reveal" style={{ animationDelay: ".1s" }} role="tablist" aria-label="Elegí dónde entrar">
      <Link to="/login" role="tab" aria-selected={actual === "poker"} className={actual === "poker" ? "on" : ""}>
        <span className="ls-mark">P</span> Poker Administración
      </Link>
      <Link to="/teamback" role="tab" aria-selected={actual === "teamback"} className={actual === "teamback" ? "on" : ""}>
        <span className="ls-mark ls-tb">T</span> TeamBack Affiliates
      </Link>
    </div>
  );
}
