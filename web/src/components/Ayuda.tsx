import { useEffect, useRef, useState, type ReactNode } from "react";

// Aclaraciones del sistema con ícono (22/10/2026, pedido de Leo): en vez de una línea de texto gris debajo de cada título, un ícono ⓘ al lado del título
// que abre la explicación al pasar el mouse o al tocarlo (en el celular se abre al tocar y se cierra al tocar afuera). Tres piezas:
//   <Ayuda>texto</Ayuda>             ícono ⓘ con la explicación larga
//   <Leyenda pos="..." neg="..." />  etiquetas de color para las convenciones de signo (positivo / negativo)
//   <Aviso tipo="warn|info">...</Aviso>  una línea con ícono, solo para lo importante

export default function Ayuda({ children, titulo }: { children: ReactNode; titulo?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [fijo, setFijo] = useState(false); // abierto con un toque/clic (no se cierra al sacar el mouse)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);

  function abrir() {
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const ancho = Math.min(340, window.innerWidth - 24);
      setPos({ left: Math.max(12, Math.min(r.left - 12, window.innerWidth - ancho - 12)), top: r.bottom + 8 });
    }
    setAbierto(true);
  }
  function cerrar() {
    setAbierto(false);
    setFijo(false);
  }

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: Event) => {
      if (!btn.current?.parentElement?.contains(e.target as Node)) cerrar();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", cerrar, true);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", cerrar, true);
    };
  }, [abierto]);

  return (
    <span className="ayuda" onMouseEnter={abrir} onMouseLeave={() => !fijo && setAbierto(false)}>
      <button
        ref={btn}
        type="button"
        className={`ayuda-i ${abierto ? "on" : ""}`}
        aria-label="Ver aclaración"
        aria-expanded={abierto}
        onClick={(e) => {
          e.stopPropagation();
          if (abierto && fijo) return cerrar();
          abrir();
          setFijo(true);
        }}
      >
        i
      </button>
      {abierto && (
        <span className="ayuda-pop" role="tooltip" style={{ left: pos.left, top: pos.top }}>
          {titulo && <b className="ayuda-tit">{titulo}</b>}
          {children}
        </span>
      )}
    </span>
  );
}

/** Convención de signo en dos etiquetas de color (positivo en verde, negativo en rojo). */
export function Leyenda({ pos, neg, igual }: { pos: string; neg: string; igual?: string }) {
  return (
    <span className="leyenda">
      <span className="leyenda-chip pos">▲ {pos}</span>
      <span className="leyenda-chip neg">▼ {neg}</span>
      {igual && <span className="leyenda-chip">= {igual}</span>}
    </span>
  );
}

/** Una línea con ícono para lo importante: ámbar = advertencia, azul = dato útil. */
export function Aviso({ tipo = "info", children }: { tipo?: "warn" | "info"; children: ReactNode }) {
  return (
    <div className={`aviso-ic ${tipo}`} role={tipo === "warn" ? "alert" : undefined}>
      <span className="aviso-ic-ico" aria-hidden="true">{tipo === "warn" ? "⚠" : "ⓘ"}</span>
      <span>{children}</span>
    </div>
  );
}
