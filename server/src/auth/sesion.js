import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { marca, reloj } from '../lib/fechas.js';

export const COOKIE = 'bx_sesion';
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Crea una sesión. En la base solo se guarda el hash del token. */
export async function crearSesion(db, usuarioId, ip) {
  const token = randomBytes(32).toString('base64url');
  const ahora = reloj.ahora();
  const expira = new Date(ahora.getTime() + config.horasSesion * 3600e3);
  await db.q('INSERT INTO sesiones (token_hash, usuario_id, creado_en, expira_en, ip) VALUES (?,?,?,?,?)', [sha(token), usuarioId, marca(ahora), marca(expira), ip]);
  return { token, expira };
}

export async function usuarioDeToken(db, token) {
  if (!token) return null;
  const [u] = await db.q(
    `SELECT u.id, u.nombre, u.usuario, u.rol, u.caja_id, u.activo, u.debe_cambiar_password
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira_en > ?`,
    [sha(token), marca()],
  );
  if (!u || !u.activo) return null;
  return { ...u, debe_cambiar_password: !!u.debe_cambiar_password };
}

export const cerrarSesion = (db, token) => db.q('DELETE FROM sesiones WHERE token_hash = ?', [sha(token || '')]);
export const cerrarTodas = (db, usuarioId) => db.q('DELETE FROM sesiones WHERE usuario_id = ?', [usuarioId]);

export function cookieSesion(token, expira) {
  const partes = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Expires=${expira.toUTCString()}`];
  if (config.cookieSegura) partes.push('Secure');
  return partes.join('; ');
}
export const cookieBorrar = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
