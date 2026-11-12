// Portal de socio (27/10/2026, pedido de Leo: "crearle cuenta a los socios y que vean su desglose, sus cierres y sus jugadores"). Un login con
// rol SOCIO cuelga de UNA cuenta de socio (agent_users.partner_account_id) y ve todo lo suyo: saldo, movimientos y los cierres de los agentes que
// se rutean a su cuenta (weekly_closings.routed_to_partner_account_id), con el detalle por jugador. Nunca recibe un id de cuenta del cliente: el
// id sale del token (ver routes/portal.ts).
import { pool } from "../db/pool.js";

// Si todavía no se corrió "npm run migrate", el primer uso del rol SOCIO crea la columna y deja el CHECK al día (idempotente, una vez por proceso).
let schemaListo = false;
export async function asegurarSchemaSocios() {
  if (schemaListo) return;
  await pool.query(`ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS partner_account_id TEXT REFERENCES partner_accounts(id)`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_users_role_check' AND pg_get_constraintdef(oid) NOT LIKE '%SOCIO%') THEN
        ALTER TABLE agent_users DROP CONSTRAINT agent_users_role_check;
        ALTER TABLE agent_users ADD CONSTRAINT agent_users_role_check CHECK (role IN ('AGENT','ADMIN','SUPERVISOR','PROVEEDOR','SOCIO'));
      END IF;
    END $$;`);
  schemaListo = true;
}

const n = (x: any) => Number(x ?? 0);

export async function getMiSocio(accountId: string) {
  const cuentaR = await pool.query(
    `SELECT pa.id, pa.name, pa.description, pa.kind, COALESCE(SUM(e.amount), 0) AS saldo
     FROM partner_accounts pa LEFT JOIN partner_account_entries e ON e.account_id = pa.id
     WHERE pa.id = $1 GROUP BY pa.id`,
    [accountId]
  );
  const cuenta = cuentaR.rows[0];
  if (!cuenta) throw new Error("Cuenta de socio no encontrada.");

  const movR = await pool.query(
    `SELECT e.id, e.category, e.concept, e.amount, e.entry_date, e.notes, ag.name AS agente
     FROM partner_account_entries e LEFT JOIN agents ag ON ag.id = e.source_agent_id
     WHERE e.account_id = $1 ORDER BY e.entry_date DESC, e.created_at DESC LIMIT 500`,
    [accountId]
  );

  const cierresR = await pool.query(
    `SELECT wc.id, wc.week_start, wc.week_end, wc.system, wc.result, wc.rake_total, wc.rakeback_pct, wc.rakeback, wc.rebate, wc.rodeo,
            wc.ajuste_manual, wc.ajuste_manual_nota, wc.final_closing, wc.jugadores, a.name AS agent_name, c.name AS club_name
     FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     JOIN clubs c ON c.id = wc.club_id
     WHERE wc.routed_to_partner_account_id = $1 AND wc.status <> 'REVERTIDO'
     ORDER BY wc.week_start DESC, a.name`,
    [accountId]
  );
  const ids = cierresR.rows.map((r) => r.id);
  const detR = ids.length
    ? await pool.query(
        `SELECT closing_id, player_external_id, player_name, resultado, rake, rakeback, cierre_jugador
         FROM weekly_closing_player_details WHERE closing_id = ANY($1::text[]) ORDER BY rake DESC, player_name`,
        [ids]
      )
    : { rows: [] as any[] };
  const detPorCierre = new Map<string, any[]>();
  for (const d of detR.rows) {
    const arr = detPorCierre.get(d.closing_id) ?? [];
    arr.push({ id: d.player_external_id, nombre: d.player_name, resultado: n(d.resultado), rake: n(d.rake), rakeback: n(d.rakeback), cierre: n(d.cierre_jugador) });
    detPorCierre.set(d.closing_id, arr);
  }

  const semanas = new Map<string, { weekStart: string; weekEnd: string; efectoCuenta: number; jugadores: number; agentes: any[] }>();
  for (const r of cierresR.rows) {
    const ws = String(r.week_start).slice(0, 10);
    let s = semanas.get(ws);
    if (!s) {
      s = { weekStart: ws, weekEnd: String(r.week_end).slice(0, 10), efectoCuenta: 0, jugadores: 0, agentes: [] };
      semanas.set(ws, s);
    }
    const final = n(r.final_closing);
    // En la cuenta del socio el movimiento es -cierre (ver aplicarCierreCompensacionPersonaTx): cierre a favor del agente = baja lo que el socio le debe a la empresa.
    s.efectoCuenta += -final;
    s.jugadores += r.jugadores != null ? Number(r.jugadores) : 0;
    s.agentes.push({
      id: r.id,
      agente: r.agent_name,
      club: r.club_name,
      system: r.system,
      resultado: n(r.result),
      rake: n(r.rake_total),
      rakebackPct: n(r.rakeback_pct),
      rakeback: n(r.rakeback),
      rebate: n(r.rebate),
      rodeo: n(r.rodeo),
      ajusteManual: n(r.ajuste_manual),
      ajusteManualNota: r.ajuste_manual_nota ?? null,
      cierreFinal: final,
      cantJugadores: r.jugadores != null ? Number(r.jugadores) : null,
      jugadores: detPorCierre.get(r.id) ?? [],
    });
  }

  return {
    cuenta: { id: cuenta.id, nombre: cuenta.name, descripcion: cuenta.description, saldo: n(cuenta.saldo) },
    movimientos: movR.rows.map((m) => ({ id: m.id, categoria: m.category, concepto: String(m.concept).replace(/\s*\(agente id [^)]*\)/, m.agente ? ` · ${m.agente}` : ""), monto: n(m.amount), fecha: String(m.entry_date).slice(0, 10), notas: m.notes })),
    semanas: Array.from(semanas.values()),
  };
}
