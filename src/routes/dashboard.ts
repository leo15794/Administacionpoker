import { Router } from "express";
import { pool } from "../db/pool.js";
import { listAllBalances } from "../repo/ledger.js";
import { listClosings } from "../repo/closings.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";

export const dashboardRouter = Router();

dashboardRouter.get("/resumen", requireAuth, requireAdmin, async (_req, res) => {
  const balances = await listAllBalances();

  const totalAFavorAgentes = balances.filter((b) => Number(b.amount) > 0).reduce((s, b) => s + Number(b.amount), 0);
  const totalAFavorNuestro = balances.filter((b) => Number(b.amount) < 0).reduce((s, b) => s + Number(b.amount), 0);

  const porClub = await pool.query(
    `SELECT c.name as club, COUNT(DISTINCT b.agent_id) as agentes, COALESCE(SUM(b.amount),0) as saldo_neto
     FROM clubs c LEFT JOIN balances b ON b.club_id = c.id
     GROUP BY c.name ORDER BY c.name`
  );

  const clubsCount = await pool.query(`SELECT COUNT(*)::int as n FROM clubs WHERE active = true`);
  const agentsCount = await pool.query(`SELECT COUNT(*)::int as n FROM agents WHERE active = true`);

  res.json({
    kpis: {
      agentesNosDeben: Math.abs(totalAFavorNuestro),
      debemosAAgentes: totalAFavorAgentes,
      clubesActivos: clubsCount.rows[0].n,
      agentesActivos: agentsCount.rows[0].n,
    },
    porClub: porClub.rows,
    balances,
  });
});

dashboardRouter.get("/cierres", requireAuth, requireAdmin, async (req, res) => {
  const week = typeof req.query.week === "string" ? req.query.week : undefined;
  res.json(await listClosings(week));
});

dashboardRouter.get("/agentes", requireAuth, requireAdmin, async (_req, res) => {
  const r = await pool.query(
    `SELECT a.*, COALESCE(SUM(b.amount),0) as saldo_total
     FROM agents a LEFT JOIN balances b ON b.agent_id = a.id
     WHERE a.active = true GROUP BY a.id ORDER BY a.name`
  );
  res.json(r.rows);
});

dashboardRouter.get("/agentes/:id/deals", requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT d.*, c.name as club_name FROM agent_club_deals d JOIN clubs c ON c.id = d.club_id
     WHERE d.agent_id = $1 AND d.valid_to IS NULL ORDER BY c.name`,
    [req.params.id]
  );
  res.json(r.rows);
});
