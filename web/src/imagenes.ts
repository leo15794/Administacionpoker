// Achica una imagen antes de subirla (21/10/2026): Vercel limita el cuerpo de cada pedido a ~4,5 MB y un aviso puede llevar varias.
// Máx. 1600 px de lado y JPG calidad 0,82 (una foto de celular de 6 MB queda en ~300 KB).
export async function comprimirImagen(file: File, maxLado = 1600, calidad = 0.82): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * escala));
  const h = Math.max(1, Math.round(bmp.height * escala));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // los PNG con fondo transparente quedan sobre blanco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob: Blob | null = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", calidad));
  if (!blob) throw new Error("No se pudo procesar la imagen.");
  return blob;
}

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
