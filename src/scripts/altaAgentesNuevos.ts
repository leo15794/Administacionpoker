// Alta única de los 2 agentes nuevos detectados en la reconciliación con la planilla del
// 10/09/2026 (ver saldos_planilla.json): F coco y Matias Fontal, ambos de TeamBack Suprema,
// todavía no existían en el catálogo. Usa las mismas funciones (upsertAgent/upsertDeal) que
// usa el resto de la app — es seguro correrlo más de una vez (upsertAgent es ON CONFLICT por
// nombre; upsertDeal versiona el deal anterior en vez de duplicarlo a lo loco).
import { upsertAgent, upsertDeal, getClubByName } from "../repo/catalog.js";
import { pool } from "../db/pool.js";

async function main() {
  const teamBackSuprema = await getClubByName("TeamBack Suprema");
  if (!teamBackSuprema) throw new Error('No se encontró el club "TeamBack Suprema"');

  // F coco — alta operativa 07/09/2026, Win/Lose, 70% rakeback, saldo inicial cero.
  const fCoco = await upsertAgent("F coco", "WIN_LOSE", null, "WIN_LOSE");
  await upsertDeal(fCoco.id, teamBackSuprema.id, "WIN_LOSE", 0.70, 0, "Alta automática por sync de planilla 10/09/2026");
  console.log(`✓ F coco creado/actualizado (id ${fCoco.id}) con deal 70% rakeback en TeamBack Suprema.`);

  // Matias Fontal — Bancado 50/50 mesas, rakeback 30% recupera makeup exclusivamente.
  const matiasFontal = await upsertAgent("Matias Fontal", "WIN_LOSE", null, "BANCADO");
  await upsertDeal(matiasFontal.id, teamBackSuprema.id, "WIN_LOSE", 0.30, 0, "Bancado 50/50 mesas; alta automática por sync de planilla 10/09/2026");
  console.log(`✓ Matias Fontal creado/actualizado (id ${matiasFontal.id}) con deal 30% rakeback (Bancado) en TeamBack Suprema.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
