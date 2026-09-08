import { Router } from "express";
import { listBalancesByAgent, listMovementsByAgent } from "../repo/ledger.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { pool } from "../db/pool.js";

export const portalRouter = Router();

// Portal de agente: cada agente ve SOLO su propia cuenta (reemplaza las 13 planillas externas).
portalRouter.get("/mi-cuenta", requireAuth, async (req: AuthedRequest, res) => {
  const agentId = req.user!.agentId;
  const agent = await pool.query(`SELECT id, name, default_system, supervisor FROM agents WHERE id = $1`, [agentId]);
  if (agent.rows.length === 0) return res.status(404).json({ error: "Agente no encontrado" });

  const balances = await listBalancesByAgent(agentId);
  const movimientos = await listMovementsByAgent(agentId, 100);
  const guarantee = await pool.query(`SELECT * FROM guarantees WHERE agent_id = $1 AND active = true`, [agentId]);
  const closings = await pool.query(
    `SELECT wc.*, c.name as club_name FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
     WHERE agent_id = $1 ORDER BY week_start DESC LIMIT 20`,
    [agentId]
  );

  res.json({
    agente: agent.rows[0],
    saldos: balances,
    movimientos,
    garantia: guarantee.rows[0] ?? null,
    cierres: closings.rows,
  });
});
