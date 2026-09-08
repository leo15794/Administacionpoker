export function usd(n: number | string) {
  const v = Number(n);
  return v.toLocaleString("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

export function pct(n: number | string) {
  return `${(Number(n) * 100).toFixed(2)}%`;
}

export function dateShort(s: string) {
  return new Date(s).toLocaleDateString("es-AR");
}
