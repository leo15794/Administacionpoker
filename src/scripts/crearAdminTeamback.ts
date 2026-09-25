// TeamBack Affiliates V1 (25/09/2026) -- crea el PRIMER usuario admin de la sección (o cualquier
// otro admin/jugador a mano si hace falta). Hace falta un script para el primero porque los
// endpoints /teamback/usuarios exigen ya estar logueado como admin de esta sección para crear
// otros -- sin este script no habría forma de entrar la primera vez.
// Uso: npm run crear-admin-teamback -- admin@teamback.local "miContraseñaSegura" "Leo"
import bcrypt from "bcryptjs";
import { pool, newId } from "../db/pool.js";

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error('Uso: npm run crear-admin-teamback -- <email> "<contraseña>" "<nombre>"');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error("La contraseña debe tener al menos 6 caracteres.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const id = newId("tbu");
  try {
    await pool.query(
      `INSERT INTO tb_users (id, role, email, password_hash, name) VALUES ($1,'ADMIN',$2,$3,$4)`,
      [id, email.trim().toLowerCase(), hash, name.trim()]
    );
    console.log(`✅ Admin de TeamBack Affiliates creado: ${email}. Ya podés entrar a la sección con ese email/contraseña.`);
  } catch (err: any) {
    if (err.code === "23505") {
      console.error(`Ya existe un usuario con el email ${email} -- si querés resetearle la contraseña, hacelo desde la propia sección (Usuarios) una vez que puedas entrar con otro admin.`);
      process.exit(1);
    }
    throw err;
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
