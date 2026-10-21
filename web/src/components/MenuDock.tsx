import { useEffect, useState } from "react";

// Menú acoplable (21/10/2026, pedido de Leo): a la izquierda (dock) o arriba (barra). Se elige arrastrando la marca a un borde y es una preferencia del
// navegador, no de la sesión. Lo comparten el sistema principal (Shell.tsx) y TeamBack Affiliates: la elección vale para las dos secciones.
export type MenuPos = "left" | "top";
const CLAVE_POS = "dp_menu_pos";
const CLAVE_FIJO = "dp_sidebar_pinned";

export type Arrastre = { zona: MenuPos | null; x: number; y: number } | null;

function posInicial(): MenuPos {
  try {
    return localStorage.getItem(CLAVE_POS) === "top" ? "top" : "left";
  } catch {
    return "left";
  }
}

function zonaDeSoltar(x: number, y: number): MenuPos | null {
  if (y < 110) return "top";
  if (x < 150) return "left";
  return null;
}

/** Lugar del menú + arrastre de la marca hasta un borde (Esc cancela). `onCambio` avisa cuando se acopla en otro lugar. */
export function useMenuPos(onCambio?: () => void) {
  const [pos, setPos] = useState<MenuPos>(posInicial);
  const [arrastrando, setArrastrando] = useState<Arrastre>(null);

  function cambiarPos(nueva: MenuPos) {
    setPos(nueva);
    onCambio?.();
    try {
      localStorage.setItem(CLAVE_POS, nueva);
    } catch {
      /* sin almacenamiento: el cambio vale solo hasta recargar */
    }
  }

  function empezarArrastre(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let activo = false;
    const limpiar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("keydown", tecla);
    };
    function mover(ev: PointerEvent) {
      if (!activo && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
      activo = true;
      setArrastrando({ zona: zonaDeSoltar(ev.clientX, ev.clientY), x: ev.clientX, y: ev.clientY });
    }
    function soltar(ev: PointerEvent) {
      limpiar();
      if (!activo) return;
      setArrastrando(null);
      const zona = zonaDeSoltar(ev.clientX, ev.clientY);
      if (zona && zona !== pos) cambiarPos(zona);
    }
    function tecla(ev: KeyboardEvent) {
      if (ev.key !== "Escape") return;
      activo = false;
      limpiar();
      setArrastrando(null);
    }
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("keydown", tecla);
  }

  // Mientras se arrastra no se selecciona texto de la página.
  useEffect(() => {
    document.body.classList.toggle("dp-dragging-menu", !!arrastrando);
    return () => document.body.classList.remove("dp-dragging-menu");
  }, [!!arrastrando]);

  return { pos, arrastrando, empezarArrastre };
}

/** Menú compacto (solo íconos, se abre con el mouse) o fijo abierto. Solo vale en esta sesión: la próxima vez vuelve a compacto. */
export function useMenuFijo() {
  const [fijo, setFijo] = useState(() => {
    try {
      return sessionStorage.getItem(CLAVE_FIJO) === "1";
    } catch {
      return false;
    }
  });
  function alternarFijo() {
    setFijo((v) => {
      const nuevo = !v;
      try {
        sessionStorage.setItem(CLAVE_FIJO, nuevo ? "1" : "0");
      } catch {
        /* sin almacenamiento */
      }
      return nuevo;
    });
  }
  return { fijo, alternarFijo };
}

/** Zonas resaltadas mientras se arrastra el menú. */
export function DockOverlay({ arrastrando }: { arrastrando: Arrastre }) {
  if (!arrastrando) return null;
  return (
    <div className="dock-overlay">
      <div className={`dock-zona dock-zona-top ${arrastrando.zona === "top" ? "on" : ""}`}>Arriba</div>
      <div className={`dock-zona dock-zona-left ${arrastrando.zona === "left" ? "on" : ""}`}>Izquierda</div>
      <div className="dock-ghost" style={{ left: arrastrando.x + 14, top: arrastrando.y + 14 }}>Soltá en un borde · Esc cancela</div>
    </div>
  );
}
