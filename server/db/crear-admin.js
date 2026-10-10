// Crea el primer administrador.
// Uso: npm run crear-admin -- --usuario adrian --nombre "Adrián"
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { crearDbMysql } from '../src/db/mysql.js';
import { cifrar, validarNueva } from '../src/auth/password.js';

const { values } = parseArgs({ options: { usuario: { type: 'string' }, nombre: { type: 'string' } } });
if (!values.usuario || !values.nombre) {
  console.error('Uso: npm run crear-admin -- --usuario NOMBRE_DE_ACCESO --nombre "Nombre completo"');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const pass = await rl.question('Contraseña (mínimo 10 caracteres, con letras y números): ');
rl.close();
const err = validarNueva(pass);
if (err) { console.error(err); process.exit(1); }

const db = crearDbMysql(config.db);
try {
  const usuario = values.usuario.toLowerCase().trim();
  const [e] = await db.q('SELECT id FROM usuarios WHERE usuario = ?', [usuario]);
  if (e) throw new Error('Ese usuario ya existe.');
  await db.q(
    "INSERT INTO usuarios (nombre, usuario, password_hash, rol, caja_id, activo, debe_cambiar_password, creado_en) VALUES (?,?,?,'admin',NULL,1,0,?)",
    [values.nombre, usuario, await cifrar(pass), new Date().toISOString().slice(0, 19).replace('T', ' ')],
  );
  console.log(`Administrador "${usuario}" creado. Ya puedes entrar.`);
} catch (e) {
  console.error('No se pudo crear:', e.message);
  process.exitCode = 1;
} finally {
  await db.cerrar();
}
