import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import {
  getResumenAgentePDF,
  listSemanasConResumenAgente,
  listSaldosActualesAgentes,
  guardarResumenHistorial,
  listResumenesHistorial,
  getResumenHistorialById,
  eliminarResumenHistorial,
  marcarSaldoPendiente,
} from "../repo/agentesResumen.js";
import type { AuthedRequest } from "../lib/auth.js";

export const agentesResumenRouter = Router();

// Semanas con al menos un cierre aplicado, para el selector del PDF.
agentesResumenRouter.get("/semanas", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listSemanasConResumenAgente());
});

// Saldos actuales (01/10/2026, pedido de Leo) -- foto de HOY de todos los agentes activos, ver
// repo/agentesResumen.ts. Separado a propósito del flujo de armar resumen semanal, que no cambia.
// ?fecha=YYYY-MM-DD (01/10/2026, pedido de Leo: "agregar un filtro por fecha e ir reconstruyendo
// los saldos") -- opcional, reconstruye el saldo de cada agente tal como estaba ese día.
agentesResumenRouter.get("/saldos-actuales", requireAuth, requireAdmin, async (req, res) => {
  const fecha = typeof req.query.fecha === "string" && req.query.fecha ? req.query.fecha : undefined;
  res.json(await listSaldosActualesAgentes(fecha));
});

// Resumen completo de un agente para una semana (estado de cuenta + por club + detalle por
// jugador + subagentes) -- ver repo/agentesResumen.ts. 404 si ese agente no tiene ningún cierre
// aplicado esa semana (nada que mostrar).
agentesResumenRouter.get("/:agentId/:weekStart", requireAuth, requireAdmin, async (req, res) => {
  const sistema = req.query.sistema === "PREPAGO" ? "PREPAGO" : "WIN_LOSE";
  const r = await getResumenAgentePDF(req.params.agentId, req.params.weekStart, sistema);
  if (!r) return res.status(404).json({ error: "Este agente no tiene ningún cierre aplicado en esa semana." });
  res.json(r);
});

// Marcar/editar/quitar cuánto de un AJUSTE/COBRO/PAGO sigue "pendiente" (05/10/2026, pedido de
// Leo, soporta pago parcial) -- edición puntual reversible, ver marcarSaldoPendiente en
// repo/agentesResumen.ts. No mueve plata ni balances. restante=null lo saca del todo.
const saldoPendienteSchema = z.object({ restante: z.number().nullable() });
agentesResumenRouter.post("/movimiento/:movementId/saldo-pendiente", requireAuth, requireAdmin, async (req, res) => {
  const body = saldoPendienteSchema.parse(req.body);
  try {
    res.json(await marcarSaldoPendiente(req.params.movementId, body.restante));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo actualizar." });
  }
});

// Historial de resúmenes guardados (30/09/2026, pedido de Leo) -- ver repo/agentesResumen.ts.
const guardarResumenSchema = z.object({
  nombreGrupo: z.string().min(1),
  agentIds: z.array(z.string()).min(1),
  weekStart: z.string(),
  weekEnd: z.string(),
  sistema: z.enum(["WIN_LOSE", "PREPAGO"]),
  data: z.any(),
});

// Guardado AUTOMÁTICO (pedido de Leo: "automatico"): el frontend llama esto apenas termina de
// generar el PDF, sin que el usuario tenga que apretar nada aparte. Best-effort desde el punto
// de vista del frontend -- si esto falla, no debería frenar la descarga del PDF en sí (ver
// ResumenAgentes.tsx).
agentesResumenRouter.post("/historial", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = guardarResumenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  const r = await guardarResumenHistorial({
    nombreGrupo: d.nombreGrupo,
    agentIds: d.agentIds,
    weekStart: d.weekStart,
    weekEnd: d.weekEnd,
    sistema: d.sistema,
    data: d.data,
    createdBy: req.user?.email ?? null,
  });
  res.status(201).json(r);
});

// Filtro de fechas (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD) -- pedido de Leo: "asi de ultima no
// vemos las viejas y evitamos confusiones" mientras se prueba el sistema. Sin filtro, trae todo
// (hasta el LIMIT 500 de listResumenesHistorial).
agentesResumenRouter.get("/historial", requireAuth, requireAdmin, async (req, res) => {
  const desde = typeof req.query.desde === "string" && req.query.desde ? req.query.desde : undefined;
  const hasta = typeof req.query.hasta === "string" && req.query.hasta ? req.query.hasta : undefined;
  res.json(await listResumenesHistorial(desde, hasta));
});

// Trae la foto congelada completa (data) de un resumen guardado, para volver a verlo tal cual
// quedó en su momento -- mismo `preview` que combinarResumen() arma en el frontend.
agentesResumenRouter.get("/historial/:id", requireAuth, requireAdmin, async (req, res) => {
  const r = await getResumenHistorialById(req.params.id);
  if (!r) return res.status(404).json({ error: "No se encontró ese resumen guardado." });
  res.json(r);
});

// Borrado real -- para limpiar pruebas (pedido explícito de Leo, "tiene que tener un boton de
// borrar si o si porque estamos haciendo pruebas"). No tiene ningún efecto en el ledger.
agentesResumenRouter.delete("/historial/:id", requireAuth, requireAdmin, async (req, res) => {
  const ok = await eliminarResumenHistorial(req.params.id);
  if (!ok) return res.status(404).json({ error: "No se encontró ese resumen guardado." });
  res.json({ ok: true });
});
