import { Router } from "express";
import { z } from "zod";
import { listBalancesByAgent, listMovementsByAgent } from "../repo/ledger.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { pool } from "../db/pool.js";
import { calcularCierre } from "../engine/cierre.js";
import {
  getSemanasDisponiblesSupervisor,
  getCierreSemanalSupervisor,
  crearSolicitudRetiroSupervisor,
  listSolicitudesRetiroSupervisor,
  listSaldosPorAgenteSupervisor,
  esSupervisorWinLose,
  agenteTieneCuentaPropia,
  getMiCuentaAgente,
} from "../repo/supervisores.js";
import {
  listSaldosProveedores,
  listCierresProveedor,
  listPagosProveedor,
  listLineasCierreProveedor,
  crearSolicitudRetiroProveedor,
  listSolicitudesRetiroProveedor,
} from "../repo/proveedores.js";

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
    [req.user!.userId, req.user!.agentId!]
  );
  res.json(r.rows);
});

// Portal de agente: cada agente ve SOLO su propia cuenta (reemplaza las 13 planillas externas).
// ?agentId=... deja elegir CUÁL de sus cuentas mirar, cuando el login tiene más de una asociada
// (ver /mis-agentes) — sin eso, usa la cuenta principal del token. Siempre valida que el agentId
// pedido esté entre los que ese login puede ver — nunca confía en el query param a ciegas.
portalRouter.get("/mi-cuenta", requireAuth, async (req: AuthedRequest, res) => {
  const agentIdPedido = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
  let agentId = req.user!.agentId!;
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
  // kind='RAKEBACK' (01/10/2026): mismo criterio que catalog.ts /agents/:id/cuenta -- un
  // adelanto kind='FICHAS_PENDIENTE' ya está restado del saldo (ver nota ahí), no corresponde
  // mostrarlo acá como pendiente aparte.
  const adelantos = await pool.query(
    `SELECT * FROM rakeback_advances WHERE agent_id = $1 AND active = true AND kind = 'RAKEBACK' ORDER BY created_at DESC`,
    [agentId]
  );

  // Agente con cuenta propia en la sección Agentes (20/10/2026): "Mi cuenta" muestra esa cuenta (saldo, cierres con su
  // desglose por club y jugador, movimientos) en vez del saldo viejo -- ver repo/supervisores.ts getMiCuentaAgente.
  const cuentaPropia = (await agenteTieneCuentaPropia(agentId)).tiene ? await getMiCuentaAgente(agentId) : null;

  res.json({
    agente: agent.rows[0],
    saldos: balances,
    movimientos,
    garantia: guarantee.rows[0] ?? null,
    cierres: closings.rows,
    adelantos: adelantos.rows,
    cuenta: cuentaPropia,
  });
});

// Portal de SUPERVISOR: mismo dato que /dashboard/supervisores arma para el admin (agentes a
// cargo + rakeback centralizado), pero filtrado al propio supervisor del login — nunca al resto.
// Placeholder mínimo hasta tener las reglas de negocio del rol Supervisor (16/09/2026): por
// ahora solo LEE, no agrega ninguna acción nueva.
portalRouter.get("/mi-supervision", requireAuth, async (req: AuthedRequest, res) => {
  // Envuelto en try/catch a propósito: Express 4 NO atrapa solo un throw async como este (sin
  // este try/catch, si cualquiera de las queries de abajo fallaba, el request se quedaba
  // colgado para siempre del lado del navegador — "Cargando..." eterno, sin ningún error visible
  // ni en pantalla ni en los logs). Con esto, cualquier falla real muestra un error claro en vez
  // de tildarse.
  try {
    // saldo_total (30/09/2026, mismo bug/fix que routes/dashboard.ts GET /agentes -- este
    // SUM(b.amount) crudo no incluía el resultado de mesas de los cierres PREPAGO, así que no
    // coincidía con la columna "Fichas" de Resumen -> Saldos por agente y club).
    // usa_cuenta_consolidada / consolidar_cierres y el saldo de supervisor_cuentas (14/10/2026,
    // pedido de Leo: "deberia el poder entrar y ver el desglose que esta cargado en
    // supervisores") -- el supervisor ve acá el mismo saldo (fichas_reales/cuenta_corriente)
    // que el admin ve en Administración -> Supervisores, siempre filtrado a su propia cuenta.
    const agent = await pool.query(
      `SELECT a.id, a.name, a.account_type, a.usa_cuenta_consolidada, a.consolidar_cierres, a.default_system,
              COALESCE(bal.saldo_balance,0) + COALESCE(mesas.total_mesas,0) as saldo_total,
              COALESCE(sc.fichas_reales, 0) as fichas_reales, COALESCE(sc.cuenta_corriente, 0) as cuenta_corriente
       FROM agents a
       LEFT JOIN (SELECT agent_id, SUM(amount) as saldo_balance FROM balances GROUP BY agent_id) bal ON bal.agent_id = a.id
       LEFT JOIN (
         SELECT agent_id, SUM(result) as total_mesas FROM weekly_closings
         WHERE system = 'PREPAGO' AND status <> 'REVERTIDO' GROUP BY agent_id
       ) mesas ON mesas.agent_id = a.id
       LEFT JOIN supervisor_cuentas sc ON sc.supervisor_agent_id = a.id
       WHERE a.id = $1`,
      [req.user!.agentId!]
    );
    if (agent.rows.length === 0) return res.status(404).json({ error: "Agente no encontrado" });
    if (agent.rows[0].account_type !== "SUPERVISOR") {
      return res.status(403).json({ error: "Esta cuenta no es de tipo Supervisor." });
    }
    const supervisor = agent.rows[0];

    const agentesACargo = await pool.query(
      `SELECT a.id, a.name, a.account_type,
              COALESCE(bal.saldo_balance,0) + COALESCE(mesas.total_mesas,0) as saldo_total
       FROM agents a
       LEFT JOIN (SELECT agent_id, SUM(amount) as saldo_balance FROM balances GROUP BY agent_id) bal ON bal.agent_id = a.id
       LEFT JOIN (
         SELECT agent_id, SUM(result) as total_mesas FROM weekly_closings
         WHERE system = 'PREPAGO' AND status <> 'REVERTIDO' GROUP BY agent_id
       ) mesas ON mesas.agent_id = a.id
       WHERE a.active = true AND a.supervisor = $1
       ORDER BY a.name`,
      [supervisor.name]
    );
    // Supervisor Win/Lose con cuenta consolidada (20/10/2026): el saldo de cada agente que se muestra es lo que ese
    // agente aporta a la cuenta corriente del supervisor (su parte del pozo), no su balance de fichas -- en Win/Lose
    // las fichas son operativas del club y se ignoran. Mismo cálculo que "Origen del saldo" en el admin.
    if (supervisor.usa_cuenta_consolidada && esSupervisorWinLose(supervisor)) {
      const porAgente = new Map((await listSaldosPorAgenteSupervisor(supervisor.id)).map((f) => [f.agentId, f.cuentaCorriente]));
      for (const a of agentesACargo.rows) a.saldo_total = porAgente.get(a.id) ?? 0;
    }
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

    // Historial detallado de movimientos (comisiones acreditadas + correcciones), con la semana
    // del cierre que las generó — incluye referidos ya desactivados, para que el historial no
    // desaparezca si se corta una comisión a futuro.
    const movimientos = await pool.query(
      `SELECT m.*, a.name as agente_referido_name, wc.week_start, wc.week_end
       FROM supervisor_referido_movements m
       JOIN supervisor_referidos r ON r.id = m.referido_id
       JOIN agents a ON a.id = r.agente_referido_id
       LEFT JOIN weekly_closings wc ON wc.id = m.weekly_closing_id
       WHERE r.supervisor_user_id = $1
       ORDER BY m.occurred_at DESC
       LIMIT 300`,
      [req.user!.userId]
    );

    // "Pagos" (24/09/2026, pedido de Leo): balance de TODO lo que le pasa a los agentes a cargo
    // -- pagos que les mandamos, cargas/descargas de fichas, transferencias entre clubes, ajustes,
    // etc (ledger_movements crudo, mismo dato que ya ve cada agente en su propio "Mi cuenta" --
    // acá agregado para todo el grupo del supervisor, con el nombre del agente en cada fila para
    // poder distinguir). Incluye también al propio supervisor (puede tener su propia cuenta con
    // movimientos). REVERTIDO se excluye -- esos quedan reemplazados por el movimiento de reversa.
    const agentIdsGrupo = [supervisor.id, ...agentesACargo.rows.map((a: any) => a.id)];
    const movimientosAgentes = await pool.query(
      `SELECT m.*, a.name as agent_name, c.name as club_name
       FROM ledger_movements m
       JOIN agents a ON a.id = m.agent_id
       JOIN clubs c ON c.id = m.club_id
       WHERE m.agent_id = ANY($1::text[]) AND m.status <> 'REVERTIDO'
       ORDER BY m.occurred_at DESC
       LIMIT 300`,
      [agentIdsGrupo]
    );

    // Movimientos de la CUENTA CONSOLIDADA del propio supervisor (20/10/2026, pedido de Leo: "que a los
    // supervisores en su login puedan ver los movimientos"): cargas, descargas, ajustes, pagos y cobros que
    // carga el admin en Supervisores -> Movimientos, con cómo quedaron fichas reales y cuenta corriente. Solo
    // los de SU cuenta (supervisor_agent_id = su id de login, nunca uno de la URL) y sin los revertidos. Se manda
    // solo lo que se muestra: no se expone usdt_real (si tocó Wallet) ni quién lo cargó.
    let movimientosCuenta: any[] = [];
    if (supervisor.usa_cuenta_consolidada) {
      const mc = await pool.query(
        `SELECT sm.id, sm.type, sm.amount, sm.fichas_reales_delta, sm.cuenta_corriente_delta,
                sm.saldo_nuevo_fichas, sm.saldo_nuevo_cc, sm.notes, sm.occurred_at,
                c.name as club_name, a.name as agent_name
         FROM supervisor_movimientos sm
         LEFT JOIN clubs c ON c.id = sm.club_id
         LEFT JOIN agents a ON a.id = sm.agent_id
         WHERE sm.supervisor_agent_id = $1 AND sm.status <> 'REVERTIDO'
         ORDER BY sm.occurred_at DESC, sm.id DESC
         LIMIT 300`,
        [supervisor.id]
      );
      movimientosCuenta = mc.rows;
    }

    res.json({
      supervisor,
      agentes: agentesACargo.rows,
      rakeback_centralizado_acreditado: Number(rakebackAcreditado.rows[0].total),
      referidos: referidos.rows,
      saldo_referidos_total: referidos.rows.reduce((acc: number, r: any) => acc + Number(r.saldo), 0),
      movimientos_referidos: movimientos.rows,
      movimientos_agentes: movimientosAgentes.rows,
      movimientos_cuenta: movimientosCuenta,
    });
  } catch (err: any) {
    console.error("Error en /portal/mi-supervision:", err);
    res.status(500).json({ error: err.message || "No se pudo cargar la supervisión." });
  }
});

// Cierre semanal consolidado, en versión de solo lectura para el propio supervisor (14/10/2026,
// pedido de Leo) -- mismo dato que /supervisores/:id/cierre-semanal/* ve el admin, pero SIEMPRE
// atado a req.user!.agentId! (nunca a un :id de la URL): un supervisor jamás puede pedir el
// desglose de otro. Sin ruta de "aplicar" acá -- esa acción sigue siendo exclusiva del admin.
portalRouter.get("/mi-supervision/cierre-semanal/semanas", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const agent = await pool.query(`SELECT account_type, usa_cuenta_consolidada FROM agents WHERE id = $1`, [req.user!.agentId!]);
    if (!agent.rows[0] || agent.rows[0].account_type !== "SUPERVISOR") {
      return res.status(403).json({ error: "Esta cuenta no es de tipo Supervisor." });
    }
    if (!agent.rows[0].usa_cuenta_consolidada) {
      return res.status(403).json({ error: "Esta cuenta no tiene la cuenta consolidada activada." });
    }
    res.json(await getSemanasDisponiblesSupervisor(req.user!.agentId!));
  } catch (err: any) {
    console.error("Error en /portal/mi-supervision/cierre-semanal/semanas:", err);
    res.status(500).json({ error: err.message || "No se pudo cargar las semanas." });
  }
});

portalRouter.get("/mi-supervision/cierre-semanal/:weekStart", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const agent = await pool.query(`SELECT account_type, usa_cuenta_consolidada FROM agents WHERE id = $1`, [req.user!.agentId!]);
    if (!agent.rows[0] || agent.rows[0].account_type !== "SUPERVISOR") {
      return res.status(403).json({ error: "Esta cuenta no es de tipo Supervisor." });
    }
    if (!agent.rows[0].usa_cuenta_consolidada) {
      return res.status(403).json({ error: "Esta cuenta no tiene la cuenta consolidada activada." });
    }
    res.json(await getCierreSemanalSupervisor(req.user!.agentId!, req.params.weekStart));
  } catch (err: any) {
    console.error("Error en /portal/mi-supervision/cierre-semanal/:weekStart:", err);
    res.status(500).json({ error: err.message || "No se pudo cargar el cierre de esa semana." });
  }
});

// ---------------------------------------------------------------------------------------------
// Rol PROVEEDOR (16/10/2026, pedido de Leo: "agregarlos como usuarios y darles los permisos
// como hacemos con los supervisores") -- portal de solo lectura: ve el mismo dato que el admin
// ve en Administración -> Proveedores (saldo, cierres, pagos) pero SIEMPRE filtrado a sí mismo,
// vía req.user!.proveedorId (nunca a un :id de la URL) -- mismo criterio que /mi-supervision.
// ---------------------------------------------------------------------------------------------
portalRouter.get("/mi-proveedor", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.role !== "PROVEEDOR" || !req.user!.proveedorId) {
    return res.status(403).json({ error: "Esta cuenta no es de tipo Proveedor." });
  }
  try {
    const proveedorId = req.user!.proveedorId;
    const prov = await pool.query(`SELECT id, name, active FROM proveedores WHERE id = $1`, [proveedorId]);
    if (!prov.rows[0]) return res.status(404).json({ error: "Proveedor no encontrado." });
    const [saldosTodos, cierres, pagos] = await Promise.all([
      listSaldosProveedores(),
      listCierresProveedor(proveedorId),
      listPagosProveedor(proveedorId),
    ]);
    res.json({
      proveedor: prov.rows[0],
      saldos: saldosTodos.filter((s: any) => s.proveedor_id === proveedorId),
      cierres,
      pagos,
    });
  } catch (err: any) {
    console.error("Error en /portal/mi-proveedor:", err);
    res.status(500).json({ error: err.message || "No se pudo cargar tu cuenta." });
  }
});

// Desglose de un cierre semanal del propio proveedor (19/10/2026, pedido de Leo: que pueda desplegar la semana).
// Solo si el cierre es SUYO (proveedor_id = el de su login) -- nunca se pide por un id de proveedor de la URL.
portalRouter.get("/mi-proveedor/cierres/:id/lineas", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.role !== "PROVEEDOR" || !req.user!.proveedorId) {
    return res.status(403).json({ error: "Esta cuenta no es de tipo Proveedor." });
  }
  try {
    const propio = await pool.query(`SELECT 1 FROM proveedor_cierres WHERE id = $1 AND proveedor_id = $2`, [req.params.id, req.user!.proveedorId]);
    if (!propio.rows[0]) return res.status(404).json({ error: "Cierre no encontrado." });
    const lineas = await listLineasCierreProveedor(req.params.id);
    res.json(
      lineas.map((l: any) => ({
        id: l.id,
        tipo: l.tipo,
        notes: l.tipo === "AJUSTE" ? l.notes : null,
        club_name: l.club_name,
        agent_name: l.agent_name,
        resultado_total: l.resultado_total,
        rake_total: l.rake_total,
        rakeback_pct: l.rakeback_pct,
        club_rebate: l.club_rebate,
        impacto_rodeo: l.impacto_rodeo,
        monto_crudo: l.monto_crudo,
        monto_aplicado: l.monto_aplicado,
        wc_result: l.wc_result,
        wc_rake_total: l.wc_rake_total,
        wc_rakeback_pct: l.wc_rakeback_pct,
        wc_rodeo: l.wc_rodeo,
      }))
    );
  } catch (err: any) {
    console.error("Error en /portal/mi-proveedor/cierres/:id/lineas:", err);
    res.status(500).json({ error: err.message || "No se pudo cargar el detalle del cierre." });
  }
});

// Desglose COMPLETO de un cierre del propio proveedor (19/10/2026, pedido de Leo: página aparte para no cargar el
// panel): por cada línea del cierre, los agentes del club esa semana (línea de club) o el agente de la línea (línea
// de agente), con lo que cada uno generó. Mismos datos que ve el admin en Cierres semanales. Solo si el cierre es SUYO.
portalRouter.get("/mi-proveedor/cierres/:id/detalle", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.role !== "PROVEEDOR" || !req.user!.proveedorId) {
    return res.status(403).json({ error: "Esta cuenta no es de tipo Proveedor." });
  }
  try {
    const cab = await pool.query(
      `SELECT id, week_start, week_end, cierre, saldo_anterior, saldo_nuevo, status
       FROM proveedor_cierres WHERE id = $1 AND proveedor_id = $2`,
      [req.params.id, req.user!.proveedorId]
    );
    if (!cab.rows[0]) return res.status(404).json({ error: "Cierre no encontrado." });
    const lineas = await listLineasCierreProveedor(req.params.id);
    const salida = [];
    for (const l of lineas as any[]) {
      const filas =
        l.tipo === "AJUSTE"
          ? { rows: [] as any[] }
          : l.tipo === "AGENTE" && l.weekly_closing_id
          ? await pool.query(
              `SELECT wc.id as closing_id, a.name as agent_name, wc.system, wc.jugadores, wc.result, wc.rake_total, wc.rakeback_pct, wc.rakeback, wc.rodeo, wc.final_closing
               FROM weekly_closings wc JOIN agents a ON a.id = wc.agent_id WHERE wc.id = $1`,
              [l.weekly_closing_id]
            )
          : await pool.query(
              `SELECT wc.id as closing_id, a.name as agent_name, wc.system, wc.jugadores, wc.result, wc.rake_total, wc.rakeback_pct, wc.rakeback, wc.rodeo, wc.final_closing
               FROM weekly_closings wc JOIN agents a ON a.id = wc.agent_id
               WHERE wc.club_id = $1 AND wc.week_start = $2::date AND wc.status <> 'REVERTIDO'
               ORDER BY ABS(wc.rake_total) DESC, a.name`,
              [l.club_id, cab.rows[0].week_start]
            );
      // 19/10/2026 (pedido de Leo: "el rakeback tiene que ser 75 no 65"): en una línea de CLUB el proveedor cobra el
      // % de la línea (ej. 75%), no el trato propio de cada agente (ej. 65%, que además es info interna de la casa).
      // Se muestra a cada agente con el % del club y se recalculan rakeback y cierre final para que las filas sumen
      // exactamente el monto de la línea. En una línea de AGENTE el % ya es el del proveedor, no se toca.
      let agentes = filas.rows;
      if (l.tipo === "CLUB" && l.rakeback_pct !== null && l.rakeback_pct !== undefined) {
        const pct = Number(l.rakeback_pct);
        agentes = agentes.map((a: any) => {
          const rakeback = Math.round(Number(a.rake_total) * pct * 10000) / 10000;
          const final = Math.round((Number(a.result) + rakeback + Number(a.rodeo)) * 10000) / 10000;
          return { ...a, rakeback_pct: pct, rakeback, final_closing: final };
        });
      }
      // Jugadores de cada agente esa semana (19/10/2026, pedido de Leo: que el proveedor pueda ver los jugadores de
      // cada agente). Solo existen para cierres aplicados desde que se guarda el detalle; si no hay, el agente
      // queda sin jugadores y el front no ofrece desplegarlo. Se devuelve SOLO lo que el proveedor necesita
      // (nombre, ID, resultado, rake) y el rakeback se calcula con el % que cobra el proveedor: nada del trato propio
      // de la casa con el agente ni del subagente.
      const ids = agentes.map((a: any) => a.closing_id).filter(Boolean);
      const jugRows = ids.length
        ? (
            await pool.query(
              `SELECT closing_id, player_external_id, player_name, resultado, rake
               FROM weekly_closing_player_details WHERE closing_id = ANY($1::text[])
               ORDER BY rake DESC, player_name`,
              [ids]
            )
          ).rows
        : [];
      agentes = agentes.map((a: any) => {
        const pct = Number(a.rakeback_pct);
        const jugadores_detalle = jugRows
          .filter((j: any) => j.closing_id === a.closing_id)
          .map((j: any) => {
            const rakeback = Math.round(Number(j.rake) * pct * 10000) / 10000;
            return {
              id: j.player_external_id,
              nombre: j.player_name,
              resultado: Number(j.resultado),
              rake: Number(j.rake),
              rakeback,
              cierre: Math.round((Number(j.resultado) + rakeback) * 10000) / 10000,
            };
          });
        const { closing_id, ...resto } = a;
        return { ...resto, jugadores_detalle };
      });
      salida.push({
        id: l.id,
        tipo: l.tipo,
        notes: l.tipo === "AJUSTE" ? l.notes : null,
        club_name: l.club_name,
        agent_name: l.agent_name,
        resultado_total: l.resultado_total,
        rake_total: l.rake_total,
        rakeback_pct: l.rakeback_pct,
        club_rebate: l.club_rebate,
        impacto_rodeo: l.impacto_rodeo,
        monto_crudo: l.monto_crudo,
        monto_aplicado: l.monto_aplicado,
        wc_result: l.wc_result,
        wc_rake_total: l.wc_rake_total,
        wc_rakeback_pct: l.wc_rakeback_pct,
        wc_rodeo: l.wc_rodeo,
        agentes,
      });
    }
    res.json({ cierre: cab.rows[0], lineas: salida });
  } catch (err: any) {
    console.error("Error en /portal/mi-proveedor/cierres/:id/detalle:", err);
    res.status(500).json({ error: err.message || "No se pudo cargar el desglose del cierre." });
  }
});

// ---------------------------------------------------------------------------------------------
// Solicitudes de retiro/pago de un Supervisor (16/10/2026, pedido de Leo: "al supervisor le
// queremos poner botones para que pueda solicitar retiros/pagos y que nos llegue la
// notificacion a nosotros") -- el supervisor solo puede crear y ver LAS SUYAS, siempre atado a
// req.user!.agentId!, nunca a un :id de la URL. El lado admin (listar pendientes de todos,
// marcar como enviada con el link de pago) vive en routes/supervisores.ts.
// ---------------------------------------------------------------------------------------------
const crearSolicitudRetiroSchema = z.object({
  amount: z.number().positive(),
  nota: z.string().nullable().optional(),
});
// Calculadora de cierre (21/10/2026, pedido de Leo): los supervisores y agentes pueden simular un cierre desde su portal, "de la misma manera que
// nosotros liquidamos". Usa la MISMA función del cierre real (engine/cierre.ts calcularCierre, fórmula genérica) pero NO guarda ni toca nada: es
// solo informativa y se puede recalcular cuantas veces quieran. Los porcentajes llegan en % (70 = 70%).
const calculadoraSchema = z.object({
  lineas: z
    .array(
      z.object({
        sistema: z.enum(["PREPAGO", "WIN_LOSE"]),
        resultado: z.number().finite(),
        rake: z.number().finite(),
        rakebackPct: z.number().finite().min(-100).max(100),
        rebatePct: z.number().finite().min(-100).max(100),
        rodeo: z.number().finite().optional(),
        ajuste: z.number().finite().optional(),
      })
    )
    .min(1)
    .max(60),
});
portalRouter.post("/calculadora-cierre", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = calculadoraSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revisá los números: hay un valor inválido." });
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const lineas = parsed.data.lineas.map((l) => {
    const c = calcularCierre({
      agentId: "calculadora",
      clubId: "calculadora",
      system: l.sistema,
      result: l.resultado,
      rakeTotal: l.rake,
      rakebackPct: l.rakebackPct / 100,
      rebatePct: l.rebatePct / 100,
      rodeo: l.rodeo ?? 0,
      ajusteManual: l.ajuste ?? 0,
      rateSnapshot: 1,
    });
    // Mismo reparto que el cierre real: en Prepago el resultado de mesas va a fichas y lo demás (rakeback + rebate + rodeo + ajuste) a cuenta
    // corriente; en Win/Lose el cierre completo va a cuenta corriente.
    const aFichas = l.sistema === "PREPAGO" ? c.result : 0;
    const aCuentaCorriente = l.sistema === "PREPAGO" ? c.finalClosing - c.result : c.finalClosing;
    return {
      rakeback: r2(c.rakeback),
      rebate: r2(c.rebate),
      resultadoAjustado: r2(c.adjustedResult),
      cierreFinal: r2(c.finalClosing),
      aFichas: r2(aFichas),
      aCuentaCorriente: r2(aCuentaCorriente),
    };
  });
  const suma = (k: "rakeback" | "rebate" | "cierreFinal" | "aFichas" | "aCuentaCorriente") => r2(lineas.reduce((s, x) => s + x[k], 0));
  res.json({
    lineas,
    totales: { rakeback: suma("rakeback"), rebate: suma("rebate"), cierreFinal: suma("cierreFinal"), aFichas: suma("aFichas"), aCuentaCorriente: suma("aCuentaCorriente") },
  });
});

portalRouter.post("/mi-supervision/solicitudes-retiro", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.role !== "SUPERVISOR") return res.status(403).json({ error: "Esta cuenta no es de tipo Supervisor." });
  const parsed = crearSolicitudRetiroSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await crearSolicitudRetiroSupervisor(
      req.user!.agentId!,
      parsed.data.amount,
      parsed.data.nota ?? null,
      req.user!.email
    );
    res.status(201).json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

portalRouter.get("/mi-supervision/solicitudes-retiro", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.role !== "SUPERVISOR") return res.status(403).json({ error: "Esta cuenta no es de tipo Supervisor." });
  res.json(await listSolicitudesRetiroSupervisor(req.user!.agentId!));
});

// ---------------------------------------------------------------------------------------------
// Mismo mecanismo de arriba, ahora para Proveedores (16/10/2026, pedido de Leo: "necesito todo
// esto mismo para la sección de proveedores") -- el proveedor solo puede crear y ver LAS SUYAS,
// siempre atado a req.user!.proveedorId, nunca a un :id de la URL. El lado admin (listar
// pendientes de todos, marcar como enviada eligiendo el club + link de pago) vive en
// routes/proveedores.ts.
// ---------------------------------------------------------------------------------------------
const crearSolicitudRetiroProveedorSchema = z.object({
  amount: z.number().positive(),
  nota: z.string().nullable().optional(),
});
portalRouter.post("/mi-proveedor/solicitudes-retiro", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.role !== "PROVEEDOR" || !req.user!.proveedorId) {
    return res.status(403).json({ error: "Esta cuenta no es de tipo Proveedor." });
  }
  const parsed = crearSolicitudRetiroProveedorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await crearSolicitudRetiroProveedor(
      req.user!.proveedorId,
      parsed.data.amount,
      parsed.data.nota ?? null,
      req.user!.email
    );
    res.status(201).json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

portalRouter.get("/mi-proveedor/solicitudes-retiro", requireAuth, async (req: AuthedRequest, res) => {
  if (req.user!.role !== "PROVEEDOR" || !req.user!.proveedorId) {
    return res.status(403).json({ error: "Esta cuenta no es de tipo Proveedor." });
  }
  res.json(await listSolicitudesRetiroProveedor(req.user!.proveedorId));
});
