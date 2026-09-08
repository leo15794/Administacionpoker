// Seed con datos REALES tomados (solo lectura) de la planilla maestra "DIGIPLAYERS MANAGER"
// y de la carpeta de cuentas externas en Google Drive. No se modificó ni se escribió nada
// en las hojas de cálculo originales — esto es una copia normalizada para poblar el sistema nuevo.
//
// Fuentes:
//  - SALDOS_POR_AGENTE_Y_CLUB (estado más reciente, ~04/09/2026): saldos vigentes por agente/club.
//  - LIQUIDACION_AGENTES_PREVIA (semana 10/08/2026 al 16/08/2026): cierre histórico por agente.
//  - Cuentas automatizadas individuales (Manzur, daylight25, etc.): % rakeback/rebate y reglas especiales.
//  - Bitácora de migración a app: reglas especiales (Manzur 75% rake, Cajero UY a crédito).
//
// Los % de rakeback/rebate que no estaban explícitos por agente puntual se completaron con el
// valor típico documentado para ese club (marcado en las notas de cada deal como "default club").
// Hay que refinarlos con el config real (CONFIG_CUENTAS_AGENTES) cuando esté disponible.

import bcrypt from "bcryptjs";
import { pool, newId } from "./db/pool.js";
import { upsertClub, upsertAgent, getAgentByName, getClubByName, addDeal, addRuleVersion, setGuarantee } from "./repo/catalog.js";
import { aplicarCierreSemanal } from "./repo/closings.js";

type Sistema = "PREPAGO" | "WIN_LOSE";

const CLUBS: { name: string; unit?: string; rate?: number }[] = [
  { name: "Fénix Suprema" },
  { name: "Fénix GG" },
  { name: "GG" },
  { name: "TeamBack Suprema" },
  { name: "Tiny", unit: "FICHAS", rate: 31.78 },
  { name: "X-Poker", unit: "FICHAS", rate: 1.2 },
  { name: "OTRO" }, // cuentas/ajustes consolidados que la planilla no ata a un club puntual
];

// [agente, sistema por defecto, clubes donde opera]
const AGENTS: { name: string; system: Sistema; clubs: string[]; supervisor?: string }[] = [
  { name: "CAARLITOS", system: "WIN_LOSE", clubs: ["Fénix GG"] },
  { name: "cajerouy", system: "PREPAGO", clubs: ["Fénix Suprema"] },
  { name: "daylight25", system: "PREPAGO", clubs: ["GG"] },
  { name: "Dejodita", system: "PREPAGO", clubs: ["GG", "Fénix GG", "Tiny"], supervisor: "Uriel" },
  { name: "Demiurge29", system: "PREPAGO", clubs: ["Fénix GG"] },
  { name: "Edwar", system: "PREPAGO", clubs: ["Fénix Suprema", "OTRO"] },
  { name: "El caiman", system: "WIN_LOSE", clubs: ["GG", "OTRO"] },
  { name: "El Latigo Loco", system: "WIN_LOSE", clubs: ["GG"] },
  { name: "eze.f23", system: "WIN_LOSE", clubs: ["TeamBack Suprema"] },
  { name: "F aducci", system: "WIN_LOSE", clubs: ["TeamBack Suprema"] },
  { name: "F Roesca17", system: "WIN_LOSE", clubs: ["Fénix Suprema"] },
  { name: "Gonza", system: "PREPAGO", clubs: ["Fénix GG"] },
  { name: "J Lenzo", system: "PREPAGO", clubs: ["TeamBack Suprema"] },
  { name: "JereStack", system: "PREPAGO", clubs: ["Fénix GG"] },
  { name: "JJ DD", system: "WIN_LOSE", clubs: ["TeamBack Suprema"] },
  { name: "Juan", system: "WIN_LOSE", clubs: ["TeamBack Suprema"] },
  { name: "Manzur", system: "WIN_LOSE", clubs: ["Fénix Suprema", "Fénix GG"] },
  { name: "Mar Mari", system: "WIN_LOSE", clubs: ["Fénix Suprema", "OTRO"] },
  { name: "Marcelo Mereles", system: "PREPAGO", clubs: ["TeamBack Suprema", "GG", "Fénix GG"] },
  { name: "MrBadBeats", system: "WIN_LOSE", clubs: ["TeamBack Suprema"] },
  { name: "nico", system: "WIN_LOSE", clubs: ["TeamBack Suprema"] },
  { name: "patoruzit0", system: "WIN_LOSE", clubs: ["TeamBack Suprema"] },
  { name: "Prodigio", system: "PREPAGO", clubs: ["TeamBack Suprema", "GG", "Tiny", "Fénix GG", "OTRO"] },
  { name: "QueDificil", system: "PREPAGO", clubs: ["GG"] },
  { name: "Rodrigo", system: "PREPAGO", clubs: ["Fénix Suprema", "Fénix GG", "OTRO"] },
  { name: "TB dementus22", system: "PREPAGO", clubs: ["TeamBack Suprema"] },
  { name: "TB OTTI", system: "PREPAGO", clubs: ["Fénix Suprema"] },
  { name: "Unión TeamBack GG", system: "WIN_LOSE", clubs: ["GG"] },
  { name: "MutiladorDoc", system: "PREPAGO", clubs: ["Tiny"] },
  { name: "LTinside", system: "PREPAGO", clubs: ["TeamBack Suprema"] },
];

// % rakeback / rebate "default" por club, tal como se documentan de forma agregada en la
// planilla (GG 70%+10%, Tiny 60%+10%, Fénix GG variable 55-72.5% según agente).
const DEFAULT_PCT_BY_CLUB: Record<string, { rakeback: number; rebate: number }> = {
  "Fénix Suprema": { rakeback: 0.7, rebate: 0 },
  "Fénix GG": { rakeback: 0.65, rebate: 0.1 },
  GG: { rakeback: 0.7, rebate: 0.1 },
  "TeamBack Suprema": { rakeback: 0.7, rebate: 0 },
  Tiny: { rakeback: 0.6, rebate: 0.1 },
  "X-Poker": { rakeback: 0.5, rebate: 0 },
  OTRO: { rakeback: 0.7, rebate: 0 },
};

// Excepciones puntuales relevadas directamente de una cuenta automatizada real.
const PCT_OVERRIDES: Record<string, Partial<Record<string, { rakeback: number; rebate: number }>>> = {
  daylight25: { GG: { rakeback: 0.55, rebate: 0.1 } }, // relevado del extracto real de su cuenta
  "El Latigo Loco": { GG: { rakeback: 0.725, rebate: 0.1 } },
  Dejodita: { "Fénix GG": { rakeback: 0.65, rebate: 0 }, Tiny: { rakeback: 0.6, rebate: 0.1 } },
};

// SALDOS_POR_AGENTE_Y_CLUB — estado real más reciente (positivo = a favor del agente).
const BALANCES: { agent: string; club: string; amount: number }[] = [
  { agent: "CAARLITOS", club: "Fénix GG", amount: -2105.5 },
  { agent: "cajerouy", club: "Fénix Suprema", amount: 1264.52 },
  { agent: "daylight25", club: "GG", amount: 2045.33 },
  { agent: "Demiurge29", club: "Fénix GG", amount: 19647.92 },
  { agent: "Edwar", club: "OTRO", amount: 5575.55 },
  { agent: "El caiman", club: "GG", amount: 0 },
  { agent: "El caiman", club: "OTRO", amount: -523.57 },
  { agent: "El Latigo Loco", club: "GG", amount: 236.9 },
  { agent: "F Roesca17", club: "Fénix Suprema", amount: 0.04 },
  { agent: "J Lenzo", club: "TeamBack Suprema", amount: 38.66 },
  { agent: "JJ DD", club: "TeamBack Suprema", amount: -688.87 },
  { agent: "LTinside", club: "TeamBack Suprema", amount: 0 },
  { agent: "Manzur", club: "OTRO", amount: -14129.1 },
  { agent: "Mar Mari", club: "OTRO", amount: -767.81 },
  { agent: "Marcelo Mereles", club: "Fénix GG", amount: 14076.92 },
  { agent: "MrBadBeats", club: "TeamBack Suprema", amount: -373.01 },
  { agent: "nico", club: "TeamBack Suprema", amount: -670.74 },
  { agent: "Prodigio", club: "Fénix GG", amount: 0 },
  { agent: "Prodigio", club: "GG", amount: 471.42 },
  { agent: "Prodigio", club: "OTRO", amount: 0 },
  { agent: "Prodigio", club: "TeamBack Suprema", amount: 7541.49 },
  { agent: "Prodigio", club: "Tiny", amount: 58.66 },
  { agent: "Rodrigo", club: "Fénix GG", amount: -2670.0 },
  { agent: "Rodrigo", club: "Fénix Suprema", amount: 6000.0 },
  { agent: "Rodrigo", club: "OTRO", amount: 0 },
  { agent: "Unión TeamBack GG", club: "GG", amount: -6689.39 },
  { agent: "Marcelo Mereles", club: "GG", amount: 497.99 },
  { agent: "TB dementus22", club: "TeamBack Suprema", amount: 174.561 },
  { agent: "Dejodita", club: "Fénix GG", amount: 131.0664303 },
  { agent: "Dejodita", club: "Tiny", amount: 0 },
  { agent: "MutiladorDoc", club: "Tiny", amount: 2585.727747 },
];

// LIQUIDACION_AGENTES_PREVIA — cierre real de la semana 10/08/2026 al 16/08/2026.
// "Cierre semanal" tal como lo dejó la planilla (no tenemos, en este extracto, el desglose
// resultado/rake por separado para todos los agentes, así que se importa el número final real
// sin inventar un desglose que no está documentado).
const WEEK_START = "2026-08-10";
const WEEK_END = "2026-08-16";
const CLOSINGS_10_16_AGO: { agent: string; club: string; cierre: number; sistema: Sistema; obs: string }[] = [
  { agent: "CAARLITOS", club: "Fénix GG", cierre: 0, sistema: "WIN_LOSE", obs: "Sin cierre nuevo esta semana; saldo arrastrado." },
  { agent: "cajerouy", club: "Fénix Suprema", cierre: -1674.82, sistema: "PREPAGO", obs: "" },
  { agent: "daylight25", club: "GG", cierre: -148.17, sistema: "PREPAGO", obs: "" },
  { agent: "Dejodita", club: "GG", cierre: -631.03, sistema: "PREPAGO", obs: "Clubes: GG, Fénix GG, Tiny (cierre consolidado)." },
  { agent: "Demiurge29", club: "Fénix GG", cierre: 8738.56, sistema: "PREPAGO", obs: "" },
  { agent: "Edwar", club: "Fénix Suprema", cierre: 170.92, sistema: "PREPAGO", obs: "" },
  { agent: "El caiman", club: "GG", cierre: -1757.86, sistema: "WIN_LOSE", obs: "Garantía consumida primero; deuda operativa restante 1.465,47." },
  { agent: "El Latigo Loco", club: "GG", cierre: -1197.87, sistema: "WIN_LOSE", obs: "" },
  { agent: "eze.f23", club: "TeamBack Suprema", cierre: 985.64, sistema: "WIN_LOSE", obs: "" },
  { agent: "F aducci", club: "TeamBack Suprema", cierre: -320.0, sistema: "WIN_LOSE", obs: "" },
  { agent: "F Roesca17", club: "Fénix Suprema", cierre: 0.04, sistema: "WIN_LOSE", obs: "" },
  { agent: "J Lenzo", club: "TeamBack Suprema", cierre: -65.63, sistema: "PREPAGO", obs: "" },
  { agent: "JereStack", club: "Fénix GG", cierre: 314.05, sistema: "PREPAGO", obs: "" },
  { agent: "JJ DD", club: "TeamBack Suprema", cierre: -12.57, sistema: "WIN_LOSE", obs: "" },
  { agent: "Manzur", club: "Fénix GG", cierre: -4744.83, sistema: "WIN_LOSE", obs: "Saldo operativo y garantía tomados de SALDOS_AGENTES; garantía separada." },
  { agent: "Mar Mari", club: "Fénix Suprema", cierre: -105.63, sistema: "WIN_LOSE", obs: "" },
  { agent: "Marcelo Mereles", club: "TeamBack Suprema", cierre: -5361.67, sistema: "PREPAGO", obs: "Clubes: TeamBack Suprema, GG, Fénix GG (cierre consolidado)." },
  { agent: "MrBadBeats", club: "TeamBack Suprema", cierre: 0, sistema: "WIN_LOSE", obs: "Sin cierre nuevo esta semana; saldo arrastrado." },
  { agent: "nico", club: "TeamBack Suprema", cierre: 98.29, sistema: "WIN_LOSE", obs: "" },
  { agent: "patoruzit0", club: "TeamBack Suprema", cierre: 1464.13, sistema: "WIN_LOSE", obs: "" },
  { agent: "Prodigio", club: "TeamBack Suprema", cierre: 2922.86, sistema: "PREPAGO", obs: "Auditado; clubes: TeamBack Suprema, GG, Tiny." },
  { agent: "QueDificil", club: "GG", cierre: 1478.28, sistema: "PREPAGO", obs: "" },
  { agent: "Rodrigo", club: "Fénix Suprema", cierre: -422.67, sistema: "PREPAGO", obs: "Informativo: saldo real tomado de SALDOS_AGENTES." },
  { agent: "TB dementus22", club: "TeamBack Suprema", cierre: -23.45, sistema: "PREPAGO", obs: "" },
  { agent: "TB OTTI", club: "Fénix Suprema", cierre: 0, sistema: "PREPAGO", obs: "Sin cierre nuevo esta semana; saldo arrastrado." },
];

async function main() {
  console.log("Sembrando catálogo de clubes...");
  const clubIds: Record<string, string> = {};
  for (const c of CLUBS) {
    const row = await upsertClub(c.name, c.unit ?? "USD", c.rate ?? 1);
    clubIds[c.name] = row.id;
  }

  console.log("Sembrando catálogo de agentes...");
  const agentIds: Record<string, string> = {};
  for (const a of AGENTS) {
    const row = await upsertAgent(a.name, a.system, a.supervisor ?? null);
    agentIds[a.name] = row.id;
  }

  console.log("Sembrando deals agente↔club (% rakeback / rebate)...");
  for (const a of AGENTS) {
    for (const clubName of a.clubs) {
      const overridePct = PCT_OVERRIDES[a.name]?.[clubName];
      const pct = overridePct ?? DEFAULT_PCT_BY_CLUB[clubName] ?? { rakeback: 0.6, rebate: 0 };
      const nota = overridePct ? "Relevado de la cuenta automatizada real del agente." : `Default documentado para el club ${clubName} (a refinar con config real por agente).`;
      await addDeal(agentIds[a.name], clubIds[clubName], a.system, pct.rakeback, pct.rebate, nota);
    }
  }

  console.log("Reglas especiales (bitácora de migración)...");
  await addRuleVersion(
    agentIds["Manzur"],
    "MANZUR_75_RAKE",
    { pctRake: 0.75 },
    "Regla crítica (BIT-068): Manzur en Fénix GG se liquida SIEMPRE como Resultado + 75% del rake total del proveedor, nunca por la columna genérica de comisiones/rakeback de agentes.",
    clubIds["Fénix GG"]
  );
  await addRuleVersion(
    agentIds["cajerouy"],
    "CAJERO_CREDITO",
    {},
    "Regla (BIT-035): Cajero UY opera con deuda por cargas a crédito. Las cargas aumentan deuda; rakeback y cobros USDT la reducen; un cobro solo genera saldo a favor si excede la deuda pendiente.",
    clubIds["Fénix Suprema"]
  );

  console.log("Garantía real de Manzur (documentada en su cuenta automatizada)...");
  await setGuarantee(agentIds["Manzur"], 4847.46, 0, "Garantía vigente al 24/08/2026 al 30/08/2026, separada del saldo operativo (regla BIT-034).");

  console.log("Cargando saldos reales por agente y club (SALDOS_POR_AGENTE_Y_CLUB)...");
  for (const b of BALANCES) {
    const agentId = agentIds[b.agent];
    const clubId = clubIds[b.club];
    if (!agentId || !clubId) {
      console.warn(`  ⚠ omitido (agente/club no catalogado): ${b.agent} / ${b.club}`);
      continue;
    }
    await pool.query(
      `INSERT INTO balances (id, agent_id, club_id, amount, updated_at)
       VALUES ('bal_' || substr(md5(random()::text),1,10), $1,$2,$3, now())
       ON CONFLICT (agent_id, club_id) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()`,
      [agentId, clubId, b.amount]
    );
  }

  console.log(`Aplicando cierre semanal real ${WEEK_START} al ${WEEK_END}...`);
  for (const c of CLOSINGS_10_16_AGO) {
    const agentId = agentIds[c.agent];
    const clubId = clubIds[c.club];
    if (!agentId || !clubId) continue;
    await pool.query(
      `INSERT INTO weekly_closings
        (id, agent_id, club_id, week_start, week_end, system, result, rake_total,
         rakeback_pct, rakeback, rebate_pct, rebate, adjusted_result, final_closing,
         rate_snapshot, status, observation)
       VALUES ('wc_' || substr(md5(random()::text),1,10), $1,$2,$3,$4,$5,$6,0,0,0,0,0,$6,$6,1,'APLICADO',$7)
       ON CONFLICT (agent_id, club_id, week_start) DO NOTHING`,
      [agentId, clubId, WEEK_START, WEEK_END, c.sistema, c.cierre, `Importado desde el cierre real de la planilla. ${c.obs}`.trim()]
    );
  }

  console.log("Creando usuarios de acceso (login sin contraseña real por ahora)...");
  const adminAgent = await upsertAgent("Administración", "WIN_LOSE", null);
  const placeholderHash = await bcrypt.hash("placeholder-no-se-verifica", 10);
  await pool.query(
    `INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,'ADMIN')
     ON CONFLICT (email) DO NOTHING`,
    [newId("user"), adminAgent.id, "admin@digiplayers.local", placeholderHash]
  );
  await pool.query(
    `INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,'AGENT')
     ON CONFLICT (email) DO NOTHING`,
    [newId("user"), agentIds["Prodigio"], "prodigio@digiplayers.local", placeholderHash]
  );

  console.log("\n✅ Seed completo con datos reales.");
  console.log("   Login admin:  admin@digiplayers.local (sin contraseña por ahora)");
  console.log("   Login agente: prodigio@digiplayers.local (sin contraseña por ahora)");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
