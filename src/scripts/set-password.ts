// Script de uso local: setea (o resetea) la contraseña de un usuario existente.
// Uso: npm run set-password -- admin@digiplayers.local "miContraseñaSegura"
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Uso: npm run set-password -- <email> "<contraseña>"');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("La contraseña debe tener al menos 6 caracteres.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    `UPDATE agent_users SET password_hash = $1 WHERE email = $2 RETURNING email, role`,
    [hash, email]
  );

  if (r.rows.length === 0) {
    console.error(`No existe ningún usuario con email ${email}.`);
    process.exit(1);
  }

  console.log(`✅ Contraseña actualizada para ${r.rows[0].email} (rol ${r.rows[0].role}).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
