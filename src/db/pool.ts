import { Pool } from "pg";
import "dotenv/config";

// Neon (y la mayoría de los Postgres serverless) requieren SSL. En local (Postgres
// propio) no hace falta, así que se activa solo si la URL no apunta a localhost.
const isLocal = (process.env.DATABASE_URL || "").includes("localhost");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  max: isLocal ? 10 : 3, // en serverless conviene un pool chico por invocación
});

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
