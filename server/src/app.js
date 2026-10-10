// Atiende cada petición: sesión, protección CSRF, rutas de la API y la aplicación web.
import { createServer } from 'node:http';
import { crearRutas } from './rutas.js';
import { leerCookies, leerCuerpo, enviarJson, servirEstatico } from './lib/http.js';
import { ErrorApp } from './lib/errores.js';
import { COOKIE, usuarioDeToken, cookieSesion, cookieBorrar, cerrarSesion } from './auth/sesion.js';
import { login } from './servicios/usuarios.js';

/** Crea el servidor. `db` es el acceso a datos (MySQL en producción; SQLite en pruebas). */
export function crearApp({ db, carpetaWeb = null, log = console }) {
  const rutas = crearRutas();

  async function manejar(req, res) {
    const url = new URL(req.url, 'http://local');
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    if (!url.pathname.startsWith('/api/')) {
      if (carpetaWeb && req.method === 'GET') return servirEstatico(res, carpetaWeb, url.pathname);
      return enviarJson(res, 404, { error: 'No encontrado.' });
    }
    // Protección contra peticiones de otros sitios: toda escritura debe traer esta cabecera.
    if (req.method !== 'GET' && req.headers['x-bx'] !== '1') return enviarJson(res, 403, { error: 'Petición no permitida.' });

    const body = await leerCuerpo(req);
    const cookies = leerCookies(req);

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const s = await login(db, body, ip);
      return enviarJson(res, 200, { ok: true }, { 'Set-Cookie': cookieSesion(s.token, s.expira) });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      await cerrarSesion(db, cookies[COOKIE]);
      return enviarJson(res, 200, { ok: true }, { 'Set-Cookie': cookieBorrar() });
    }

    const usuario = await usuarioDeToken(db, cookies[COOKIE]);
    if (!usuario) return enviarJson(res, 401, { error: 'Tu sesión terminó. Vuelve a entrar.', codigo: 'sin_sesion' });
    // Con contraseña temporal solo se puede consultar quién soy y cambiarla.
    if (usuario.debe_cambiar_password && !['/api/auth/yo', '/api/auth/password'].includes(url.pathname)) {
      return enviarJson(res, 403, { error: 'Primero cambia tu contraseña temporal.', codigo: 'cambiar_password' });
    }

    const r = rutas.buscar(req.method, url.pathname);
    if (!r) return enviarJson(res, 404, { error: 'Ruta no encontrada.' });
    if (r.metodoNoPermitido) return enviarJson(res, 405, { error: 'Método no permitido.' });
    const query = Object.fromEntries(url.searchParams);
    const data = await r.handler({ req, res, db, usuario, body, query, params: r.params, ip });
    return enviarJson(res, 200, data ?? { ok: true });
  }

  return createServer(async (req, res) => {
    try {
      await manejar(req, res);
    } catch (e) {
      if (e instanceof ErrorApp) return enviarJson(res, e.status, { error: e.message, codigo: e.codigo });
      log.error('[error]', req.method, req.url, e);
      if (!res.headersSent) enviarJson(res, 500, { error: 'Ocurrió un error en el servidor. Intenta de nuevo; si sigue pasando, avisa al administrador.' });
    }
  });
}
