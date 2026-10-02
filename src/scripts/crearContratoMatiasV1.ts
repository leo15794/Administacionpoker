// Script para crear el contrato nuevo de Matías con la regla REGLA_BANCADO_V1 (pedido Leo
// 02/10/2026) y abrirle el primer período (octubre 2026) con la memoria migrada del acuerdo
// anterior. Leo lo corre una sola vez, a mano, con `npx tsx src/scripts/crearContratoMatiasV1.ts`
// -- no toca nada del contrato/sistema viejo de Matías (sea cual sea), eso queda intacto.
//
// El contrato nuevo tiene que apuntar a un jugador o agente YA CARGADO en el sistema (pedido
// Leo: "elegir a los jugadores/agentes que ya tenemos", nunca un nombre suelto) -- este script
// busca a "Matías" entre agents y players y, si encuentra exactamente una coincidencia, la usa.
// Si hay cero o más de una, no adivina: lista lo que encontró y hay que volver a correrlo
// pasándole el id a mano (ej. `npx tsx src/scripts/crearContratoMatiasV1.ts ag_xxxxx agent`).
//
// Valores de la sección 1/2 del documento ("SISTEMA DE BANCADOS — LÓGICA DEFINITIVA"):
//   rake_deal_pct = 60%, rake_teamback_directo_pct = 20%, split 50/50, periodicidad MENSUAL.
//   Memoria inicial migrada: USD 344.75, período de inicio octubre 2026.
import { pool } from "../db/pool.js";
import { crearContrato, listContratos, abrirPeriodo } from "../repo/bancadoContratos.js";

async function resolverMatias(): Promise<{ playerId?: string; agentId?: string; etiqueta: string }> {
  const argId = process.argv[2];
  const argTipo = process.argv[3];
  if (argId && (argTipo === "agent" || argTipo === "player")) {
    return argTipo === "agent"
      ? { agentId: argId, etiqueta: `agente ${argId} (pasado a mano)` }
      : { playerId: argId, etiqueta: `jugador ${argId} (pasado a mano)` };
  }

  const agentes = await pool.query(`SELECT id, name FROM agents WHERE name ILIKE '%mat%as%' OR name ILIKE '%matias%'`);
  const jugadores = await pool.query(
    `SELECT id, COALESCE(display_name, external_id) AS nombre FROM players WHERE display_name ILIKE '%mat%as%' OR display_name ILIKE '%matias%' OR external_id ILIKE '%mat%as%'`
  );
  const candidatos = [
    ...agentes.rows.map((a) => ({ tipo: "agent" as const, id: a.id, nombre: a.name })),
    ...jugadores.rows.map((p) => ({ tipo: "player" as const, id: p.id, nombre: p.nombre })),
  ];
  if (candidatos.length !== 1) {
    console.log("No se pudo resolver a Matías solo -- encontré estos candidatos:");
    for (const c of candidatos) console.log(`  [${c.tipo}] ${c.id} -- ${c.nombre}`);
    console.log("\nVolvé a correr el script pasando el id y el tipo a mano, ej.:");
    console.log("  npx tsx src/scripts/crearContratoMatiasV1.ts <id> agent");
    console.log("  npx tsx src/scripts/crearContratoMatiasV1.ts <id> player");
    process.exit(1);
  }
  const c = candidatos[0];
  return c.tipo === "agent" ? { agentId: c.id, etiqueta: `agente ${c.id} (${c.nombre})` } : { playerId: c.id, etiqueta: `jugador ${c.id} (${c.nombre})` };
}

async function main() {
  const { playerId, agentId, etiqueta } = await resolverMatias();

  const existentes = await listContratos();
  const yaExiste = existentes.find(
    (c: any) => c.regla_key === "REGLA_BANCADO_V1" && ((playerId && c.player_id === playerId) || (agentId && c.agent_id === agentId))
  );
  if (yaExiste) {
    console.log("Ya existe un contrato REGLA_BANCADO_V1 para", etiqueta, "(id:", yaExiste.id, ") -- no se crea de nuevo.");
    await pool.end();
    return;
  }

  const contrato = await crearContrato(
    {
      playerId,
      agentId,
      reglaKey: "REGLA_BANCADO_V1",
      v1RakeDealPct: 0.6,
      v1RakeTeambackDirectoPct: 0.2,
      v1SplitJugadorPct: 0.5,
      v1SplitTeambackPct: 0.5,
      v1ModoMemoriaDefault: "AUTOMATICO",
      observaciones: "Contrato nuevo (02/10/2026) -- reemplaza el acuerdo anterior de Matías desde octubre 2026.",
    },
    "script:crearContratoMatiasV1"
  );
  console.log("Contrato creado para", etiqueta, "-- id:", contrato.id);

  const periodo = await abrirPeriodo({
    contratoId: contrato.id,
    anio: 2026,
    mes: 10,
    memoriaInicial: 344.75,
    modoMemoria: "AUTOMATICO",
  });
  console.log("Período octubre 2026 abierto:", periodo.id, "memoria inicial:", periodo.memoria_inicial);

  console.log("\nListo. A partir de ahora, cargar los cierres parciales semanales de Matías desde 'Jugadores bancados' -> pestaña 'Contratos (regla nueva)'.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
