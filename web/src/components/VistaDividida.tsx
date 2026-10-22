import { useCallback, useEffect, useRef, useState } from "react";

// Vista dividida (22/10/2026, pedido de Leo): dos secciones del panel lado a lado (por ejemplo Administración + Wallet) en la misma pantalla.
// Cada panel es la propia aplicación cargada en un iframe sin menú (ver html.embebido en index.css y main.tsx): así cada sección usa su ancho real,
// aplica sus estilos de pantalla angosta y no se pisan los datos. La elección (qué secciones y qué proporción) queda en este navegador.
export interface Seccion {
  to: string;
  label: string;
}
export interface EstadoDividido {
  activa: boolean;
  izq: string; // ruta cargada en el panel izquierdo (ej. "/dashboard/agentes")
  der: string;
  ratio: number; // % del ancho para el panel izquierdo (30–70)
  v?: number; // sube al intercambiar los paneles, para recargarlos
}

const CLAVE = "dp_vista_dividida";
const POR_DEFECTO: EstadoDividido = { activa: false, izq: "/dashboard", der: "/dashboard/wallet", ratio: 60 };
export const ANCHO_MINIMO_DIVIDIDA = 1100;

function leer(): EstadoDividido {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
    if (x && typeof x.izq === "string" && typeof x.der === "string") return { ...POR_DEFECTO, ...x, ratio: Math.min(70, Math.max(30, Number(x.ratio) || 60)) };
  } catch {
    /* sin almacenamiento: arranca con los valores por defecto */
  }
  return POR_DEFECTO;
}

export function useVistaDividida() {
  const [estado, setEstado] = useState<EstadoDividido>(leer);
  const [ancho, setAncho] = useState(() => window.innerWidth);
  const [foco, setFoco] = useState<"izq" | "der">("izq");

  useEffect(() => {
    const f = () => setAncho(window.innerWidth);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  const guardar = useCallback((cambio: Partial<EstadoDividido>) => {
    setEstado((prev) => {
      const nuevo = { ...prev, ...cambio };
      try {
        localStorage.setItem(CLAVE, JSON.stringify(nuevo));
      } catch {
        /* sin almacenamiento */
      }
      return nuevo;
    });
  }, []);

  // Un panel (la app dentro de un iframe) nunca se divide a sí mismo: la elección se guarda en el navegador y sin esto cada panel mostraría otra vista dividida adentro.
  const embebido = window.self !== window.top;
  const posible = !embebido && ancho >= ANCHO_MINIMO_DIVIDIDA;
  return { estado, guardar, foco, setFoco, posible, visible: estado.activa && posible };
}

function Panel({ lado, ruta, secciones, esFoco, onFoco, onRuta, onAbrirCompleta, onCerrar }: {
  lado: "izq" | "der";
  ruta: string;
  secciones: Seccion[];
  esFoco: boolean;
  onFoco: () => void;
  onRuta: (r: string) => void;
  onAbrirCompleta: (r: string) => void;
  onCerrar: () => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [src] = useState(ruta); // lo que se cargó al abrir; los cambios por el selector recargan el panel
  const [actual, setActual] = useState(ruta);
  const [recarga, setRecarga] = useState(0);
  const [cargado, setCargado] = useState(false); // el panel terminó de cargar (antes su ruta es la de la página en blanco)

  // La sección puede cambiar adentro del panel (el usuario navega): se lee la ruta real para mostrarla en el selector.
  useEffect(() => {
    if (!cargado) return;
    const t = setInterval(() => {
      try {
        const p = ref.current?.contentWindow?.location.pathname;
        if (p && p !== actual && p.startsWith("/dashboard")) {
          setActual(p);
          onRuta(p);
        }
      } catch {
        /* otro origen: no pasa, pero por las dudas */
      }
    }, 800);
    return () => clearInterval(t);
  }, [actual, onRuta, cargado]);

  useEffect(() => {
    if (cargado && ruta !== actual) cambiar(ruta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta, cargado]);

  const sel = secciones.find((s) => s.to === actual) ?? secciones.find((s) => actual.startsWith(s.to) && s.to !== "/dashboard");
  function cambiar(r: string) {
    setActual(r);
    onRuta(r);
    try {
      ref.current?.contentWindow?.history.pushState({}, "", r);
      ref.current?.contentWindow?.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      setRecarga((n) => n + 1);
    }
  }

  return (
    <div className={`vd-panel ${esFoco ? "foco" : ""}`} onPointerDown={onFoco}>
      <div className="vd-cab">
        <select value={sel?.to ?? ""} onChange={(e) => cambiar(e.target.value)} aria-label={`Sección del panel ${lado === "izq" ? "izquierdo" : "derecho"}`}>
          {!sel && <option value="">{actual}</option>}
          {secciones.map((s) => (
            <option key={s.to} value={s.to}>{s.label}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" className="vd-ic" title="Abrir en pantalla completa" onClick={() => onAbrirCompleta(actual)}>⤢</button>
        <button type="button" className="vd-ic" title="Cerrar este panel" onClick={onCerrar}>✕</button>
      </div>
      <iframe key={recarga} ref={ref} src={src} data-lado={lado} onLoad={() => setCargado(true)} title={sel?.label ?? actual} />
    </div>
  );
}

/** Los dos paneles con el divisor arrastrable. */
export default function VistaDividida({ estado, secciones, foco, onFoco, onCambio, onSalir, onAbrirCompleta }: {
  estado: EstadoDividido;
  secciones: Seccion[];
  foco: "izq" | "der";
  onFoco: (l: "izq" | "der") => void;
  onCambio: (c: Partial<EstadoDividido>) => void;
  onSalir: () => void;
  onAbrirCompleta: (ruta: string) => void;
}) {
  const cont = useRef<HTMLDivElement>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [completa, setCompleta] = useState(false); // pantalla completa: sin menú ni barras, los dos paneles ocupan todo el monitor
  const [alto, setAlto] = useState<number | undefined>();

  // Pantalla completa (22/10/2026, pedido de Leo): oculta menú y barras (clase en body, ver index.css) y pide al navegador la pantalla completa real (como F11).
  // Si el navegador no la permite, igual queda el modo sin menú; se sale con el botón o con Esc.
  async function alternarCompleta() {
    if (!completa) {
      setCompleta(true);
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        /* sin pantalla completa del navegador: queda solo el modo sin menú */
      }
    } else {
      setCompleta(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    }
  }
  useEffect(() => {
    document.body.classList.toggle("vd-completa", completa);
    const alCambiar = () => {
      if (!document.fullscreenElement) setCompleta(false); // Esc del navegador
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) setCompleta(false);
    };
    document.addEventListener("fullscreenchange", alCambiar);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("fullscreenchange", alCambiar);
      document.removeEventListener("keydown", tecla);
    };
  }, [completa]);
  useEffect(
    () => () => {
      document.body.classList.remove("vd-completa");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    },
    []
  );

  // Los paneles se estiran hasta el borde de abajo de la pantalla, sea cual sea el monitor.
  useEffect(() => {
    const medir = () => {
      const arriba = cont.current?.getBoundingClientRect().top ?? 0;
      setAlto(Math.max(420, Math.round(window.innerHeight - arriba - 12)));
    };
    medir();
    const t = setTimeout(medir, 80);
    window.addEventListener("resize", medir);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", medir);
    };
  }, [completa]);

  useEffect(() => {
    const alPerderFoco = () => {
      setTimeout(() => {
        const a = document.activeElement;
        if (a instanceof HTMLIFrameElement && (a.dataset.lado === "izq" || a.dataset.lado === "der")) onFoco(a.dataset.lado);
      }, 0);
    };
    window.addEventListener("blur", alPerderFoco);
    return () => window.removeEventListener("blur", alPerderFoco);
  }, [onFoco]);

  function empezar(e: React.PointerEvent) {
    e.preventDefault();
    setArrastrando(true);
    const mover = (ev: PointerEvent) => {
      const r = cont.current?.getBoundingClientRect();
      if (!r) return;
      onCambio({ ratio: Math.round(Math.min(70, Math.max(30, ((ev.clientX - r.left) / r.width) * 100))) });
    };
    const soltar = () => {
      setArrastrando(false);
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  return (
    <div>
      <div className="vd-barra">
        <b>Vista dividida</b>
        <span className="vd-sep" />
        <span className="muted" style={{ fontSize: 12 }}>Proporción</span>
        {[40, 50, 60, 70].map((p) => (
          <button key={p} type="button" className={`vd-pill ${estado.ratio === p ? "on" : ""}`} onClick={() => onCambio({ ratio: p })}>{p}/{100 - p}</button>
        ))}
        <button type="button" className="vd-pill" title="Intercambiar los paneles" onClick={() => onCambio({ izq: estado.der, der: estado.izq, v: (estado.v ?? 0) + 1 })}>⇄ Intercambiar</button>
        <span style={{ flex: 1 }} />
        <button type="button" className={`vd-pill ${completa ? "on" : ""}`} onClick={alternarCompleta} title="Usar todo el monitor: oculta el menú y las barras (Esc para salir)">{completa ? "⤡ Salir de pantalla completa" : "⛶ Pantalla completa"}</button>
        <button type="button" className="vd-pill" onClick={onSalir}>✕ Salir de la vista dividida</button>
      </div>
      <div className="vd-cont" ref={cont} style={alto ? { height: alto } : undefined}>
        <div style={{ flex: `${estado.ratio} 1 0`, minWidth: 0 }}>
          <Panel key={`izq-${estado.v ?? 0}`} lado="izq" ruta={estado.izq} secciones={secciones} esFoco={foco === "izq"} onFoco={() => onFoco("izq")} onRuta={(r) => onCambio({ izq: r })} onAbrirCompleta={onAbrirCompleta} onCerrar={() => (onAbrirCompleta(estado.der), onSalir())} />
        </div>
        <div className="vd-div" onPointerDown={empezar} title="Arrastrá para cambiar el ancho"><i /></div>
        <div style={{ flex: `${100 - estado.ratio} 1 0`, minWidth: 0 }}>
          <Panel key={`der-${estado.v ?? 0}`} lado="der" ruta={estado.der} secciones={secciones} esFoco={foco === "der"} onFoco={() => onFoco("der")} onRuta={(r) => onCambio({ der: r })} onAbrirCompleta={onAbrirCompleta} onCerrar={() => (onAbrirCompleta(estado.izq), onSalir())} />
        </div>
        {arrastrando && <div className="vd-capa" />}
      </div>
    </div>
  );
}
