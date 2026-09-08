import { pool, newId } from "../db/pool.js";
import { calcularCierre, type SpecialRule } from "../engine/cierre.js";
import { revertirMovimiento } from "./ledger.js";

export interface AplicarCierreInput {
  agentId: string;
  clubId: string;
  weekStart: string; // 'YYYY-MM-DD'
  weekEnd: string;
  system: "PREPAGO" | "WIN_LOSE";
  result: number;
  rakeTotal: number;
  rakebackPct: number;
  rebatePct: number;
  rateSnapshot?: number;
  specialRule?: SpecialRule | null;
  observation?: string | null;
}

/**
 * Aplica un cierre semanal de forma idempotente: la clave (agent_id, club_id, week_start)
 * es única en la base. Si el cierre ya existe, no se recalcula ni se vuelve a aplicar a
 * balances (esto es exactamente la regla de BIT-001: "clave única por semana + agente + club,
 * aplicar el cierre de forma atómica").
 */
export async function aplicarCierreSemanal(input: AplicarCierreInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM weekly_closings WHERE agent_id=$1 AND club_id=$2 AND week_start=$3`,
      [input.agentId, input.clubId, input.weekStart]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return { id: existing.rows[0].id, alreadyApplied: true };
    }

    const calc = calcularCierre({
      agentId: input.agentId,
      clubId: input.clubId,
      system: input.system,
      result: input.result,
      rakeTotal: input.rakeTotal,
      rakebackPct: input.rakebackPct,
      rebatePct: input.rebatePct,
      rateSnapshot: input.rateSnapshot ?? 1,
      specialRule: input.specialRule ?? null,
    });

    const id = newId("wc");
    await client.query(
      `INSERT INTO weekly_closings
        (id, agent_id, club_id, week_start, week_end, system, result, rake_total,
         rakeback_pct, rakeback, rebate_pct, rebate, adjusted_result, final_closing,
         rate_snapshot, rule_applied, status, observation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'APLICADO',$17)`,
      [
        id,
        input.agentId,
        input.clubId,
        input.weekStart,
        input.weekEnd,
        input.system,
        calc.result,
        calc.rakeTotal,
        calc.rakebackPct,
        calc.rakeback,
        calc.rebatePct,
        calc.rebate,
        calc.adjustedResult,
        calc.finalClosing,
        input.rateSnapshot ?? 1,
        calc.ruleApplied,
        input.observation ?? null,
      ]
    );

    // El cierre final se refleja como movimiento en el ledger (no se edita balances a mano).
    await client.query(
      `INSERT INTO ledger_movements
        (id, idempotency_key, type, club_id, agent_id, amount, status, occurred_at, observation)
       VALUES ($1,$2,'CIERRE_SEMANAL',$3,$4,$5,'APLICADO',$6,$7)`,
      [
        newId("mov"),
        `cierre:${input.agentId}:${input.clubId}:${input.weekStart}`,
        input.clubId,
        input.agentId,
        calc.finalClosing,
        input.weekEnd,
        `Cierre semanal ${input.weekStart} al ${input.weekEnd}` + (calc.ruleApplied ? ` (regla especial: ${calc.ruleApplied})` : ""),
      ]
    );

    await client.query(
      `INSERT INTO balances (id, agent_id, club_id, amount, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (agent_id, club_id)
       DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
      [newId("bal"), input.agentId, input.clubId, calc.finalClosing]
    );

    await client.query("COMMIT");
    return { id, alreadyApplied: false, calc };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Revierte un cierre semanal cargado por error: LEDGER INMUTABLE, nunca se borra. Revierte
 * el efecto en el saldo a través de revertirMovimiento (que también marca REVERTIDO la fila
 * de weekly_closings asociada) y, si por algún motivo no se encuentra el movimiento del
 * ledger (dato viejo/inconsistente), marca igual REVERTIDO la fila de weekly_closings para
 * que no quede activa sin respaldo. Exclusivo de administrador.
 */
export async function revertirCierreSemanal(closingId: string, motivo?: string, revertidoPor?: string | null) {
  const wcRes = await pool.query(`SELECT * FROM weekly_closings WHERE id = $1`, [closingId]);
  const wc = wcRes.rows[0];
  if (!wc) return { found: false };
  if (wc.status === "REVERTIDO") {
    throw new Error("Este cierre ya fue revertido antes — no se puede revertir dos veces.");
  }

  const movRes = await pool.query(
    `SELECT id FROM ledger_movements
     WHERE agent_id = $1 AND club_id = $2 AND type = 'CIERRE_SEMANAL' AND occurred_at::date = $3::date AND status <> 'REVERTIDO'`,
    [wc.agent_id, wc.club_id, wc.week_end]
  );
  const movId = movRes.rows[0]?.id;

  if (movId) {
    await revertirMovimiento(movId, motivo, revertidoPor);
  } else {
    await pool.query(`UPDATE weekly_closings SET status = 'REVERTIDO' WHERE id = $1`, [closingId]);
  }
  return { found: true, id: closingId };
}

export async function listClosings(weekStart?: string) {
  const r = weekStart
    ? await pool.query(
        `SELECT wc.*, a.name as agent_name, c.name as club_name FROM weekly_closings wc
         JOIN agents a ON a.id = wc.agent_id JOIN clubs c ON c.id = wc.club_id
         WHERE week_start = $1 ORDER BY a.name`,
        [weekStart]
      )
    : await pool.query(
        `SELECT wc.*, a.name as agent_name, c.name as club_name FROM weekly_closings wc
         JOIN agents a ON a.id = wc.agent_id JOIN clubs c ON c.id = wc.club_id
         ORDER BY wc.week_start DESC, a.name`
      );
  return r.rows;
}
