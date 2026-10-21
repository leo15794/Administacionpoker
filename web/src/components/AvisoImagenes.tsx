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
