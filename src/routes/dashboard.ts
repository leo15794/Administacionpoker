import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { listAllBalances } from "../repo/ledger.js";
import { listClosings } from "../repo/closings.js";
import { registrarAjusteTesoreria, revertirAjusteTesoreria } from "../repo/treasury.js";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";

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

  // Garantías: monto activo pendiente (amount - consumed) por agente. Se muestran aparte
  // del saldo de fichas/saldo-pendiente (igual que en la planilla, que las separa por
  // "Concepto") para poder comparar el total general contra la planilla sin mezclar cosas.
  const garantias = await pool.query(
    `SELECT COALESCE(SUM(amount - consumed), 0) as pendiente, COUNT(*)::int as cantidad
     FROM guarantees WHERE active = true`
  );

  // Wallet (tesorería) neta: mismo cálculo que /tesoreria, para poder mostrar el saldo de
  // wallet junto al resto de los KPIs ejecutivos sin tener que ir a otra pantalla.
  const wallet = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END), 0) as neto
     FROM (
       SELECT direction, amount FROM treasury_entries WHERE ledger = 'WALLET_MANOS'
       UNION ALL
       SELECT direction, amount FROM treasury_adjustments WHERE ledger = 'WALLET_MANOS'
     ) t`
  );

  res.json({
    kpis: {
      agentesNosDeben: Math.abs(totalAFavorNuestro),
      debemosAAgentes: totalAFavorAgentes,
      clubesActivos: clubsCount.rows[0].n,
      agentesActivos: agentsCount.rows[0].n,
      garantiasPendientes: Number(garantias.rows[0].pendiente),
      garantiasCantidad: garantias.rows[0].cantidad,
      saldoWallet: Number(wallet.rows[0].neto),
    },
    porClub: porClub.rows,
    balances,
  });
});

dashboardRouter.get("/cierres", requireAuth, requireAdmin, async (req, res) => {
  const week = typeof req.query.week === "string" ? req.query.week : undefined;
  res.json(await listClosings(week));
});

// includeInactive=true: también trae los dados de baja (atenuados en la UI) — "dar de baja"
// nunca borra nada, pero sin este flag el agente desaparecía de la lista sin forma de volver a
// verlo, reactivarlo o borrarlo de verdad si era un duplicado de prueba.
dashboardRouter.get("/agentes", requireAuth, requireAdmin, async (req, res) => {
  const includeInactive = req.query.includeInactive === "true";
  const r = await pool.query(
    `SELECT a.*, COALESCE(SUM(b.amount),0) as saldo_total,
            (SELECT amount FROM guarantees g WHERE g.agent_id = a.id AND g.active = true ORDER BY g.updated_at DESC LIMIT 1) as garantia_monto,
            (SELECT consumed FROM guarantees g WHERE g.agent_id = a.id AND g.active = true ORDER BY g.updated_at DESC LIMIT 1) as garantia_consumida
     FROM agents a
     LEFT JOIN balances b ON b.agent_id = a.id
     ${includeInactive ? "" : "WHERE a.active = true"}
     GROUP BY a.id
     ORDER BY a.active DESC, a.name`
  );
  res.json(r.rows);
});

// Módulo de bancados (punto 6 del documento de rediseño): memoria (deuda eterna) pendiente por
// agente+club, para ver de un vistazo qué bancados están "en rojo" con el rakeback.
dashboardRouter.get("/bancados", requireAuth, requireAdmin, async (_req, res) => {
  const r = await pool.query(
    `SELECT bd.agent_id, bd.club_id, bd.debt, bd.updated_at, a.name as agent_name, c.name as club_name,
            COALESCE(b.amount, 0) as saldo_agente_club
     FROM bancado_debts bd
     JOIN agents a ON a.id = bd.agent_id
     JOIN clubs c ON c.id = bd.club_id
     LEFT JOIN balances b ON b.agent_id = bd.agent_id AND b.club_id = bd.club_id
     WHERE a.active = true
     ORDER BY bd.debt DESC, a.name`
  );
  res.json(r.rows);
});

// Módulo de supervisores (punto 5 del documento de rediseño): jerarquía supervisor -> agentes
// a cargo, con el saldo propio del supervisor (incluye el rakeback centralizado que le llega
// vía cierres con rebate_destino=RAKEBACK_SUPERVISOR) y el detalle de cada agente a cargo.
dashboardRouter.get("/supervisores", requireAuth, requireAdmin, async (_req, res) => {
  const supervisores = await pool.query(
    `SELECT a.id, a.name, COALESCE(SUM(b.amount),0) as saldo_total
     FROM agents a
     LEFT JOIN balances b ON b.agent_id = a.id
     WHERE a.active = true AND a.account_type = 'SUPERVISOR'
     GROUP BY a.id, a.name
     ORDER BY a.name`
  );
  const agentesPorSupervisor = await pool.query(
    `SELECT a.id, a.name, a.supervisor, a.account_type, COALESCE(SUM(b.amount),0) as saldo_total
     FROM agents a
     LEFT JOIN balances b ON b.agent_id = a.id
     WHERE a.active = true AND a.supervisor IS NOT NULL AND a.supervisor <> ''
     GROUP BY a.id, a.name, a.supervisor, a.account_type
     ORDER BY a.supervisor, a.name`
  );
  const rakebackAcreditado = await pool.query(
    `SELECT wc.supervisor_agent_id, COALESCE(SUM(wc.rebate),0) as total
     FROM weekly_closings wc
     WHERE wc.supervisor_agent_id IS NOT NULL AND wc.status <> 'REVERTIDO'
     GROUP BY wc.supervisor_agent_id`
  );

  const result = supervisores.rows.map((s) => ({
    ...s,
    agentes: agentesPorSupervisor.rows.filter((a) => a.supervisor === s.name),
    rakeback_centralizado_acreditado: rakebackAcreditado.rows.find((r) => r.supervisor_agent_id === s.id)?.total ?? 0,
  }));

  // Agentes que tienen un supervisor cargado como texto pero que no matchea a ningún agente
  // con account_type=SUPERVISOR activo — esto es exactamente el caso que hoy bloqueamos al
  // aplicar un cierre con rebate_destino=RAKEBACK_SUPERVISOR, así que conviene que se vea acá.
  const nombresSupervisoresValidos = new Set(supervisores.rows.map((s) => s.name));
  const supervisoresInvalidos = agentesPorSupervisor.rows.filter((a) => !nombresSupervisoresValidos.has(a.supervisor));

  res.json({ supervisores: result, supervisoresInvalidos });
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

// Tesorería real: agrega treasury_entries (automáticas, generadas por movimientos de
// agentes) + treasury_adjustments (manuales, cargadas a mano acá) por ledger y por
// custodio, para saber cuánto hay circulando y con quién sin tener que buscarlo a mano.
dashboardRouter.get("/tesoreria", requireAuth, requireAdmin, async (req, res) => {
  // Filtro opcional por ledger (ej. ?ledger=WALLET_MANOS para la pestaña de Wallet, que
  // necesita ver todo el historial real importado y no solo los últimos 150 de golpe).
  const ledgerFiltro = req.query.ledger === "WALLET_MANOS" || req.query.ledger === "CAJA_EFECTIVO" ? req.query.ledger : null;
  const limiteMovimientos = ledgerFiltro ? 600 : 150;

  const [porLedgerAuto, porLedgerAjuste, porCustodioAuto, porCustodioAjuste, movsAuto, ajustes] = await Promise.all([
    pool.query(
      `SELECT ledger,
              COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END),0) as neto,
              COUNT(*)::int as movimientos
       FROM treasury_entries GROUP BY ledger`
    ),
    pool.query(
      `SELECT ledger,
              COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END),0) as neto,
              COUNT(*)::int as movimientos
       FROM treasury_adjustments GROUP BY ledger`
    ),
    pool.query(
      `SELECT COALESCE(custodian, '(sin asignar)') as custodio, ledger,
              COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END),0) as neto,
              COUNT(*)::int as movimientos
       FROM treasury_entries WHERE ledger = 'CAJA_EFECTIVO' GROUP BY custodian, ledger`
    ),
    pool.query(
      `SELECT COALESCE(custodian, '(sin asignar)') as custodio, ledger,
              COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END),0) as neto,
              COUNT(*)::int as movimientos
       FROM treasury_adjustments WHERE ledger = 'CAJA_EFECTIVO' GROUP BY custodian, ledger`
    ),
    pool.query(
      // Excluye los treasury_entries automáticos que quedaron redundantes con el
      // historial real de Wallet Manos que importamos aparte (import:wallet-historial):
      // esos movimientos de agentes con medio de pago USDT ya generaron un treasury_entry
      // automático en su momento, y el mismo evento real también entró en el historial
      // importado (con su fecha real de la planilla). El saldo/KPI ya está bien (el ancla
      // del import neutraliza el duplicado en la suma), pero en el LISTADO se veían los
      // dos: uno automático (sin fecha real, con la fecha en que se cargó acá) y uno
      // "[HISTÓRICO]" con la fecha real. Se oculta el automático viejo y se deja el
      // histórico, que tiene el detalle y la fecha correctos.
      `SELECT t.id, t.ledger, t.direction, t.amount, t.custodian, t.occurred_at,
              m.type, m.observation, m.status as movimiento_status, a.name as agent_name
       FROM treasury_entries t
       JOIN ledger_movements m ON m.id = t.movement_id
       JOIN agents a ON a.id = m.agent_id
       WHERE NOT (t.ledger = 'WALLET_MANOS' AND m.created_by = 'import:historial-automatizacion')
       ${ledgerFiltro ? "AND t.ledger = $2" : ""}
       ORDER BY t.occurred_at DESC LIMIT $1`,
      ledgerFiltro ? [limiteMovimientos, ledgerFiltro] : [limiteMovimientos]
    ),
    pool.query(
      `SELECT id, ledger, direction, amount, custodian, occurred_at, reason, created_by, status
       FROM treasury_adjustments
       ${ledgerFiltro ? "WHERE ledger = $2" : ""}
       ORDER BY occurred_at DESC LIMIT $1`,
      ledgerFiltro ? [limiteMovimientos, ledgerFiltro] : [limiteMovimientos]
    ),
  ]);

  // Combina automático + manual por clave (ledger, o custodio+ledger).
  function merge(auto: any[], manual: any[], key: (r: any) => string) {
    const map = new Map<string, any>();
    for (const r of auto) map.set(key(r), { ...r, neto: Number(r.neto), movimientos: Number(r.movimientos) });
    for (const r of manual) {
      const k = key(r);
      const prev = map.get(k);
      if (prev) {
        prev.neto += Number(r.neto);
        prev.movimientos += Number(r.movimientos);
      } else {
        map.set(k, { ...r, neto: Number(r.neto), movimientos: Number(r.movimientos) });
      }
    }
    return [...map.values()];
  }

  const porLedger = merge(porLedgerAuto.rows, porLedgerAjuste.rows, (r) => r.ledger);
  const porCustodio = merge(porCustodioAuto.rows, porCustodioAjuste.rows, (r) => `${r.custodio}|${r.ledger}`).sort(
    (a, b) => b.neto - a.neto
  );

  const ultimosMovimientos = [
    ...movsAuto.rows.map((m) => ({ ...m, source: "movimiento" as const })),
    ...ajustes.rows.map((a) => ({
      ...a,
      type: "AJUSTE_TESORERIA",
      observation: a.reason,
      agent_name: null,
      source: "ajuste" as const,
    })),
  ]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, limiteMovimientos);

  res.json({ porLedger, porCustodio, ultimosMovimientos });
});

// Revierte un ajuste manual/histórico de tesorería (Wallet o Caja) cargado por error o
// duplicado. LEDGER INMUTABLE: no lo borra — inserta un ajuste opuesto y marca el original
// como REVERTIDO (ver revertirAjusteTesoreria). No afecta saldos de agentes (los ajustes son
// independientes de eso). Exclusivo de administrador.
dashboardRouter.delete("/tesoreria/ajuste/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo : undefined;
    const r = await revertirAjusteTesoreria(req.params.id, motivo, req.user?.email ?? null);
    if (!r.found) return res.status(404).json({ error: "No se encontró ese ajuste." });
    res.json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const ajusteSchema = z.object({
  ledger: z.enum(["WALLET_MANOS", "CAJA_EFECTIVO"]),
  direction: z.enum(["INGRESO", "EGRESO"]),
  amount: z.number().positive(),
  custodian: z.string().optional(),
  reason: z.string().min(3, "Contá brevemente el motivo del ajuste."),
  occurredAt: z.string().optional(),
});

// Ajuste manual de tesorería: plata que entra o sale de la wallet/caja SIN venir de un
// movimiento de agente (aporte propio, retiro de socio, diferencia de arqueo). Queda
// registrado en treasury_adjustments, separado de los movimientos automáticos, y siempre
// visible como "ajuste manual" en /tesoreria — nunca se pierde ni se confunde con un cobro
// o pago real de un agente.
dashboardRouter.post("/tesoreria/ajuste", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ajusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.ledger === "CAJA_EFECTIVO" && !parsed.data.custodian) {
    return res.status(400).json({ error: "Un ajuste en efectivo requiere custodio." });
  }
  try {
    const r = await registrarAjusteTesoreria({
      ...parsed.data,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
      createdBy: req.user?.email ?? null,
    });
    res.status(201).json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
