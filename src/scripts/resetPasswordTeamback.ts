// TeamBack Affiliates V1 (25/09/2026) -- resetea la contraseña de un usuario YA EXISTENTE de
// esta sección (admin o jugador). Hace falta un script aparte de crearAdminTeamback.ts porque
// ese rechaza duplicados (a propósito, para no pisar un usuario sin querer) -- este es
// justamente para cuando SÍ querés pisar la contraseña de uno que ya existe (ej. "admin").
// Uso: npm run reset-password-teamback -- admin "miContraseñaNueva"
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Uso: npm run reset-password-teamback -- <usuario> "<contraseña nueva>"');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("La contraseña debe tener al menos 6 caracteres.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    `UPDATE tb_users SET password_hash = $1 WHERE username = $2 RETURNING username, role, name`,
    [hash, username.trim().toLowerCase()]
  );

  if (r.rows.length === 0) {
    console.error(`No existe ningún usuario de TeamBack Affiliates con el usuario "${username}".`);
    process.exit(1);
  }

  console.log(`✅ Contraseña actualizada para "${r.rows[0].username}" (${r.rows[0].role}, ${r.rows[0].name}).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
