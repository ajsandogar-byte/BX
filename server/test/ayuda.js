// Ayudas de prueba: base de datos SQLite en memoria con el mismo esquema que MySQL,
// servidor HTTP real y un cliente que maneja la cookie de sesión.
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sentencias } from '../db/migrar.js';
import { crearApp } from '../src/app.js';
import { cifrar } from '../src/auth/password.js';
import { reloj } from '../src/lib/fechas.js';

const aqui = dirname(fileURLToPath(import.meta.url));

/** Traduce lo poco de MySQL que SQLite no entiende. */
function traducir(sql) {
  return sql
    .replace(/\b(?:BIG)?INT AUTO_INCREMENT PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\s+FOR UPDATE\b/gi, '');
}

export async function crearDbPrueba() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const limpiar = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const q = async (sql, params = []) => {
    const s = raw.prepare(traducir(sql));
    if (/^\s*(SELECT|WITH)\b/i.test(sql)) return s.all(...params.map(limpiar)).map((r) => ({ ...r }));
    const r = s.run(...params.map(limpiar));
    return { insertId: Number(r.lastInsertRowid), affected: r.changes };
  };
  let enTx = false;
  const db = {
    q,
    async tx(fn) {
      if (enTx) throw new Error('Transacción anidada en pruebas');
      enTx = true;
      raw.exec('BEGIN');
      try { const r = await fn({ q }); raw.exec('COMMIT'); return r; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
      finally { enTx = false; }
    },
    cerrar: async () => raw.close(),
    motor: 'sqlite',
  };
  const carpeta = join(aqui, '..', 'db', 'migraciones');
  for (const f of (await readdir(carpeta)).filter((x) => x.endsWith('.sql')).sort()) {
    for (const s of sentencias(await readFile(join(carpeta, f), 'utf8'))) raw.exec(traducir(s));
  }
  return db;
}

/** Fija la hora "actual" de México para las pruebas, ej. fijarHora('2026-10-09T10:00'). */
export function fijarHora(local) {
  reloj.ahora = () => new Date(local + ':00-06:00');
}

export async function crearUsuario(db, { usuario, rol, caja_id = null, password = 'Clave-Segura-123' }) {
  const r = await db.q(
    "INSERT INTO usuarios (nombre, usuario, password_hash, rol, caja_id, activo, debe_cambiar_password, creado_en) VALUES (?,?,?,?,?,1,0,'2026-01-01 00:00:00')",
    [usuario, usuario, await cifrar(password), rol, caja_id],
  );
  return r.insertId;
}

/** Levanta el servidor en un puerto libre. */
export async function arrancar(db) {
  const app = crearApp({ db, log: { error: (...a) => console.error(...a) } });
  await new Promise((ok) => app.listen(0, ok));
  const base = `http://127.0.0.1:${app.address().port}`;
  return { app, base, cerrar: () => new Promise((ok) => app.close(ok)) };
}

/** Cliente HTTP con su propia sesión. */
export function cliente(base) {
  let cookie = '';
  const pedir = async (metodo, ruta, cuerpo) => {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-bx': '1', ...(cookie ? { cookie } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    get: (r) => pedir('GET', r),
    post: (r, c) => pedir('POST', r, c ?? {}),
    patch: (r, c) => pedir('PATCH', r, c ?? {}),
    async entrar(usuario, password = 'Clave-Segura-123') {
      const r = await pedir('POST', '/api/auth/login', { usuario, password });
      if (r.status !== 200) throw new Error('No pudo entrar ' + usuario + ': ' + JSON.stringify(r.data));
      return this;
    },
  };
}
