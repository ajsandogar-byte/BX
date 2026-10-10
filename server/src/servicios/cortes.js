// Corte diario: arqueo por moneda, sobrantes/faltantes, envío a matriz y cierre del día.
import { reglas } from '../contabilidad/reglas.js';
import { registrar, leerInventario, ultimoCorte, bloquearCajas, cancelar } from '../contabilidad/libro.js';
import { cajaConAcceso, exigir } from '../auth/permisos.js';
import { conflicto, noValido, noEncontrado } from '../lib/errores.js';
import { MONEDAS, costoSalida, aPesos } from '../lib/dinero.js';
import { ahoraMx, marca, esFecha } from '../lib/fechas.js';
import { bitacora } from '../lib/bitacora.js';

const MATRIZ_TIPO = 'matriz';

/** Lo que debería haber en caja al final de `fecha`, por moneda (centavos). */
export async function esperadoAl(t, cajaId, fecha) {
  const filas = await t.q(
    `SELECT k.moneda, SUM(p.monto) AS s FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id JOIN asientos a ON a.id = p.asiento_id
      WHERE k.codigo LIKE ? AND a.fecha_operacion <= ? GROUP BY k.moneda`,
    [`CAJA:${cajaId}:%`, fecha],
  );
  const out = Object.fromEntries(MONEDAS.map((m) => [m, 0]));
  for (const f of filas) out[f.moneda] = Number(f.s);
  return out;
}

export async function vistaPrevia(db, usuario, cajaId, fecha) {
  const caja = await cajaConAcceso(db, usuario, cajaId);
  const uc = await ultimoCorte(db, caja.id);
  const esperado = await esperadoAl(db, caja.id, fecha);
  return { caja, fecha, ultimo_corte: uc, cerrado: !!(uc && fecha <= uc), esperado: Object.fromEntries(Object.entries(esperado).map(([m, v]) => [m, aPesos(v)])) };
}

/**
 * d: { fecha, contado: {MXN: centavos, ...}, enviado: {...} (solo sucursales), nota }
 */
export async function hacerCorte(t, usuario, cajaId, d, ip) {
  // Candado primero (caja y matriz, en orden): dos cortes de la misma caja, o un corte y una
  // operación, nunca se cruzan.
  const [mz] = await t.q("SELECT id FROM cajas WHERE tipo = 'matriz' LIMIT 1");
  await bloquearCajas(t, [Number(cajaId), mz.id]);
  const caja = await cajaConAcceso(t, usuario, cajaId);
  if (!esFecha(d.fecha)) throw noValido('Fecha de corte no válida.');
  if (d.fecha > ahoraMx().fecha) throw noValido('No se puede hacer el corte de un día que no ha llegado.');
  const uc = await ultimoCorte(t, caja.id);
  if (uc && d.fecha <= uc) throw conflicto(`Esa fecha ya está cerrada (último corte: ${uc}).`);

  const [matriz] = await t.q("SELECT id FROM cajas WHERE tipo = 'matriz' LIMIT 1");
  const esSucursal = caja.tipo !== MATRIZ_TIPO;
  const esperado = await esperadoAl(t, caja.id, d.fecha);
  const contado = {}, diferencia = {}, enviado = {};
  for (const m of MONEDAS) {
    const c = d.contado?.[m];
    if (!Number.isInteger(c) || c < 0) throw noValido(`Escribe lo contado en ${m}.`);
    const e = esSucursal ? (d.enviado?.[m] ?? 0) : 0;
    if (!Number.isInteger(e) || e < 0) throw noValido(`El envío a matriz en ${m} no es válido.`);
    if (e > c) throw noValido(`No puedes enviar más ${m} de lo contado.`);
    contado[m] = c; diferencia[m] = c - esperado[m]; enviado[m] = e;
  }
  if (esSucursal && Object.values(enviado).some((v) => v > 0)) {
    const ucm = await ultimoCorte(t, matriz.id);
    if (ucm && d.fecha <= ucm) throw conflicto('La matriz ya tiene corte ese día; no puede recibir el envío.');
  }

  const base = { fecha: d.fecha, cajaId: caja.id, usuarioId: usuario.id, ip };
  // 1) Sobrantes y faltantes.
  for (const m of MONEDAS) {
    const dif = diferencia[m];
    if (!dif) continue;
    let costo = 0;
    if (m !== 'MXN') {
      const inv = await leerInventario(t, caja.id, m);
      const prom = inv.cantidad > 0 ? inv.costo / inv.cantidad : 0;
      costo = dif < 0 ? -costoSalida(Math.min(-dif, inv.cantidad), inv.cantidad, inv.costo) : Math.round(dif * prom);
    }
    await registrar(t, { ...base, tipo: 'ajuste_corte', concepto: dif > 0 ? 'Sobrante en corte' : 'Faltante en corte', datos: { moneda: m, diferencia: dif, del_corte: true } },
      reglas.ajusteCorte({ cajaId: caja.id, moneda: m, diferencia: dif, costo }));
  }
  // 2) Envío a matriz.
  for (const m of MONEDAS) {
    const q = enviado[m];
    if (!q) continue;
    let costo = 0;
    if (m !== 'MXN') { const inv = await leerInventario(t, caja.id, m); costo = costoSalida(Math.min(q, inv.cantidad), inv.cantidad, inv.costo); }
    await registrar(t, { ...base, tipo: 'traspaso', cajaDestinoId: matriz.id, concepto: 'Envío a matriz en corte', datos: { moneda: m, cantidad: q, del_corte: true } },
      reglas.traspaso({ origenId: caja.id, destinoId: matriz.id, moneda: m, cantidad: q, costo }));
  }
  // 3) Cierre.
  const r = await t.q(
    `INSERT INTO cortes (caja_id, fecha, estado, esperado, contado, diferencia, enviado, nota, usuario_id, creado_en) VALUES (?,?,'cerrado',?,?,?,?,?,?,?)`,
    [caja.id, d.fecha, JSON.stringify(esperado), JSON.stringify(contado), JSON.stringify(diferencia), JSON.stringify(enviado), d.nota || null, usuario.id, marca()],
  );
  await bitacora(t, { usuarioId: usuario.id, accion: 'corte', entidad: 'caja', entidadId: caja.id, detalle: { fecha: d.fecha, diferencia, enviado }, ip });
  return { id: r.insertId };
}

/** Reabre el último corte de una caja (admin y supervisor). */
export async function reabrir(t, usuario, corteId, motivo, ip) {
  exigir(usuario, 'reabrirCorte');
  const [c] = await t.q('SELECT * FROM cortes WHERE id = ?', [corteId]);
  if (!c) throw noEncontrado('No existe ese corte.');
  await cajaConAcceso(t, usuario, c.caja_id);
  if (c.estado !== 'cerrado') throw conflicto('Ese corte ya estaba reabierto.');
  const uc = await ultimoCorte(t, c.caja_id);
  if (String(c.fecha).slice(0, 10) !== uc) throw conflicto('Solo se puede reabrir el último corte de la caja.');
  if (!motivo || !String(motivo).trim()) throw noValido('Escribe el motivo para reabrir el día.');
  await t.q("UPDATE cortes SET estado = 'reabierto', reabierto_por = ?, reabierto_en = ?, motivo_reapertura = ? WHERE id = ?", [usuario.id, marca(), String(motivo).trim(), c.id]);
  // Se deshacen los sobrantes/faltantes y envíos a matriz de ese corte, con la misma fecha del día reabierto.
  // Así, al volver a hacer el corte, el arqueo parte de cero.
  const fecha = String(c.fecha).slice(0, 10);
  const delCorte = await t.q(
    `SELECT id FROM asientos WHERE caja_id = ? AND fecha_operacion = ? AND cancela_a IS NULL AND cancelado_por IS NULL
       AND tipo IN ('ajuste_corte','traspaso') AND datos LIKE ? ORDER BY id DESC`,
    [c.caja_id, fecha, '%"del_corte":true%'],
  );
  for (const a of delCorte) await cancelar(t, a.id, { usuarioId: usuario.id, motivo: `Reapertura del corte: ${String(motivo).trim()}`, ip, fecha });
  await bitacora(t, { usuarioId: usuario.id, accion: 'reabrir_corte', entidad: 'corte', entidadId: c.id, detalle: { motivo }, ip });
}

export async function listarCortes(db, usuario, cajaId) {
  const caja = await cajaConAcceso(db, usuario, cajaId);
  const filas = await db.q(
    `SELECT c.*, u.nombre AS usuario FROM cortes c JOIN usuarios u ON u.id = c.usuario_id WHERE c.caja_id = ? ORDER BY c.fecha DESC, c.id DESC LIMIT 200`,
    [caja.id],
  );
  const pesos = (o) => Object.fromEntries(Object.entries(JSON.parse(o)).map(([m, v]) => [m, aPesos(v)]));
  return filas.map((c) => ({ id: c.id, fecha: String(c.fecha).slice(0, 10), estado: c.estado, nota: c.nota, usuario: c.usuario, creado_en: c.creado_en,
    esperado: pesos(c.esperado), contado: pesos(c.contado), diferencia: pesos(c.diferencia), enviado: pesos(c.enviado), motivo_reapertura: c.motivo_reapertura }));
}
