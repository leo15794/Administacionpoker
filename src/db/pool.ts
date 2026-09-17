import { Pool, types } from "pg";
import "dotenv/config";

// Por defecto, node-postgres devuelve las columnas DATE (oid 1082, ej. week_start, week_end,
// entry_date) como un objeto Date a medianoche UTC. Eso rompe la UI: el front convierte esa
// fecha a texto con toLocaleDateString() en el huso horario del NAVEGADOR (Argentina, UTC-3),
// y medianoche UTC menos 3 horas cae en el DIA ANTERIOR -> la fecha se muestra corrida un día
// (bug reportado por Leo en "Jugadores bancados" al ejecutar un cierre, 17/09/2026). Un DATE de
// Postgres no tiene hora ni huso horario, así que la única forma correcta de manejarlo es como
// texto plano "YYYY-MM-DD" de punta a punta — nunca como instante. Esto NO afecta a las
// columnas TIMESTAMPTZ (occurred_at, created_at, etc.), que siguen llegando como Date y
// convirtiéndose bien a la hora local.
types.setTypeParser(1082, (val: string) => val);

// Neon (y la mayoría de los Postgres serverless) requieren SSL. En local (Postgres
// propio) no hace falta, así que se activa solo si la URL no apunta a localhost.
const isLocal = (process.env.DATABASE_URL || "").includes("localhost");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  max: isLocal ? 10 : 3, // en serverless conviene un pool chico por invocación
  connectionTimeoutMillis: 8000, // si no puede conectar en 8s, tira error en vez de colgarse
});

pool.on("error", (err) => {
  // Sin esto, un error en una conexión idle del pool puede tirar abajo el proceso
  // sin dejar rastro en los logs.
  console.error("Error inesperado en el pool de Postgres:", err);
});

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
