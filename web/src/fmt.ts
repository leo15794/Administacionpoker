export function usd(n: number | string) {
  const v = Number(n);
  return v.toLocaleString("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

export function pct(n: number | string) {
  return `${(Number(n) * 100).toFixed(2)}%`;
}

export function dateShort(s: string) {
  // Fecha "pura" (sin hora), ej. week_start/week_end/entry_date: "2026-09-13" o, si llegó
  // serializada como Date por algún lado, "2026-09-13T00:00:00.000Z". Formatearla pasando por
  // `new Date(...).toLocaleDateString()` la corre un día para cualquiera en un huso horario
  // negativo (Argentina, UTC-3), porque ese string se interpreta como medianoche UTC y se
  // convierte de vuelta a la hora local del navegador. Como una fecha así no tiene huso
  // horario real, se arma el texto directo, sin pasar por Date en ningún momento.
  const soloFecha = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z?)?$/.exec(s);
  if (soloFecha) {
    const [, y, m, d] = soloFecha;
    return `${d}/${m}/${y}`;
  }
  // Timestamp real (occurred_at, created_at, etc.) con hora que sí importa: acá la conversión
  // a huso horario local es la correcta.
  return new Date(s).toLocaleDateString("es-AR");
}
