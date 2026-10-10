import mysql from 'mysql2/promise';

const limpiar = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const normalizar = (r) => (Array.isArray(r) ? r : { insertId: Number(r.insertId), affected: r.affectedRows });

/**
 * Acceso a MySQL con la misma interfaz que usan los servicios:
 *   db.q(sql, params)  -> filas (SELECT) o { insertId, affected }
 *   db.tx(async t => …) -> transacción; si algo falla, se revierte todo.
 */
export function crearDbMysql(cfg) {
  const pool = mysql.createPool({
    ...cfg,
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    timezone: 'Z',
    connectionLimit: 10,
  });
  const hacerQ = (conn) => async (sql, params = []) => {
    const [r] = await conn.query(sql, params.map(limpiar));
    return normalizar(r);
  };
  async function tx(fn, intento = 1) {
    const conn = await pool.getConnection();
    let error = null, r;
    try {
      // READ COMMITTED: cada lectura ve lo último confirmado (los candados FOR UPDATE ordenan lo demás).
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      r = await fn({ q: hacerQ(conn) });
      await conn.commit();
    } catch (e) {
      error = e;
      await conn.rollback().catch(() => {});
    } finally {
      conn.release();
    }
    if (!error) return r;
    // Dos operaciones chocaron sobre la misma caja: se reintenta.
    if (error.code === 'ER_LOCK_DEADLOCK' && intento < 3) return tx(fn, intento + 1);
    throw error;
  }
  return { q: hacerQ(pool), tx, cerrar: () => pool.end(), motor: 'mysql' };
}
