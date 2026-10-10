import { cifrar, verificar, validarNueva, temporal } from '../auth/password.js';
import { crearSesion, cerrarTodas } from '../auth/sesion.js';
import { ROLES } from '../auth/permisos.js';
import { ErrorApp, noValido, noEncontrado, conflicto } from '../lib/errores.js';
import { bitacora } from '../lib/bitacora.js';
import { marca } from '../lib/fechas.js';

// Freno a intentos de contraseña: 5 fallos seguidos bloquean 15 minutos por usuario.
const intentos = new Map();
const BLOQUEO_MS = 15 * 60e3;

export async function login(db, { usuario, password }, ip) {
  const clave = String(usuario || '').toLowerCase().trim();
  const reg = intentos.get(clave);
  if (reg && reg.fallos >= 5 && Date.now() - reg.ultimo < BLOQUEO_MS) {
    throw new ErrorApp(429, 'Demasiados intentos. Espera 15 minutos o pide a un administrador que revise tu cuenta.');
  }
  const [u] = await db.q('SELECT id, password_hash, activo FROM usuarios WHERE usuario = ?', [clave]);
  const ok = u && u.activo && (await verificar(String(password || ''), u.password_hash));
  if (!ok) {
    intentos.set(clave, { fallos: (reg?.fallos || 0) + 1, ultimo: Date.now() });
    await bitacora(db, { usuarioId: u?.id ?? null, accion: 'login_fallido', detalle: { usuario: clave }, ip });
    throw new ErrorApp(401, 'Usuario o contraseña incorrectos.', 'credenciales');
  }
  intentos.delete(clave);
  await db.q('UPDATE usuarios SET ultimo_acceso = ? WHERE id = ?', [marca(), u.id]);
  await bitacora(db, { usuarioId: u.id, accion: 'login', ip });
  return crearSesion(db, u.id, ip);
}

export async function cambiarPropia(db, usuario, { actual, nueva }, ip) {
  const [u] = await db.q('SELECT password_hash FROM usuarios WHERE id = ?', [usuario.id]);
  if (!(await verificar(String(actual || ''), u.password_hash))) throw noValido('La contraseña actual no es correcta.');
  const err = validarNueva(nueva);
  if (err) throw noValido(err);
  if (actual === nueva) throw noValido('La nueva contraseña debe ser distinta a la actual.');
  await db.q('UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?', [await cifrar(nueva), usuario.id]);
  await bitacora(db, { usuarioId: usuario.id, accion: 'cambiar_password', ip });
}

export async function listar(db) {
  return db.q(`SELECT u.id, u.nombre, u.usuario, u.rol, u.caja_id, c.nombre AS caja, u.activo, u.debe_cambiar_password, u.ultimo_acceso
                 FROM usuarios u LEFT JOIN cajas c ON c.id = u.caja_id ORDER BY u.activo DESC, u.nombre`);
}

async function validarRolCaja(t, rol, cajaId) {
  if (!ROLES[rol]) throw noValido('Rol no válido.');
  if (rol === 'cajero') {
    if (!cajaId) throw noValido('Un cajero necesita una caja asignada.');
    const [c] = await t.q('SELECT id FROM cajas WHERE id = ? AND activa = 1', [cajaId]);
    if (!c) throw noValido('Esa caja no existe o no está activa.');
    return cajaId;
  }
  return null;
}

async function quedaOtroAdmin(t, exceptoId) {
  const [r] = await t.q("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?", [exceptoId]);
  return Number(r.n) > 0;
}

/** Alta de usuario. Devuelve la contraseña temporal (se muestra una sola vez). */
export async function crear(db, actor, { nombre, usuario, rol, caja_id }, ip) {
  return db.tx(async (t) => {
    const clave = String(usuario).toLowerCase().trim();
    const [existe] = await t.q('SELECT id FROM usuarios WHERE usuario = ?', [clave]);
    if (existe) throw conflicto('Ya existe un usuario con ese nombre de acceso.');
    const caja = await validarRolCaja(t, rol, caja_id);
    const pass = temporal();
    const r = await t.q(
      'INSERT INTO usuarios (nombre, usuario, password_hash, rol, caja_id, activo, debe_cambiar_password, creado_en) VALUES (?,?,?,?,?,1,1,?)',
      [nombre.trim(), clave, await cifrar(pass), rol, caja, marca()],
    );
    await bitacora(t, { usuarioId: actor.id, accion: 'crear_usuario', entidad: 'usuario', entidadId: r.insertId, detalle: { usuario: clave, rol, caja_id: caja }, ip });
    return { id: r.insertId, passwordTemporal: pass };
  });
}

export async function actualizar(db, actor, id, cambios, ip) {
  return db.tx(async (t) => {
    const [u] = await t.q('SELECT * FROM usuarios WHERE id = ?', [id]);
    if (!u) throw noEncontrado('No existe ese usuario.');
    const rol = cambios.rol ?? u.rol;
    const activo = cambios.activo ?? !!u.activo;
    const caja = await validarRolCaja(t, rol, cambios.caja_id !== undefined ? cambios.caja_id : u.caja_id);
    if (u.rol === 'admin' && u.activo && (rol !== 'admin' || !activo) && !(await quedaOtroAdmin(t, id))) {
      throw conflicto('Debe quedar al menos un administrador activo.');
    }
    if (id === actor.id && !activo) throw conflicto('No puedes desactivar tu propio usuario.');
    await t.q('UPDATE usuarios SET nombre = ?, rol = ?, caja_id = ?, activo = ? WHERE id = ?', [cambios.nombre?.trim() || u.nombre, rol, caja, activo ? 1 : 0, id]);
    // Si cambia el rol, la caja o se desactiva, se cierran sus sesiones para que entre con los permisos nuevos.
    if (rol !== u.rol || caja !== u.caja_id || !activo) await cerrarTodas(t, id);
    await bitacora(t, { usuarioId: actor.id, accion: 'actualizar_usuario', entidad: 'usuario', entidadId: id, detalle: { antes: { rol: u.rol, caja_id: u.caja_id, activo: !!u.activo }, despues: { rol, caja_id: caja, activo } }, ip });
  });
}

export async function restablecer(db, actor, id, ip) {
  const [u] = await db.q('SELECT id FROM usuarios WHERE id = ?', [id]);
  if (!u) throw noEncontrado('No existe ese usuario.');
  const pass = temporal();
  await db.q('UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1 WHERE id = ?', [await cifrar(pass), id]);
  await cerrarTodas(db, id);
  await bitacora(db, { usuarioId: actor.id, accion: 'restablecer_password', entidad: 'usuario', entidadId: id, ip });
  return { passwordTemporal: pass };
}
