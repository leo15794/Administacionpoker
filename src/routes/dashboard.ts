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
    `SELECT c.id as club_id, c.name as club, COUNT(DISTINCT b.agent_id) as agentes, COALESCE(SUM(b.amount),0) as saldo_neto
     FROM clubs c LEFT JOIN balances b ON b.club_id = c.id
     GROUP BY c.id, c.name ORDER BY c.name`
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
    `SELECT a.*, COALESCE(SUM(b.amount),0) as saldo_total,
            (SELECT amount FROM guarantees g WHERE g.agent_id = a.id AND g.active = true ORDER BY g.updated_at DESC LIMIT 1) as garantia_monto,
            (SELECT consumed FROM guarantees g WHERE g.agent_id = a.id AND g.active = true ORDER BY g.updated_at DESC LIMIT 1) as garantia_consumida
     FROM agents a
     LEFT JOIN balances b ON b.agent_id = a.id
     WHERE a.active = true
     GROUP BY a.id
     ORDER BY a.name`
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

// Drill-down: historial de movimientos que arman un saldo. Filtra por agente y/o club
// (club matchea tanto origen como destino, para que una transferencia aparezca en ambos).
dashboardRouter.get("/movimientos", requireAuth, requireAdmin, async (req, res) => {
  const { agentId, clubId } = req.query;
  const conditions: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (typeof agentId === "string" && agentId) {
    conditions.push(`m.agent_id = $${i++}`);
    values.push(agentId);
  }
  if (typeof clubId === "string" && clubId) {
    conditions.push(`(m.club_id = $${i} OR m.club_destino_id = $${i})`);
    values.push(clubId);
    i++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Number(req.query.limit) || 300, 1000);
  values.push(limit);

  const r = await pool.query(
    `SELECT m.*, a.name as agent_name, c.name as club_name, cd.name as club_destino_name
     FROM ledger_movements m
     JOIN agents a ON a.id = m.agent_id
     JOIN clubs c ON c.id = m.club_id
     LEFT JOIN clubs cd ON cd.id = m.club_destino_id
     ${where}
     ORDER BY m.occurred_at DESC
     LIMIT $${i}`,
    values
  );
  res.json(r.rows);
});

// Tesorería real: agrega treasury_entries por ledger (wallet USDT / caja efectivo) y
// por custodio, para saber cuánto hay circulando y con quién sin tener que buscarlo a mano.
dashboardRouter.get("/tesoreria", requireAuth, requireAdmin, async (_req, res) => {
  const porLedger = await pool.query(
    `SELECT ledger,
            COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END),0) as neto,
            COUNT(*)::int as movimientos
     FROM treasury_entries
     GROUP BY ledger`
  );

  const porCustodio = await pool.query(
    `SELECT COALESCE(custodian, '(sin asignar)') as custodio, ledger,
            COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END),0) as neto,
            COUNT(*)::int as movimientos
     FROM treasury_entries
     WHERE ledger = 'CAJA_EFECTIVO'
     GROUP BY custodian, ledger
     ORDER BY neto DESC`
  );

  const ultimosMovimientos = await pool.query(
    `SELECT t.*, m.type, m.observation, a.name as agent_name
     FROM treasury_entries t
     JOIN ledger_movements m ON m.id = t.movement_id
     JOIN agents a ON a.id = m.agent_id
     ORDER BY t.occurred_at DESC
     LIMIT 100`
  );

  res.json({
    porLedger: porLedger.rows,
    porCustodio: porCustodio.rows,
    ultimosMovimientos: ultimosMovimientos.rows,
  });
});
