// Alta única del adelanto de rakeback real que encontramos en SALDOS_AGENTES (export del
// 10/09/2026): Prodigio, club Tiny GG, $2.600 vigentes ("saldo previo USD 1.000 + nuevo
// adelanto de 600..." — el detalle exacto está en la observación de esa fila de la planilla).
// Idempotente: si ya existe un adelanto activo para este par, no hace nada (fallaría con un
// mensaje claro en vez de duplicar — correr una sola vez).
import { getAgentByName, getClubByName } from "../repo/catalog.js";
import { ajustarAdelanto } from "../repo/advances.js";
import { pool } from "../db/pool.js";

async function main() {
  const agent = await getAgentByName("Prodigio");
  const club = await getClubByName("Tiny GG");
  if (!agent || !club) {
    console.error(`No encontrado en catálogo: agente="Prodigio" (${agent ? "ok" : "FALTA"}) / club="Tiny GG" (${club ? "ok" : "FALTA"})`);
    process.exit(1);
  }

  const advance = await ajustarAdelanto({
    agentId: agent.id,
    clubId: club.id,
    type: "ALTA",
    amount: 2600,
    notes: "Cargado desde SALDOS_AGENTES (planilla, export 10/09/2026): saldo previo USD 1.000 + nuevo adelanto de 600 en fichas. Ver historial de la planilla para el detalle completo de cuándo se dio cada parte.",
    createdBy: "alta:adelanto-prodigio",
  });

  console.log("Adelanto creado:", advance);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
