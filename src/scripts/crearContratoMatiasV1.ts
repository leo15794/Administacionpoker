// Script para crear el contrato nuevo de Matías con la regla REGLA_BANCADO_V1 (pedido Leo
// 02/10/2026) y abrirle el primer período (octubre 2026) con la memoria migrada del acuerdo
// anterior. Leo lo corre una sola vez, a mano, con `npx tsx src/scripts/crearContratoMatiasV1.ts`
// -- no toca nada del contrato/sistema viejo de Matías (sea cual sea), eso queda intacto.
//
// Valores de la sección 1/2 del documento ("SISTEMA DE BANCADOS — LÓGICA DEFINITIVA"):
//   rake_deal_pct = 60%, rake_teamback_directo_pct = 20%, split 50/50, periodicidad MENSUAL.
//   Memoria inicial migrada: USD 344.75, período de inicio octubre 2026.
//
// Por las dudas no corre de nuevo si ya existe un contrato "Matías" con esta regla -- avisa y
// no hace nada (para poder correrlo sin miedo si no está seguro si ya lo corrió).
import { pool } from "../db/pool.js";
import { crearContrato, listContratos, abrirPeriodo } from "../repo/bancadoContratos.js";

async function main() {
  const existentes = await listContratos();
  const yaExiste = existentes.find((c: any) => c.nombre === "Matías" && c.regla_key === "REGLA_BANCADO_V1");
  if (yaExiste) {
    console.log("Ya existe un contrato 'Matías' con REGLA_BANCADO_V1 (id:", yaExiste.id, ") -- no se crea de nuevo.");
    await pool.end();
    return;
  }

  const contrato = await crearContrato(
    {
      nombre: "Matías",
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
  console.log("Contrato creado:", contrato.id, contrato.nombre);

  const periodo = await abrirPeriodo({
    contratoId: contrato.id,
    anio: 2026,
    mes: 10,
    memoriaInicial: 344.75,
    modoMemoria: "AUTOMATICO",
  });
  console.log("Período octubre 2026 abierto:", periodo.id, "memoria inicial:", periodo.memoria_inicial);

  console.log("\nListo. A partir de ahora, cargar los cierres parciales semanales de Matías desde la pantalla 'Bancado — Contratos'.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
