import { useEffect, useState } from "react";
import { api } from "../api";
import { tamanoLegible } from "../imagenes";

// Imágenes de un aviso (21/10/2026, pedido de Leo): miniaturas con botón Descargar. Se bajan con la sesión (nadie sin acceso las ve).
export interface ImagenAviso {
  id: string;
  nombre: string;
  size: number;
}

function Miniatura({ img, compacto }: { img: ImagenAviso; compacto: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  useEffect(() => {
    let vivo = true;
    let objeto: string | null = null;
    api.notificaciones
      .imagenBlob(img.id)
      .then((b: Blob) => {
        if (!vivo) return;
        objeto = URL.createObjectURL(b);
        setUrl(objeto);
      })
      .catch(() => {});
    return () => {
      vivo = false;
      if (objeto) URL.revokeObjectURL(objeto);
    };
  }, [img.id]);

  async function descargar() {
    setBajando(true);
    try {
      await bajarImagen(img);
    } finally {
      setBajando(false);
    }
  }

  return (
    <div style={{ width: compacto ? 56 : 120 }}>
      <button
        type="button"
        onClick={descargar}
        title={`Descargar ${img.nombre} (${tamanoLegible(img.size)})`}
        style={{ display: "block", width: "100%", aspectRatio: "1", padding: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--panel-2)", cursor: "pointer" }}
      >
        {url ? <img src={url} alt={img.nombre} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : null}
      </button>
      {!compacto && (
        <button type="button" className="btn secondary small" style={{ width: "100%", marginTop: 4 }} onClick={descargar} disabled={bajando}>
          {bajando ? "..." : "Descargar"}
        </button>
      )}
    </div>
  );
}

export async function bajarImagen(img: ImagenAviso) {
  const blob: Blob = await api.notificaciones.imagenBlob(img.id);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = img.nombre || "imagen.jpg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function AvisoImagenes({ imagenes, compacto = false }: { imagenes: ImagenAviso[]; compacto?: boolean }) {
  const [todas, setTodas] = useState(false);
  if (!imagenes || imagenes.length === 0) return null;
  async function bajarTodas() {
    setTodas(true);
    try {
      for (const img of imagenes) {
        await bajarImagen(img);
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setTodas(false);
    }
  }
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {imagenes.map((img) => (
          <Miniatura key={img.id} img={img} compacto={compacto} />
        ))}
      </div>
      {imagenes.length > 1 && !compacto && (
        <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={bajarTodas} disabled={todas}>
          {todas ? "Descargando..." : `Descargar las ${imagenes.length} imágenes`}
        </button>
      )}
    </div>
  );
}

// Imagen que se baja con la sesión (nadie sin acceso la ve): para miniaturas y grillas.
export function ImagenAuth({ id, alt, style }: { id: string; alt: string; style?: React.CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let objeto: string | null = null;
    api.notificaciones
      .imagenBlob(id)
      .then((b: Blob) => {
        if (!vivo) return;
        objeto = URL.createObjectURL(b);
        setUrl(objeto);
      })
      .catch(() => {});
    return () => {
      vivo = false;
      if (objeto) URL.revokeObjectURL(objeto);
    };
  }, [id]);
  return url ? <img src={url} alt={alt} style={style} /> : <span style={{ ...style, display: "inline-block" }} />;
}

// Grilla de 2 columnas con un botón de descarga sobre cada imagen y "Descargar las N imágenes" abajo (pantalla completa de la bandeja).
export function GrillaDescarga({ imagenes }: { imagenes: ImagenAviso[] }) {
  const [todas, setTodas] = useState(false);
  if (!imagenes || imagenes.length === 0) return null;
  async function bajarTodas() {
    setTodas(true);
    try {
      for (const img of imagenes) {
        await bajarImagen(img);
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setTodas(false);
    }
  }
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "12px 0" }}>
        {imagenes.map((img, i) => (
          <button key={img.id} type="button" onClick={() => bajarImagen(img)} title={`Descargar ${img.nombre}`} style={{ position: "relative", aspectRatio: "1", padding: 0, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--panel-2)", cursor: "pointer" }}>
            <ImagenAuth id={img.id} alt={img.nombre} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <span style={{ position: "absolute", right: 6, bottom: 6, background: "rgba(0,0,0,.65)", color: "#fff", borderRadius: 8, padding: "4px 8px", fontSize: 11, fontWeight: 700 }}>⬇ {i + 1}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn" style={{ width: "100%" }} onClick={bajarTodas} disabled={todas}>
        {todas ? "Descargando..." : imagenes.length === 1 ? "Descargar la imagen" : `Descargar las ${imagenes.length} imágenes`}
      </button>
    </div>
  );
}
