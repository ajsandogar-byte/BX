// Aplica las migraciones pendientes de db/migraciones en orden.
// Uso: npm run migrar
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const carpeta = join(dirname(fileURLToPath(import.meta.url)), 'migraciones');

/** Separa un archivo SQL en sentencias (quita comentarios de línea). */
export function sentencias(sql) {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}

export async function migrar(db, { log = console.log } = {}) {
  await db.q('CREATE TABLE IF NOT EXISTS schema_migraciones (version VARCHAR(100) PRIMARY KEY, aplicada_en DATETIME NOT NULL)');
  const hechas = new Set((await db.q('SELECT version FROM schema_migraciones')).map((r) => r.version));
  const archivos = (await readdir(carpeta)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    const sql = await readFile(join(carpeta, f), 'utf8');
    // En MySQL los CREATE TABLE no se pueden revertir; si una migración falla a medias, hay que revisarla a mano.
    for (const s of sentencias(sql)) await db.q(s);
    await db.q('INSERT INTO schema_migraciones (version, aplicada_en) VALUES (?, ?)', [f, new Date().toISOString().slice(0, 19).replace('T', ' ')]);
    log(`Migración aplicada: ${f}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { config } = await import('../src/config.js');
  const { crearDbMysql } = await import('../src/db/mysql.js');
  const db = crearDbMysql(config.db);
  try { await migrar(db); console.log('Base de datos al día.'); }
  catch (e) { console.error('Error al migrar:', e.message); process.exitCode = 1; }
  finally { await db.cerrar(); }
}
