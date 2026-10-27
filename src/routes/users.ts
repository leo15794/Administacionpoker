import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool, newId } from "../db/pool.js";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { eliminarMovimientoReferido } from "../repo/supervisorReferidos.js";
import { asegurarSchemaSocios } from "../repo/socios.js";

export const usersRouter = Router();

// Antes de la migración la columna partner_account_id puede no existir: solo se toca si ya está.
async function colSocioExiste() {
  const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, ["agent_users", "partner_account_id"]);
  return r.rows.length > 0;
}

// Listado de usuarios de acceso (para el panel de administración de usuarios). Un mismo login
// puede tener varios agentes/clubes asociados (agent_user_agents) — se traen todos agregados
// para que la tabla muestre "TeamBack Suprema, Fénix GG" en vez de un solo nombre.
usersRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  await asegurarSchemaSocios();
  // LEFT JOIN a los dos (16/10/2026, rol PROVEEDOR): un login ahora puede colgar de un agente
  // O de un proveedor -- con INNER JOIN de antes, un usuario PROVEEDOR (agent_id NULL) hubiera
  // desaparecido entero de este listado.
  const r = await pool.query(
    `SELECT u.id, u.email, u.role, u.active, u.created_at, u.agent_id, u.proveedor_id, u.partner_account_id,
            p.name as proveedor_name, pa.name as socio_name,
            COALESCE(
              (SELECT json_agg(json_build_object('id', a2.id, 'name', a2.name) ORDER BY a2.name)
               FROM agent_user_agents uax JOIN agents a2 ON a2.id = uax.agent_id
               WHERE uax.user_id = u.id),
              CASE WHEN a.id IS NOT NULL THEN json_build_array(json_build_object('id', a.id, 'name', a.name)) ELSE '[]'::json END
            ) as agentes
     FROM agent_users u
     LEFT JOIN agents a ON a.id = u.agent_id
     LEFT JOIN proveedores p ON p.id = u.proveedor_id
     LEFT JOIN partner_accounts pa ON pa.id = u.partner_account_id
     ORDER BY u.created_at DESC`
  );
  res.json(r.rows);
});

// Usuario/login: ya no se exige formato de email — puede ser un email real o un nombre de
// usuario simple (ej. "juan123"), solo tiene que ser único (ver índice UNIQUE en agent_users.email).
const usuarioField = z.string().trim().min(3, "Mínimo 3 caracteres.");

// Rol PROVEEDOR (16/10/2026, pedido de Leo: "agregarlos como usuarios y darles los permisos
// como hacemos con los supervisores") -- un login de PROVEEDOR cuelga de proveedorId en vez de
// agentIds/defaultAgentId (son dos formas mutuamente excluyentes de identidad para el mismo
// login, ver el superRefine de abajo).
const createSchema = z
  .object({
    role: z.enum(["ADMIN", "AGENT", "SUPERVISOR", "PROVEEDOR", "SOCIO"]),
    email: usuarioField,
    password: z.string().min(6),
    agentIds: z.array(z.string()).optional(),
    // Cuenta de acceso por defecto (la que usa el login/JWT al entrar): elegida explícitamente
    // por el admin, no "la primera que se tildó" — para un login con varios agentes, todos
    // pesan igual en el selector de arriba, esto es una decisión aparte.
    defaultAgentId: z.string().optional(),
    proveedorId: z.string().optional(),
    partnerAccountId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "SOCIO") {
      if (!data.partnerAccountId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Elegí la cuenta de socio.", path: ["partnerAccountId"] });
      }
    } else if (data.role === "PROVEEDOR") {
      if (!data.proveedorId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Elegí un proveedor.", path: ["proveedorId"] });
      }
    } else {
      if (!data.agentIds || data.agentIds.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Elegí al menos un agente.", path: ["agentIds"] });
      }
      if (!data.defaultAgentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Falta la cuenta de acceso por defecto.", path: ["defaultAgentId"] });
      }
    }
  });
usersRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { role, agentIds, defaultAgentId, proveedorId, partnerAccountId, email, password } = parsed.data;
  if (role === "SOCIO") await asegurarSchemaSocios();
  if (role !== "PROVEEDOR" && role !== "SOCIO" && agentIds && defaultAgentId && !agentIds.includes(defaultAgentId)) {
    return res.status(400).json({ error: "La cuenta de acceso por defecto tiene que ser uno de los agentes tildados." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hash = await bcrypt.hash(password, 10);
    const id = newId("user");
    if (role === "SOCIO") {
      await client.query(
        `INSERT INTO agent_users (id, agent_id, partner_account_id, email, password_hash, role) VALUES ($1,NULL,$2,$3,$4,$5)`,
        [id, partnerAccountId, email, hash, role]
      );
    } else if (role === "PROVEEDOR") {
      await client.query(
        `INSERT INTO agent_users (id, agent_id, proveedor_id, email, password_hash, role) VALUES ($1,NULL,$2,$3,$4,$5)`,
        [id, proveedorId, email, hash, role]
      );
    } else {
      await client.query(
        `INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)`,
        [id, defaultAgentId, email, hash, role]
      );
      for (const agentId of agentIds!) {
        await client.query(
          `INSERT INTO agent_user_agents (user_id, agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [id, agentId]
        );
      }
    }
    await client.query("COMMIT");
    res.status(201).json({ id, email, role });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Ese usuario ya existe." });
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

const updateSchema = z.object({
  email: usuarioField.optional(),
  role: z.enum(["ADMIN", "AGENT", "SUPERVISOR", "PROVEEDOR", "SOCIO"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
  agentIds: z.array(z.string()).min(1).optional(),
  // Cuenta de acceso por defecto: si se manda agentIds, hay que decir cuál de esos usar como
  // agent_id — ya no se infiere "la primera tildada" (todas pesan igual en ese selector).
  defaultAgentId: z.string().min(1).optional(),
  // Rol PROVEEDOR (16/10/2026) -- mutuamente excluyente con defaultAgentId, ver abajo.
  proveedorId: z.string().min(1).optional(),
  // Rol SOCIO (27/10/2026) -- mutuamente excluyente con defaultAgentId y proveedorId.
  partnerAccountId: z.string().min(1).optional(),
});
usersRouter.patch("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, role, active, password, agentIds, defaultAgentId, proveedorId, partnerAccountId } = parsed.data;
  if (role === "SOCIO" || partnerAccountId !== undefined) await asegurarSchemaSocios();

  // Nunca dejar que un admin se saque su propio acceso por error (quedaría el sistema sin admin).
  if (req.params.id === req.user?.userId && (active === false || role === "AGENT")) {
    return res.status(400).json({ error: "No podés quitarte tu propio acceso de administrador." });
  }

  if (agentIds !== undefined) {
    if (!defaultAgentId) {
      return res.status(400).json({ error: "Falta indicar la cuenta de acceso por defecto." });
    }
    if (!agentIds.includes(defaultAgentId)) {
      return res.status(400).json({ error: "La cuenta de acceso por defecto tiene que ser uno de los agentes tildados." });
    }
  }

  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (email !== undefined) {
    sets.push(`email = $${i++}`);
    values.push(email);
  }
  if (role !== undefined) {
    sets.push(`role = $${i++}`);
    values.push(role);
  }
  if (active !== undefined) {
    sets.push(`active = $${i++}`);
    values.push(active);
  }
  if (password !== undefined) {
    sets.push(`password_hash = $${i++}`);
    values.push(await bcrypt.hash(password, 10));
  }
  if (defaultAgentId !== undefined) {
    sets.push(`agent_id = $${i++}`);
    values.push(defaultAgentId);
    // Mutuamente excluyente con proveedorId (16/10/2026) -- si este login vuelve a ser
    // AGENT/SUPERVISOR/ADMIN, se suelta cualquier proveedor que tuviera colgado de antes.
    sets.push(`proveedor_id = NULL`);
    if (partnerAccountId === undefined && (await colSocioExiste())) sets.push(`partner_account_id = NULL`);
  }
  if (proveedorId !== undefined) {
    sets.push(`proveedor_id = $${i++}`);
    values.push(proveedorId);
    sets.push(`agent_id = NULL`);
  }
  if (partnerAccountId !== undefined) {
    sets.push(`partner_account_id = $${i++}`);
    values.push(partnerAccountId);
    sets.push(`agent_id = NULL`);
    sets.push(`proveedor_id = NULL`);
  }

  if (sets.length === 0 && agentIds === undefined) return res.status(400).json({ error: "Nada para actualizar." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let row;
    if (sets.length > 0) {
      values.push(req.params.id);
      const r = await client.query(
        `UPDATE agent_users SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, email, role, active`,
        values
      );
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Usuario no encontrado." });
      }
      row = r.rows[0];
    } else {
      const r = await client.query(`SELECT id, email, role, active FROM agent_users WHERE id = $1`, [req.params.id]);
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Usuario no encontrado." });
      }
      row = r.rows[0];
    }
    if (agentIds !== undefined) {
      await client.query(`DELETE FROM agent_user_agents WHERE user_id = $1`, [req.params.id]);
      for (const agentId of agentIds) {
        await client.query(
          `INSERT INTO agent_user_agents (user_id, agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.params.id, agentId]
        );
      }
    }
    await client.query("COMMIT");
    res.json(row);
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Ese usuario ya existe." });
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Borrado real de un login de portal. No toca el agente ni su historial de cierres/movimientos
// (eso es del negocio, no del acceso) — solo borra la CUENTA DE ACCESO: agent_user_agents
// (cascada), su configuración de comisiones por referido si era Supervisor (referidos +
// movimientos, cascada manual porque los movimientos no tienen ON DELETE CASCADE — se
// preserva el criterio de no dejar rastros huérfanos), y la fila de agent_users.
usersRouter.delete("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  if (req.params.id === req.user?.userId) {
    return res.status(400).json({ error: "No podés eliminar tu propio usuario." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const check = await client.query(`SELECT id, email FROM agent_users WHERE id = $1`, [req.params.id]);
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado." });
    }
    await client.query(
      `DELETE FROM supervisor_referido_movements WHERE referido_id IN (SELECT id FROM supervisor_referidos WHERE supervisor_user_id = $1)`,
      [req.params.id]
    );
    await client.query(`DELETE FROM supervisor_referidos WHERE supervisor_user_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM agent_users WHERE id = $1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true, email: check.rows[0].email });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// Comisión por referido de supervisor (16/09/2026)
// Cuelga del LOGIN (no de un agente): un supervisor puede tener % configurado sobre el rake
// semanal de un agente que él refirió, auto-acreditado en cada cierre semanal de ese agente
// (ver src/repo/closings.ts) como saldo separado. A propósito NO depende de cuál sea la cuenta
// principal de este login — eso es un tema de permisos/visualización aparte.
// ============================================================

usersRouter.get("/:id/referidos", requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT r.*, a.name as agente_referido_name
     FROM supervisor_referidos r JOIN agents a ON a.id = r.agente_referido_id
     WHERE r.supervisor_user_id = $1 AND r.active = true
     ORDER BY a.name`,
    [req.params.id]
  );
  res.json(r.rows);
});

// Historial detallado: cada acreditación (o corrección) de comisión por referido, con el
// agente y la semana del cierre que la generó — incluye referidos ya desactivados, para que
// el historial no desaparezca si en algún momento se corta la comisión a futuro.
usersRouter.get("/:id/referidos/movimientos", requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT m.*, a.name as agente_referido_name, wc.week_start, wc.week_end
     FROM supervisor_referido_movements m
     JOIN supervisor_referidos r ON r.id = m.referido_id
     JOIN agents a ON a.id = r.agente_referido_id
     LEFT JOIN weekly_closings wc ON wc.id = m.weekly_closing_id
     WHERE r.supervisor_user_id = $1
     ORDER BY m.occurred_at DESC
     LIMIT 300`,
    [req.params.id]
  );
  res.json(r.rows);
});

// Borra UN movimiento puntual del historial de comisión por referido (solo el más reciente de
// ese referido — ver nota en repo/supervisorReferidos.ts) — para corregir una acreditación o un
// pago cargado de más sin tener que pelearse con una corrección a mano.
usersRouter.delete("/referidos/movimientos/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarMovimientoReferido(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo borrar el movimiento." });
  }
});

const crearReferidoSchema = z.object({
  agenteReferidoId: z.string().min(1),
  porcentaje: z.number().gt(0).lte(100),
});
usersRouter.post("/:id/referidos", requireAuth, requireAdmin, async (req, res) => {
  const parsed = crearReferidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { agenteReferidoId, porcentaje } = parsed.data;
  try {
    const id = newId("refsup");
    const r = await pool.query(
      `INSERT INTO supervisor_referidos (id, supervisor_user_id, agente_referido_id, porcentaje)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, req.params.id, agenteReferidoId, porcentaje]
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese agente ya tiene un referidor activo — desactivalo primero si querés cambiarlo de supervisor." });
    }
    res.status(400).json({ error: err.message });
  }
});

const editarReferidoSchema = z.object({
  porcentaje: z.number().gt(0).lte(100).optional(),
  active: z.boolean().optional(),
});
usersRouter.patch("/referidos/:refId", requireAuth, requireAdmin, async (req, res) => {
  const parsed = editarReferidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (parsed.data.porcentaje !== undefined) {
    sets.push(`porcentaje = $${i++}`);
    values.push(parsed.data.porcentaje);
  }
  if (parsed.data.active !== undefined) {
    sets.push(`active = $${i++}`);
    values.push(parsed.data.active);
  }
  if (sets.length === 0) return res.status(400).json({ error: "Nada para actualizar." });
  sets.push(`updated_at = now()`);
  values.push(req.params.refId);
  const r = await pool.query(`UPDATE supervisor_referidos SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
  if (r.rows.length === 0) return res.status(404).json({ error: "No se encontró ese referido." });
  res.json(r.rows[0]);
});
