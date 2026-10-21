// Cuentas de jugadores de TeamBack Affiliates (21/10/2026, pedido de Leo): una cuenta corriente por jugador, como las de supervisores y agentes del
// sistema principal. Sus liquidaciones semanales suman a favor del jugador; lo que se le entrega a cuenta (fichas) o se le descuenta queda como DEUDA, y
// se compensa SOLO contra las liquidaciones, de la más vieja a la más nueva, apenas se calcula cada una (sin botón). Lo que sobra se paga como siempre.
//
//   deuda = cargos + ajustes - cobros - lo ya compensado contra liquidaciones
//   a pagar de una liquidación = total_acreditado - compensado
//
// Sección aparte del resto de DigiPlayers, igual que todo TeamBack: solo toca tb_*.
import { pool, newId } from "../db/pool.js";

let tablasListas = false;
/** Crea lo necesario si todavía no se corrió el migrate (mismo criterio que asegurarColumnasPago en repo/teamback.ts). */
export async function asegurarTablasCuentas() {
  if (tablasListas) return;
  await pool.query(`ALTER TABLE tb_weekly_liquidations
      ADD COLUMN IF NOT EXISTS pagado BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS medio_pago TEXT,
      ADD COLUMN IF NOT EXISTS wallet_movimiento_id TEXT,
      ADD COLUMN IF NOT EXISTS compensado NUMERIC(18,4) NOT NULL DEFAULT 0`);
  await pool.query(`CREATE TABLE IF NOT EXISTS tb_player_movimientos (
      id         TEXT PRIMARY KEY,
      player_id  TEXT NOT NULL REFERENCES tb_players(id),
      tipo       TEXT NOT NULL CHECK (tipo IN ('CARGO','COBRO','AJUSTE')),
      amount     NUMERIC(18,4) NOT NULL,
      concepto   TEXT,
      fecha      DATE NOT NULL DEFAULT CURRENT_DATE,
      creado_por TEXT,
      revertido  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tb_player_mov_player ON tb_player_movimientos(player_id)`);
  tablasListas = true;
}

const redondear = (n: number) => Math.round(n * 10000) / 10000;

/** Deuda actual del jugador (>= 0). */
export async function deudaActual(playerId: string): Promise<number> {
  await asegurarTablasCuentas();
  const mov = await pool.query(
    `SELECT COALESCE(SUM(CASE tipo WHEN 'CARGO' THEN amount WHEN 'COBRO' THEN -amount ELSE amount END), 0) AS neto
     FROM tb_player_movimientos WHERE player_id = $1 AND revertido = FALSE`,
    [playerId]
  );
  const comp = await pool.query(`SELECT COALESCE(SUM(compensado), 0) AS c FROM tb_weekly_liquidations WHERE player_id = $1`, [playerId]);
  return Math.max(0, redondear(Number(mov.rows[0].neto) - Number(comp.rows[0].c)));
}

/** Compensa la deuda contra las liquidaciones pendientes, de la más vieja a la más nueva. Se llama sola al calcular una semana y al cargar un movimiento. */
export async function aplicarCompensaciones(playerId: string): Promise<{ compensado: number; deuda: number }> {
  await asegurarTablasCuentas();
  // Si una liquidación se recalculó y ahora vale menos (o más) de lo ya compensado, se acomoda antes de seguir.
  await pool.query(`UPDATE tb_weekly_liquidations SET compensado = total_acreditado WHERE player_id = $1 AND compensado > total_acreditado`, [playerId]);
  await pool.query(
    `UPDATE tb_weekly_liquidations SET pagado = FALSE, paid_at = NULL, medio_pago = NULL
     WHERE player_id = $1 AND medio_pago = 'COMPENSACION' AND compensado < total_acreditado`,
    [playerId]
  );
  let deuda = await deudaActual(playerId);
  let total = 0;
  if (deuda <= 0) return { compensado: 0, deuda };
  const pendientes = await pool.query(
    `SELECT id, total_acreditado, compensado FROM tb_weekly_liquidations
     WHERE player_id = $1 AND pagado = FALSE AND compensado < total_acreditado AND total_acreditado > 0
     ORDER BY week_start ASC`,
    [playerId]
  );
  for (const l of pendientes.rows) {
    if (deuda <= 0) break;
    const libre = redondear(Number(l.total_acreditado) - Number(l.compensado));
    const toma = Math.min(deuda, libre);
    if (toma <= 0) continue;
    const nuevoCompensado = redondear(Number(l.compensado) + toma);
    const completa = nuevoCompensado >= Number(l.total_acreditado);
    await pool.query(
      `UPDATE tb_weekly_liquidations
         SET compensado = $2,
             pagado = CASE WHEN $3 THEN TRUE ELSE pagado END,
             paid_at = CASE WHEN $3 THEN now() ELSE paid_at END,
             medio_pago = CASE WHEN $3 THEN 'COMPENSACION' ELSE medio_pago END
       WHERE id = $1`,
      [l.id, nuevoCompensado, completa]
    );
    deuda = redondear(deuda - toma);
    total = redondear(total + toma);
  }
  return { compensado: total, deuda };
}

export async function registrarMovimiento(input: {
  playerId: string;
  tipo: "CARGO" | "COBRO" | "AJUSTE";
  amount: number;
  concepto?: string | null;
  fecha?: string | null;
  actor?: string | null;
}) {
  await asegurarTablasCuentas();
  const player = await pool.query(`SELECT id, name FROM tb_players WHERE id = $1`, [input.playerId]);
  if (player.rows.length === 0) throw new Error("No se encontró ese jugador.");
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error("El importe tiene que ser distinto de cero.");
  if (input.tipo !== "AJUSTE" && input.amount < 0) throw new Error("El importe de un cargo o un cobro va en positivo.");
  if (input.tipo === "COBRO") {
    const d = await deudaActual(input.playerId);
    if (input.amount > d + 0.0001) throw new Error(`El jugador debe US$ ${d.toFixed(2)}: no se le puede cobrar más que eso.`);
  }
  await pool.query(
    `INSERT INTO tb_player_movimientos (id, player_id, tipo, amount, concepto, fecha, creado_por)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7)`,
    [newId("tbmov"), input.playerId, input.tipo, input.amount, input.concepto ?? null, input.fecha ?? null, input.actor ?? null]
  );
  const comp = await aplicarCompensaciones(input.playerId);
  return { jugador: player.rows[0].name, ...comp };
}

/** Anula un movimiento: lo que se había compensado por su culpa se libera y se vuelve a compensar con lo que queda. */
export async function revertirMovimiento(movimientoId: string, actor?: string | null) {
  await asegurarTablasCuentas();
  const r = await pool.query(`SELECT id, player_id, revertido FROM tb_player_movimientos WHERE id = $1`, [movimientoId]);
  const m = r.rows[0];
  if (!m) throw new Error("No se encontró ese movimiento.");
  if (m.revertido) throw new Error("Ese movimiento ya estaba anulado.");
  await pool.query(`UPDATE tb_player_movimientos SET revertido = TRUE WHERE id = $1`, [movimientoId]);
  // Se liberan las compensaciones todavía abiertas (las que ya se pagaron en USDT/Fichas no se tocan) y se reparten de nuevo.
  await pool.query(
    `UPDATE tb_weekly_liquidations
       SET pagado = CASE WHEN medio_pago = 'COMPENSACION' THEN FALSE ELSE pagado END,
           paid_at = CASE WHEN medio_pago = 'COMPENSACION' THEN NULL ELSE paid_at END,
           medio_pago = CASE WHEN medio_pago = 'COMPENSACION' THEN NULL ELSE medio_pago END,
           compensado = 0
     WHERE player_id = $1 AND (pagado = FALSE OR medio_pago = 'COMPENSACION')`,
    [m.player_id]
  );
  void actor;
  return aplicarCompensaciones(m.player_id);
}

/** Lista de cuentas: todos los jugadores con liquidaciones o movimientos. */
export async function listarCuentas() {
  await asegurarTablasCuentas();
  const r = await pool.query(
    `SELECT p.id, p.name, p.suprema_player_id,
            COALESCE(l.semanas_pendientes, 0)::int AS semanas_pendientes,
            COALESCE(l.pendiente, 0)::float AS pendiente,
            COALESCE(l.compensado, 0)::float AS compensado,
            COALESCE(l.pagado, 0)::float AS pagado,
            COALESCE(m.neto, 0)::float AS movimientos_neto
     FROM tb_players p
     LEFT JOIN (
       SELECT player_id,
              COUNT(*) FILTER (WHERE pagado = FALSE AND total_acreditado - compensado > 0) AS semanas_pendientes,
              SUM(total_acreditado - compensado) FILTER (WHERE pagado = FALSE) AS pendiente,
              SUM(compensado) AS compensado,
              SUM(total_acreditado - compensado) FILTER (WHERE pagado = TRUE) AS pagado
       FROM tb_weekly_liquidations GROUP BY player_id
     ) l ON l.player_id = p.id
     LEFT JOIN (
       SELECT player_id, SUM(CASE tipo WHEN 'CARGO' THEN amount WHEN 'COBRO' THEN -amount ELSE amount END) AS neto
       FROM tb_player_movimientos WHERE revertido = FALSE GROUP BY player_id
     ) m ON m.player_id = p.id
     WHERE l.player_id IS NOT NULL OR m.player_id IS NOT NULL
     ORDER BY p.name`
  );
  const cuentas = r.rows.map((x: any) => {
    const deuda = Math.max(0, redondear(x.movimientos_neto - x.compensado));
    return {
      id: x.id,
      name: x.name,
      suprema_player_id: x.suprema_player_id,
      semanas_pendientes: x.semanas_pendientes,
      pendiente: redondear(x.pendiente),
      deuda,
      compensado: redondear(x.compensado),
      pagado: redondear(x.pagado),
      neto: redondear(x.pendiente - deuda),
      // Si se anuló un cargo que ya se había compensado y pagado, quedó plata retenida de más: se le debe al jugador.
      compensado_de_mas: Math.max(0, redondear(x.compensado - x.movimientos_neto)),
    };
  });
  return {
    cuentas,
    totales: {
      pendiente: redondear(cuentas.reduce((a: number, c: any) => a + c.pendiente, 0)),
      deuda: redondear(cuentas.reduce((a: number, c: any) => a + c.deuda, 0)),
      compensado: redondear(cuentas.reduce((a: number, c: any) => a + c.compensado, 0)),
      conDeuda: cuentas.filter((c: any) => c.deuda > 0).length,
    },
  };
}

/** Cuenta corriente de un jugador: liquidaciones (+), pagos (-), cargos (-), cobros (+) y ajustes, en orden de fecha, con el saldo corrido. */
export async function getCuenta(playerId: string) {
  await asegurarTablasCuentas();
  const p = await pool.query(`SELECT id, name, suprema_player_id FROM tb_players WHERE id = $1`, [playerId]);
  if (p.rows.length === 0) throw new Error("No se encontró ese jugador.");
  const liqs = await pool.query(
    `SELECT id, week_start, week_end, total_acreditado, pagado, paid_at, medio_pago, compensado
     FROM tb_weekly_liquidations WHERE player_id = $1 ORDER BY week_start ASC`,
    [playerId]
  );
  const movs = await pool.query(
    `SELECT id, tipo, amount, concepto, fecha, revertido, created_at FROM tb_player_movimientos WHERE player_id = $1 ORDER BY fecha ASC, created_at ASC`,
    [playerId]
  );
  type Fila = { clave: string; fecha: string; orden: number; tipo: string; concepto: string; importe: number; estado?: string; movimientoId?: string; revertido?: boolean };
  const filas: Fila[] = [];
  const dia = (d: any) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
  for (const l of liqs.rows) {
    const total = Number(l.total_acreditado);
    const comp = Number(l.compensado);
    const estado = l.pagado
      ? l.medio_pago === "COMPENSACION" ? "Compensada con la deuda" : `Pagada (${l.medio_pago ?? "—"})${comp > 0 ? ` · compensó ${comp.toFixed(2)}` : ""}`
      : comp > 0 ? `Pendiente · compensó ${comp.toFixed(2)}, a pagar ${(total - comp).toFixed(2)}` : "Pendiente";
    filas.push({ clave: "L" + l.id, fecha: dia(l.week_end), orden: 1, tipo: "LIQUIDACION", concepto: `Liquidación semana ${dia(l.week_start).slice(8, 10)}/${dia(l.week_start).slice(5, 7)} al ${dia(l.week_end).slice(8, 10)}/${dia(l.week_end).slice(5, 7)}`, importe: total, estado });
    if (l.pagado && l.medio_pago && l.medio_pago !== "COMPENSACION" && total - comp > 0) {
      filas.push({ clave: "P" + l.id, fecha: dia(l.paid_at ?? l.week_end), orden: 2, tipo: "PAGO", concepto: `Pago en ${l.medio_pago}`, importe: -(total - comp) });
    }
  }
  for (const m of movs.rows) {
    const a = Number(m.amount);
    const importe = m.tipo === "CARGO" ? -a : m.tipo === "COBRO" ? a : -a; // AJUSTE: positivo = suma a la deuda
    const tipoTxt = m.tipo === "CARGO" ? "Cargo" : m.tipo === "COBRO" ? "Cobro" : "Ajuste";
    filas.push({ clave: "M" + m.id, fecha: dia(m.fecha), orden: 3, tipo: m.tipo, concepto: `${tipoTxt}${m.concepto ? `: ${m.concepto}` : ""}`, importe, movimientoId: m.id, revertido: m.revertido });
  }
  filas.sort((x, y) => (x.fecha === y.fecha ? x.orden - y.orden : x.fecha < y.fecha ? -1 : 1));
  let saldo = 0;
  const movimientos = filas.map((f) => {
    if (!f.revertido) saldo = redondear(saldo + f.importe);
    return { ...f, saldo };
  });
  const lista = await listarCuentas();
  const resumen = lista.cuentas.find((c: any) => c.id === playerId) ?? { pendiente: 0, deuda: 0, compensado: 0, pagado: 0, neto: 0, semanas_pendientes: 0 };
  return { jugador: p.rows[0], resumen, movimientos };
}
