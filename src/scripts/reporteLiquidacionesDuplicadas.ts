// SOLO LECTURA -- no modifica nada. Reporta grupos de agentes + semana que quedaron con MÁS DE
// UNA fila en liquidaciones_guardadas (29/09/2026, bug real que encontró Leo: "Guardar en
// historial" podía crear una fila nueva aunque el autoguardado ya hubiera creado antes una
// PENDIENTE para el mismo grupo+semana, resuelta sola a PAGADA con fecha vieja -- terminaba
// tapada en el historial, pareciendo "desaparecida" aunque estuviera pagada de verdad. Ya
// arreglado de acá en más en src/routes/catalog.ts; esto es para ver qué duplicados quedaron
// de ANTES del fix).
//
// Para cada grupo+semana con más de una fila, muestra las filas en orden (más vieja primero)
// con: id, estado, fecha, total a pagar, y si tiene cruces/pagos todavía sin liberar (los ids
// guardados ahí) -- para que Leo decida a mano cuál fila es "la buena" y qué hacer con las
// demás (fusionar a mano el nombre/nota si hace falta, o borrar la que sobra desde "Eliminar"
// en Liquidaciones, que ya revierte cruces y pagos sola).
//
// Uso: npx tsx src/scripts/reporteLiquidacionesDuplicadas.ts
import { pool } from "../db/pool.js";

function usd(n: number) {
  return `US$ ${Number(n).toFixed(2)}`;
}

async function main() {
  const grupos = await pool.query(
    `SELECT grupo_key, week_start, COUNT(*) as cantidad
     FROM liquidaciones_guardadas
     WHERE grupo_key IS NOT NULL
     GROUP BY grupo_key, week_start
     HAVING COUNT(*) > 1
     ORDER BY week_start DESC`
  );

  if (grupos.rows.length === 0) {
    console.log("No se encontraron liquidaciones duplicadas (mismo grupo de agentes + misma semana con más de una fila).");
    await pool.end();
    return;
  }

  console.log(`Se encontraron ${grupos.rows.length} grupo(s) de agentes + semana con filas duplicadas:\n`);

  for (const g of grupos.rows) {
    const filas = await pool.query(
      `SELECT id, nombre_grupo, estado, created_at, total_a_pagar,
              array_length(adelanto_movement_ids, 1) as n_adelantos,
              array_length(carga_movement_ids, 1) as n_cargas,
              array_length(pago_pendiente_movement_ids, 1) as n_pagos_pendiente,
              array_length(pago_ledger_movement_ids, 1) as n_pagos_ledger
       FROM liquidaciones_guardadas
       WHERE grupo_key = $1 AND week_start = $2
       ORDER BY created_at ASC`,
      [g.grupo_key, g.week_start]
    );

    console.log(`── Semana ${g.week_start} — agentes: ${g.grupo_key} (${g.cantidad} filas) ──`);
    for (const f of filas.rows) {
      const pendientesSinLiberar =
        (f.n_adelantos || 0) + (f.n_cargas || 0) + (f.n_pagos_pendiente || 0) + (f.n_pagos_ledger || 0);
      console.log(
        `  id=${f.id}  "${f.nombre_grupo}"  [${f.estado}]  creada ${new Date(f.created_at).toLocaleString("es-AR")}  total a pagar: ${usd(f.total_a_pagar)}` +
          (pendientesSinLiberar > 0
            ? `  ⚠️ tiene ${pendientesSinLiberar} cruce(s)/pago(s) todavía sin liberar (adelantos:${f.n_adelantos || 0} cargas:${f.n_cargas || 0} pagos_pend:${f.n_pagos_pendiente || 0} pagos_ledger:${f.n_pagos_ledger || 0})`
            : "")
      );
    }
    console.log("");
  }

  console.log(
    "Nada de esto se tocó -- es solo un reporte. Para sacar una fila que sobra, abrila desde \"Revisar\"/\"Retomar\"\n" +
      "en Liquidaciones y usá \"Eliminar\" (ya revierte cruces y pagos sola si los tiene aplicados)."
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
