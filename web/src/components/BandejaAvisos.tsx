import { useEffect, useState } from "react";
import { api } from "../api";
import { dateTime } from "../fmt";
import AvisoImagenes, { type ImagenAviso } from "./AvisoImagenes";

// Bandeja de avisos recibidos en el portal de supervisor, proveedor o agente (21/10/2026, pedido de Leo): ven lo que les mandó el admin
// (aunque no tengan activadas las notificaciones) y descargan las imágenes. Sin avisos, no se muestra nada.
interface Aviso {
  id: string;
  titulo: string;
  mensaje: string;
  imagenes: ImagenAviso[];
  created_at: string;
  leido_at: string | null;
}

export default function BandejaAvisos() {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [verTodos, setVerTodos] = useState(false);

  useEffect(() => {
    api.notificaciones
      .bandeja()
      .then((r: Aviso[]) => {
        setAvisos(r);
        if (r.some((a) => !a.leido_at)) setAbierta(true);
      })
      .catch(() => setAvisos([]));
  }, []);

  const sinLeer = (avisos ?? []).filter((a) => !a.leido_at);

  function alternar() {
    const nueva = !abierta;
    setAbierta(nueva);
    // al abrirla, lo que había sin leer pasa a leído (se sigue viendo resaltado hasta que recargue)
    if (nueva && sinLeer.length > 0) api.notificaciones.marcarLeidos(sinLeer.map((a) => a.id)).catch(() => {});
  }
  // si arrancó abierta (había sin leer), se marcan como leídos al montar
  useEffect(() => {
    if (abierta && sinLeer.length > 0) api.notificaciones.marcarLeidos(sinLeer.map((a) => a.id)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avisos]);

  if (!avisos || avisos.length === 0) return null;
  const visibles = verTodos ? avisos : avisos.slice(0, 3);
  return (
    <div className="tb-install-banner" style={{ margin: "0 0 14px", display: "block" }}>
      <button type="button" onClick={alternar} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, background: "none", border: 0, color: "inherit", font: "inherit", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <span style={{ fontSize: 18 }}>📬</span>
        <b style={{ flex: 1 }}>Avisos</b>
        {sinLeer.length > 0 && <span className="badge pos">{sinLeer.length} {sinLeer.length === 1 ? "nuevo" : "nuevos"}</span>}
        <span style={{ opacity: 0.6 }}>{abierta ? "▴" : "▾"}</span>
      </button>
      {abierta && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {visibles.map((a) => (
            <div key={a.id} style={{ padding: 12, borderRadius: 12, border: "1px solid var(--border)", background: a.leido_at ? "transparent" : "var(--accent-soft)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <b>{a.titulo}</b>
                <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>{dateTime(a.created_at)}</span>
              </div>
              <div style={{ fontSize: 13.5, margin: "4px 0 8px", whiteSpace: "pre-wrap" }}>{a.mensaje}</div>
              <AvisoImagenes imagenes={a.imagenes} />
            </div>
          ))}
          {avisos.length > 3 && (
            <button type="button" className="btn secondary small" onClick={() => setVerTodos((v) => !v)}>
              {verTodos ? "Ver menos" : `Ver los ${avisos.length} avisos`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
