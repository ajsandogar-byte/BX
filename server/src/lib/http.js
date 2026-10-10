// Enrutador HTTP mínimo sobre node:http (sin dependencias).
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { ErrorApp } from './errores.js';

const LIMITE_CUERPO = 5 * 1024 * 1024;

export function crearRouter() {
  const rutas = [];
  const agregar = (metodo) => (patron, handler) => {
    const claves = [];
    const re = new RegExp('^' + patron.replace(/:([a-zA-Z_]+)/g, (_, k) => { claves.push(k); return '([^/]+)'; }) + '/?$');
    rutas.push({ metodo, re, claves, handler });
  };
  return {
    get: agregar('GET'), post: agregar('POST'), patch: agregar('PATCH'), delete: agregar('DELETE'),
    buscar(metodo, ruta) {
      let rutaExiste = false;
      for (const r of rutas) {
        const m = r.re.exec(ruta);
        if (!m) continue;
        rutaExiste = true;
        if (r.metodo !== metodo) continue;
        const params = Object.fromEntries(r.claves.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        return { handler: r.handler, params };
      }
      return rutaExiste ? { metodoNoPermitido: true } : null;
    },
  };
}

export function leerCookies(req) {
  const out = {};
  for (const par of (req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) { try { out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim()); } catch { /* cookie ilegible: se ignora */ } }
  }
  return out;
}

export async function leerCuerpo(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  let total = 0;
  const trozos = [];
  for await (const c of req) {
    total += c.length;
    if (total > LIMITE_CUERPO) throw new ErrorApp(413, 'La información enviada es demasiado grande.');
    trozos.push(c);
  }
  if (!trozos.length) return {};
  try { return JSON.parse(Buffer.concat(trozos).toString('utf8')); }
  catch { throw new ErrorApp(400, 'La información enviada no es JSON válido.'); }
}

export function enviarJson(res, status, data, cabeceras = {}) {
  const cuerpo = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...cabeceras,
  });
  res.end(cuerpo);
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

/** Sirve la aplicación web ya compilada; cualquier ruta desconocida devuelve index.html. */
export async function servirEstatico(res, carpeta, ruta) {
  const limpia = normalize(ruta).replace(/^(\.\.[/\\])+/, '');
  let archivo = join(carpeta, limpia);
  if (!archivo.startsWith(carpeta)) archivo = join(carpeta, 'index.html');
  try { if (!(await stat(archivo)).isFile()) archivo = join(carpeta, 'index.html'); }
  catch { archivo = join(carpeta, 'index.html'); }
  try {
    const datos = await readFile(archivo);
    const esIndex = archivo.endsWith('index.html');
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream',
      'Cache-Control': esIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    res.end(datos);
  } catch {
    res.writeHead(404); res.end('No encontrado');
  }
}
