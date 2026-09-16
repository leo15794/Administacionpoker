import { Router } from "express";
import { listBalancesByAgent, listMovementsByAgent } from "../repo/ledger.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { pool } from "../db/pool.js";

export const portalRouter = Router();

// Qué agentes/clubes puede ver este login — un mismo usuario de portal puede tener más de uno
// (ver agent_user_agents), para el selector de "Mi cuenta" cuando aplica. Siempre incluye al
// menos la cuenta principal del usuario (agent_id de agent_users), aunque por algún motivo la
// tabla de agregados no tenga filas para él (usuarios viejos ya quedaron con backfill, pero por
// las dudas no se rompe si faltara).
portalRouter.get("/mis-agentes", requireAuth, async (req: AuthedRequest, res) => {
  const r = await pool.query(
    `SELECT DISTINCT a.id, a.name FROM agent_user_agents uax JOIN agents a ON a.id = uax.agent_id
     WHERE uax.user_id = $1
     UNION
     SELECT a.id, a.name FROM agents a WHERE a.id = $2
     ORDER BY name`,
    [req.user!.userId, req.user!.agentId]
  );
  res.json(r.rows);
});

// Portal de agente: cada agente ve SOLO su propia cuenta (reemplaza las 13 planillas externas).
// ?agentId=... deja elegir CUÁL de sus cuentas mirar, cuando el login tiene más de una asociada
// (ver /mis-agentes) — sin eso, usa la cuenta principal del token. Siempre valida que el agentId
// pedido esté entre los que ese login puede ver — nunca confía en el query param a ciegas.
portalRouter.get("/mi-cuenta", requireAuth, async (req: AuthedRequest, res) => {
  const agentIdPedido = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  let agentId = req.user!.agentId;
  if (agentIdPedido && agentIdPedido !== agentId) {
    const permitido = await pool.query(
      `SELECT 1 FROM agent_user_agents WHERE user_id = $1 AND agent_id = $2`,
      [req.user!.userId, agentIdPedido]
    );
    if (permitido.rows.length === 0) return res.status(403).json({ error: "No tenés acceso a ese agente." });
    agentId = agentIdPedido;
  }
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
  const stock = await pool.query(
    `SELECT s.*, c.name as club_name,
            CASE WHEN s.rate IS NOT NULL THEN s.units * s.rate ELSE NULL END as usd_ref
     FROM account_stock s JOIN clubs c ON c.id = s.club_id
     WHERE s.agent_id = $1 ORDER BY c.name`,
    [agentId]
  );
  const adelantos = await pool.query(
    `SELECT * FROM rakeback_advances WHERE agent_id = $1 AND active = true ORDER BY created_at DESC`,
    [agentId]
  );

  res.json({
    agente: agent.rows[0],
    saldos: balances,
    movimientos,
    garantia: guarantee.rows[0] ?? null,
    cierres: closings.rows,
    stock: stock.rows,
    adelantos: adelantos.rows,
  });
});
