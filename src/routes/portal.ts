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

// Portal de SUPERVISOR: mismo dato que /dashboard/supervisores arma para el admin (agentes a
// cargo + rakeback centralizado), pero filtrado al propio supervisor del login — nunca al resto.
// Placeholder mínimo hasta tener las reglas de negocio del rol Supervisor (16/09/2026): por
// ahora solo LEE, no agrega ninguna acción nueva.
portalRouter.get("/mi-supervision", requireAuth, async (req: AuthedRequest, res) => {
  const agent = await pool.query(
    `SELECT id, name, account_type, COALESCE(SUM(b.amount), 0) as saldo_total
     FROM agents a LEFT JOIN balances b ON b.agent_id = a.id
     WHERE a.id = $1
     GROUP BY a.id, a.name, a.account_type`,
    [req.user!.agentId]
  );
  if (agent.rows.length === 0) return res.status(404).json({ error: "Agente no encontrado" });
  if (agent.rows[0].account_type !== "SUPERVISOR") {
    return res.status(403).json({ error: "Esta cuenta no es de tipo Supervisor." });
  }
  const supervisor = agent.rows[0];

  const agentesACargo = await pool.query(
    `SELECT a.id, a.name, a.account_type, COALESCE(SUM(b.amount), 0) as saldo_total
     FROM agents a LEFT JOIN balances b ON b.agent_id = a.id
     WHERE a.active = true AND a.supervisor = $1
     GROUP BY a.id, a.name, a.account_type
     ORDER BY a.name`,
    [supervisor.name]
  );
  const rakebackAcreditado = await pool.query(
    `SELECT COALESCE(SUM(rebate), 0) as total FROM weekly_closings
     WHERE supervisor_agent_id = $1 AND status <> 'REVERTIDO'`,
    [supervisor.id]
  );

  // Comisión por referido: cuelga del LOGIN, no de la cuenta principal (agent_id) — así no
  // depende de qué agente tenga marcado como "cuenta principal" este usuario.
  const referidos = await pool.query(
    `SELECT r.id, r.porcentaje, r.saldo, a.name as agente_referido_name
     FROM supervisor_referidos r JOIN agents a ON a.id = r.agente_referido_id
     WHERE r.supervisor_user_id = $1 AND r.active = true ORDER BY a.name`,
    [req.user!.userId]
  );

  res.json({
    supervisor,
    agentes: agentesACargo.rows,
    rakeback_centralizado_acreditado: Number(rakebackAcreditado.rows[0].total),
    referidos: referidos.rows,
    saldo_referidos_total: referidos.rows.reduce((acc: number, r: any) => acc + Number(r.saldo), 0),
  });
});
