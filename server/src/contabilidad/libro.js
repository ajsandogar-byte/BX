// Libro contable: guarda asientos, mueve existencias de caja y respeta los cortes.
// Todo se llama dentro de una transacción (t).
import { idCuenta, C } from './cuentas.js';
import { verificarCuadre, invertir } from './reglas.js';
import { conflicto, noEncontrado } from '../lib/errores.js';
import { fechaOperacionBase, marca, sumarDias } from '../lib/fechas.js';
import { aPesos, costoSalida } from '../lib/dinero.js';
import { bitacora } from '../lib/bitacora.js';

/** Última fecha cerrada por corte de una caja (o null). */
export async function ultimoCorte(t, cajaId) {
  const [r] = await t.q("SELECT MAX(fecha) AS f FROM cortes WHERE caja_id = ? AND estado = 'cerrado'", [cajaId]);
  return r && r.f ? String(r.f).slice(0, 10) : null;
}

/** Fecha de operación para una o varias cajas: hoy (o mañana después del corte) y siempre después del último corte. */
export async function fechaParaCajas(t, cajaIds, ahora) {
  let f = fechaOperacionBase(ahora);
  for (const id of cajaIds) {
    const uc = await ultimoCorte(t, id);
    if (uc && f <= uc) f = sumarDias(uc, 1);
  }
  return f;
}

/** Bloquea las cajas (en orden de id) hasta que termine la transacción. */
export async function bloquearCajas(t, ids) {
  const lista = [...new Set(ids.filter(Boolean))].sort((a, b) => a - b);
  if (lista.length) await t.q(`SELECT id FROM cajas WHERE id IN (${lista.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, lista);
}

/** Existencia de una caja en una moneda, bloqueada hasta que termine la transacción. */
export async function leerInventario(t, cajaId, moneda) {
  let [r] = await t.q('SELECT cantidad, costo FROM inventario WHERE caja_id = ? AND moneda = ? FOR UPDATE', [cajaId, moneda]);
  if (!r) {
    await t.q('INSERT INTO inventario (caja_id, moneda, cantidad, costo) VALUES (?,?,0,0)', [cajaId, moneda]);
    [r] = await t.q('SELECT cantidad, costo FROM inventario WHERE caja_id = ? AND moneda = ? FOR UPDATE', [cajaId, moneda]);
  }
  return { cantidad: Number(r.cantidad), costo: Number(r.costo) };
}

const fmtCant = (c, m) => `${m} ${aPesos(c).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;

/**
 * Registra un asiento.
 * op: { tipo, fecha, cajaId, cajaDestinoId, clienteId, proveedorId, usuarioId, referencia, concepto, datos, cancelaA, ip }
 * asiento: { partidas, inventario } (ver reglas.js)
 */
export async function registrar(t, op, asiento) {
  verificarCuadre(asiento.partidas);
  if (!asiento.partidas.some((x) => x.monto !== 0)) throw conflicto('La operación no tiene importe.');

  // Candado de las cajas involucradas (en orden, para no trabarse) antes de revisar sus cortes:
  // así un corte y una operación de la misma caja nunca se cruzan.
  const cajas = [...new Set([op.cajaId, op.cajaDestinoId, ...asiento.inventario.map((x) => x.caja_id)].filter(Boolean))].sort((a, b) => a - b);
  await bloquearCajas(t, cajas);
  // Ninguna caja involucrada puede tener cerrado ese día.
  for (const id of cajas) {
    const uc = await ultimoCorte(t, id);
    if (uc && op.fecha <= uc) throw conflicto(`La caja ya tiene corte del ${uc}. Usa una fecha posterior o pide que se reabra el día.`);
  }

  // Existencias: se agrupan por caja y moneda y no pueden quedar en negativo.
  const deltas = new Map();
  for (const x of asiento.inventario) {
    const k = `${x.caja_id}|${x.moneda}`;
    const d = deltas.get(k) || { caja_id: x.caja_id, moneda: x.moneda, cantidad: 0, costo: 0 };
    d.cantidad += x.cantidad; d.costo += x.costo;
    deltas.set(k, d);
  }
  for (const d of [...deltas.values()].sort((a, b) => a.caja_id - b.caja_id || a.moneda.localeCompare(b.moneda))) {
    const actual = await leerInventario(t, d.caja_id, d.moneda);
    const nueva = actual.cantidad + d.cantidad;
    if (nueva < 0) {
      const [c] = await t.q('SELECT nombre FROM cajas WHERE id = ?', [d.caja_id]);
      throw conflicto(`No alcanza: en ${c ? c.nombre : 'la caja'} hay ${fmtCant(actual.cantidad, d.moneda)}.`);
    }
    await t.q('UPDATE inventario SET cantidad = ?, costo = ? WHERE caja_id = ? AND moneda = ?', [nueva, actual.costo + d.costo, d.caja_id, d.moneda]);
  }

  const datos = { ...(op.datos || {}), inventario: asiento.inventario };
  const r = await t.q(
    `INSERT INTO asientos (tipo, fecha_operacion, caja_id, caja_destino_id, cliente_id, proveedor_id, usuario_id, referencia, concepto, datos, cancela_a, creado_en)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [op.tipo, op.fecha, op.cajaId ?? null, op.cajaDestinoId ?? null, op.clienteId ?? null, op.proveedorId ?? null, op.usuarioId,
      op.referencia || null, op.concepto || null, JSON.stringify(datos), op.cancelaA ?? null, marca()],
  );
  const asientoId = r.insertId;
  const cache = new Map();
  for (const x of asiento.partidas) {
    if (x.monto === 0) continue;
    const cuentaId = x.cuenta_id ?? (await idCuenta(t, x.cuenta, cache));
    await t.q('INSERT INTO partidas (asiento_id, cuenta_id, moneda, monto) VALUES (?,?,?,?)', [asientoId, cuentaId, x.moneda, x.monto]);
  }
  await bitacora(t, { usuarioId: op.usuarioId, accion: op.cancelaA ? 'cancelar' : `registrar:${op.tipo}`, entidad: 'asiento', entidadId: asientoId, detalle: { fecha: op.fecha, referencia: op.referencia, cancela_a: op.cancelaA }, ip: op.ip });
  return asientoId;
}

/** Lee un asiento con sus partidas. */
export async function leerAsiento(t, id, bloquear = false) {
  const [a] = await t.q(`SELECT * FROM asientos WHERE id = ?${bloquear ? ' FOR UPDATE' : ''}`, [id]);
  if (!a) throw noEncontrado('No existe esa operación.');
  const partidas = await t.q('SELECT p.cuenta_id, p.moneda, p.monto, c.codigo FROM partidas p JOIN cuentas c ON c.id = p.cuenta_id WHERE p.asiento_id = ?', [id]);
  return { ...a, datos: a.datos ? JSON.parse(a.datos) : {}, partidas: partidas.map((x) => ({ ...x, monto: Number(x.monto) })) };
}

/** Cancela una operación con un asiento contrario fechado en el día de operación actual. */
export async function cancelar(t, asientoId, { usuarioId, motivo, ip, fecha: fechaForzada }) {
  const a = await leerAsiento(t, asientoId, true);
  if (a.cancela_a) throw conflicto('Esta operación ya es una cancelación.');
  if (a.cancelado_por) throw conflicto('Esta operación ya estaba cancelada.');
  const cajas = [...new Set([a.caja_id, a.caja_destino_id, ...(a.datos.inventario || []).map((x) => x.caja_id)].filter(Boolean))];
  const fecha = fechaForzada || (await fechaParaCajas(t, cajas));
  await bloquearCajas(t, cajas);
  const contrario = invertir({
    partidas: a.partidas.map((x) => ({ cuenta_id: x.cuenta_id, cuenta: { codigo: x.codigo }, moneda: x.moneda, monto: x.monto })),
    inventario: a.datos.inventario || [],
  });
  // Si al cancelar sale divisa de una caja (ej. cancelar una compra), sale a su costo promedio ACTUAL,
  // no al original; la diferencia es utilidad (o pérdida) cambiaria. Así el costo promedio nunca queda chueco.
  for (const d of contrario.inventario) {
    if (d.moneda === 'MXN' || d.cantidad >= 0) continue;
    const inv = await leerInventario(t, d.caja_id, d.moneda);
    const costoActual = -costoSalida(Math.min(-d.cantidad, inv.cantidad), inv.cantidad, inv.costo);
    const dif = costoActual - d.costo;
    if (!dif) continue;
    const contra = contrario.partidas.find((x) => x.cuenta.codigo === `CONTRA:${d.caja_id}:${d.moneda}`);
    if (!contra) continue;
    contra.monto += dif;
    contrario.partidas.push({ cuenta: C.utilidadCambiaria(), moneda: 'MXN', monto: -dif });
    d.costo = costoActual;
  }
  const id = await registrar(t, {
    tipo: a.tipo, fecha, cajaId: a.caja_id, cajaDestinoId: a.caja_destino_id, clienteId: a.cliente_id, proveedorId: a.proveedor_id,
    usuarioId, referencia: a.referencia, concepto: `Cancelación: ${motivo}`, datos: { motivo }, cancelaA: a.id, ip,
  }, contrario);
  await t.q('UPDATE asientos SET cancelado_por = ?, motivo_cancelacion = ? WHERE id = ?', [id, motivo, a.id]);
  return { id, fecha, original: a };
}
