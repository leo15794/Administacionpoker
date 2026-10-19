import { useEffect, useRef, useState } from "react";

/**
 * Menú "⋯" para acciones secundarias de una fila de tabla — pensado para reemplazar filas de
 * botones sueltos (Reglas especiales / Historial / Editar / Dar de baja / ...) que se amontonan
 * y envuelven en 2-3 líneas cuando hay muchas acciones. Deja 1-2 botones primarios visibles
 * (los que se usan seguido) y el resto acá adentro.
 *
 * Uso: <ActionsMenu items={[{ label: "Editar", onClick: ... }, { label: "Eliminar", onClick: ...,
 * danger: true }]} />
 */
export interface ActionsMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export default function ActionsMenu({
  items,
  label,
  align = "right",
  title,
}: {
  items: ActionsMenuItem[];
  /** Texto del botón (por defecto "⋯"). */
  label?: React.ReactNode;
  /** De qué lado se abre el menú respecto del botón (por defecto, hacia la izquierda: "right"). */
  align?: "left" | "right";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="actions-menu" ref={ref}>
      <button
        type="button"
        className="btn secondary small actions-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? "Más acciones"}
      >
        {label ?? "⋯"}
      </button>
      {open && (
        <div className="actions-menu-popover" role="menu" style={align === "left" ? { left: 0, right: "auto" } : undefined}>
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`actions-menu-item${item.danger ? " danger" : ""}`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
