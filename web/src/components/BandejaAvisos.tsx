import { useEffect, useState } from "react";
import { api } from "../api";
import { dateTime } from "../fmt";
import { GrillaDescarga, ImagenAuth, type ImagenAviso } from "./AvisoImagenes";
import { setBadge } from "../badge";

// Bandeja de avisos recibidos en el portal de supervisor, proveedor o agente (21/10/2026, pedido de Leo). Arriba del portal queda UNA sola fila
// compacta con el último aviso (miniaturas + título + "Ver"); al tocarla se abre a pantalla completa con el aviso, las imágenes (para descargar)
// y los avisos anteriores. Sin avisos, no se muestra nada.
interface Aviso {
  id: string;
  titulo: string;
  mensaje: string;
  imagenes: ImagenAviso[];
  created_at: string;
  leido_at: string | null;
}

function hace(fecha: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 60000));
  if (min < 1) return "Recién";
  if (min < 60) return `Hace ${min} min`;
  if (min < 60 * 24) return `Hace ${Math.round(min / 60)} h`;
  return dateTime(fecha);
}

export default function BandejaAvisos() {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);

  // Al abrir la app y cada vez que se vuelve a ella se refresca la bandeja, y el número del ícono queda igual a los avisos sin leer.
  useEffect(() => {
    function cargar() {
      api.notificaciones
        .bandeja()
        .then((r: Aviso[]) => {
          setAvisos(r);
          setBadge(r.filter((a) => !a.leido_at).length);
        })
        .catch(() => setAvisos([]));
    }
    cargar();
    const alVolver = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, []);

  // bloquear el scroll de la página de atrás mientras la hoja está abierta
  useEffect(() => {
    if (!abierta) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, [abierta]);

  if (!avisos || avisos.length === 0) return null;
  const ultimo = avisos[0];
  const actual = avisos.find((a) => a.id === (seleccionado ?? ultimo.id)) ?? ultimo;
  const sinLeer = avisos.filter((a) => !a.leido_at);
  const hayNuevo = !ultimo.leido_at;

  function abrir(id?: string) {
    setSeleccionado(id ?? null);
    setAbierta(true);
    if (sinLeer.length > 0) {
      api.notificaciones.marcarLeidos(sinLeer.map((a) => a.id)).catch(() => {});
      setBadge(0);
      // se sigue viendo el punto/“nuevo” de esta visita; al volver a entrar ya figuran como leídos
    }
  }

  const imgs = ultimo.imagenes ?? [];
  return (
    <>
      <button
        type="button"
        onClick={() => abrir()}
        className="bandeja-fila"
        style={{ display: "flex", width: "100%", alignItems: "center", gap: 12, padding: "12px 14px", margin: "0 0 14px", border: "1px solid var(--border)", borderRadius: 16, background: "var(--panel)", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
      >
        {imgs.length > 0 ? (
          <span style={{ display: "flex", flexShrink: 0 }}>
            {imgs.slice(0, 2).map((im, i) => (
              <ImagenAuth key={im.id} id={im.id} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", border: "2px solid var(--panel)", marginLeft: i === 0 ? 0 : -12, background: "var(--panel-2)" }} />
            ))}
            {imgs.length > 2 && (
              <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--panel-2)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, marginLeft: -12, border: "2px solid var(--panel)" }}>+{imgs.length - 2}</span>
            )}
          </span>
        ) : (
          <span style={{ fontSize: 26 }}>📬</span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: "block", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {hayNuevo && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#34c759", marginRight: 6 }} />}
            {ultimo.titulo}
          </b>
          <span className="muted" style={{ fontSize: 12, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {hace(ultimo.created_at)}
            {imgs.length > 0 ? ` · ${imgs.length} ${imgs.length === 1 ? "imagen" : "imágenes"}` : ""}
          </span>
        </span>
        <span aria-label="Ver" style={{ background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 16, width: 30, height: 30, display: "grid", placeItems: "center", borderRadius: 999, flexShrink: 0 }}>›</span>
      </button>

      {abierta && (
        <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "var(--bg, var(--panel))", display: "flex", flexDirection: "column" }} role="dialog" aria-label="Avisos">
          <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ margin: 0, flex: 1, fontSize: 17 }}>{actual.titulo}</h3>
            <button type="button" onClick={() => setAbierta(false)} aria-label="Cerrar" style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--panel-2)", color: "inherit", cursor: "pointer", fontSize: 15 }}>✕</button>
          </header>
          <div style={{ flex: 1, overflow: "auto", padding: "14px 16px 30px" }}>
            <div className="muted" style={{ fontSize: 12 }}>{dateTime(actual.created_at)}</div>
            <p style={{ margin: "6px 0 4px", whiteSpace: "pre-wrap" }}>{actual.mensaje}</p>
            <GrillaDescarga imagenes={actual.imagenes ?? []} />
            {avisos.length > 1 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", margin: "22px 0 4px" }}>Avisos anteriores</div>
                {avisos
                  .filter((a) => a.id !== actual.id)
                  .map((a) => (
                    <button key={a.id} type="button" onClick={() => setSeleccionado(a.id)} style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 12px", marginTop: 8, border: "1px solid var(--border)", borderRadius: 12, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>
                      <b style={{ fontSize: 13.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.titulo}</b>
                      <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{(a.imagenes?.length ?? 0) > 0 ? `🖼 ${a.imagenes.length} · ` : ""}{new Date(a.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}</span>
                    </button>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
