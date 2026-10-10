// Operaciones de caja: compra/venta de divisas, entradas, salidas, gastos, traspasos y saldos iniciales.
import { reglas } from '../contabilidad/reglas.js';
import { registrar, leerInventario, fechaParaCajas, ultimoCorte } from '../contabilidad/libro.js';
import { cajaConAcceso } from '../auth/permisos.js';
import { noValido, sinAcceso } from '../lib/errores.js';
import { MONEDAS, contravalor, costoSalida, aPesos } from '../lib/dinero.js';
import { fechaOperacionBase } from '../lib/fechas.js';

const TIPOS = ['compra', 'venta', 'entrada', 'salida', 'gasto', 'traspaso', 'retiro_utilidad', 'saldo_inicial'];

/**
 * d: { tipo, moneda, cantidad (centavos), tc?, categoria?, destino_id?, cliente_id?, proveedor_id?, referencia?, concepto?, fecha? }
 * Solo el administrador puede elegir fecha; para los demás la fija el servidor (hoy, o mañana después del corte).
 */
export async function movimientoCaja(t, usuario, cajaId, d, ip) {
  if (!TIPOS.includes(d.tipo)) throw noValido('Tipo de movimiento no válido.');
  if (!MONEDAS.includes(d.moneda)) throw noValido('Moneda no válida.');
  if (!Number.isInteger(d.cantidad) || d.cantidad === 0) throw noValido('Escribe un monto válido.');
  if (d.tipo !== 'saldo_inicial' && d.cantidad < 0) throw noValido('Escribe el monto en positivo; el tipo ya indica si entra o sale.');
  const caja = await cajaConAcceso(t, usuario, cajaId);
  if (!caja.activa) throw noValido('Esta caja está desactivada.');
  if ((d.tipo === 'saldo_inicial' || d.tipo === 'retiro_utilidad') && usuario.rol !== 'admin') throw sinAcceso('Solo un administrador puede registrar esto.');

  let destino = null;
  if (d.tipo === 'traspaso') {
    [destino] = await t.q('SELECT id, nombre, tipo, activa FROM cajas WHERE id = ?', [d.destino_id]);
    if (!destino || !destino.activa) throw noValido('La caja destino no existe o está desactivada.');
    if (destino.id === caja.id) throw noValido('La caja destino debe ser distinta.');
  }
  const cajas = [caja.id, destino?.id].filter(Boolean);
  let fecha;
  if (d.fecha && usuario.rol === 'admin') fecha = d.fecha;
  else fecha = await fechaParaCajas(t, cajas);

  const q = d.cantidad, mon = d.moneda, esDivisa = mon !== 'MXN';
  const tc = d.tc != null ? Number(d.tc) : null;
  const op = { fecha, cajaId: caja.id, usuarioId: usuario.id, referencia: d.referencia, concepto: d.concepto, ip, datos: { moneda: mon, cantidad: q } };
  let asiento, resumen = {};

  // Costo promedio actual de la divisa en esta caja (la fila queda bloqueada hasta terminar).
  const costoDe = async (cantidad) => {
    if (!esDivisa) return 0;
    const inv = await leerInventario(t, caja.id, mon);
    return costoSalida(Math.min(cantidad, inv.cantidad), inv.cantidad, inv.costo);
  };

  switch (d.tipo) {
    case 'compra': case 'venta': {
      if (!esDivisa) throw noValido('Elige la divisa que se compra o se vende.');
      if (!(tc > 0)) throw noValido('Escribe el tipo de cambio.');
      const mxn = contravalor(q, tc);
      if (d.tipo === 'compra') asiento = reglas.compra({ cajaId: caja.id, moneda: mon, cantidad: q, mxn });
      else {
        const costo = await costoDe(q);
        asiento = reglas.venta({ cajaId: caja.id, moneda: mon, cantidad: q, mxn, costo });
        resumen.utilidad_cambiaria = aPesos(asiento.resumen.utilidad);
      }
      Object.assign(op.datos, { tc, mxn, operacion: d.tipo });
      resumen.pesos = aPesos(mxn);
      break;
    }
    case 'entrada': case 'salida': {
      let contraparte = null;
      if (d.cliente_id || d.proveedor_id) {
        if (esDivisa) throw noValido('Solo los movimientos en pesos pueden afectar el saldo de un cliente o proveedor.');
        if (d.cliente_id) {
          const [c] = await t.q('SELECT id, activo FROM clientes WHERE id = ?', [d.cliente_id]);
          if (!c || !c.activo) throw noValido('Ese cliente no existe o está inactivo.');
          contraparte = { clienteId: c.id }; op.clienteId = c.id;
        } else {
          const [p] = await t.q('SELECT id, activo FROM proveedores WHERE id = ?', [d.proveedor_id]);
          if (!p || !p.activo) throw noValido('Ese proveedor no existe o está inactivo.');
          contraparte = { proveedorId: p.id }; op.proveedorId = p.id;
        }
      }
      let costo = 0;
      if (esDivisa && d.tipo === 'entrada') {
        if (tc > 0) costo = contravalor(q, tc);
        else {
          const inv = await leerInventario(t, caja.id, mon);
          if (!inv.cantidad) throw noValido('Escribe el tipo de cambio de costo: no hay existencia de esa divisa para tomar su costo promedio.');
          costo = Math.round((inv.costo * q) / inv.cantidad);
        }
        op.datos.tc = tc;
      }
      if (esDivisa && d.tipo === 'salida') costo = await costoDe(q);
      asiento = reglas[d.tipo]({ cajaId: caja.id, moneda: mon, cantidad: q, costo, contraparte });
      break;
    }
    case 'gasto': {
      const categoria = String(d.categoria || '').trim();
      if (!categoria) throw noValido('Indica la categoría del gasto.');
      asiento = reglas.gasto({ cajaId: caja.id, moneda: mon, cantidad: q, costo: await costoDe(q), categoria });
      op.datos.categoria = categoria;
      break;
    }
    case 'traspaso': {
      asiento = reglas.traspaso({ origenId: caja.id, destinoId: destino.id, moneda: mon, cantidad: q, costo: await costoDe(q) });
      op.cajaDestinoId = destino.id;
      break;
    }
    case 'retiro_utilidad': {
      if (esDivisa) throw noValido('Las comisiones se pasan a caja en pesos.');
      const [p] = await t.q('SELECT id FROM proveedores WHERE id = ?', [d.proveedor_id]);
      if (!p) throw noValido('Indica de qué proveedor se retira la utilidad.');
      asiento = reglas.retiroUtilidad({ cajaId: caja.id, proveedorId: p.id, monto: q });
      op.proveedorId = p.id;
      break;
    }
    case 'saldo_inicial': {
      let costo = 0;
      if (esDivisa) {
        if (q < 0) throw noValido('El saldo inicial de una divisa no puede ser negativo.');
        if (!(tc > 0)) throw noValido('Para el saldo inicial de una divisa escribe el tipo de cambio al que se tiene.');
        costo = contravalor(q, tc);
        op.datos.tc = tc;
      }
      asiento = reglas.inicialCaja({ cajaId: caja.id, moneda: mon, cantidad: q, costo });
      break;
    }
  }
  if (d.categoria) op.datos.categoria = String(d.categoria).trim();
  const id = await registrar(t, { ...op, tipo: d.tipo }, asiento);
  const [inv] = await t.q('SELECT cantidad FROM inventario WHERE caja_id = ? AND moneda = ?', [caja.id, mon]);
  return { id, fecha, ...resumen, saldo: aPesos(Number(inv?.cantidad || 0)) };
}

/** Existencias de las cajas visibles, con costo promedio, último corte y si tienen corte pendiente. */
export async function resumenCajas(db, usuario, cajas) {
  if (!cajas.length) return [];
  const ids = cajas.map((c) => c.id);
  const inv = await db.q(`SELECT caja_id, moneda, cantidad, costo FROM inventario WHERE caja_id IN (${ids.map(() => '?').join(',')})`, ids);
  const hoyOp = fechaOperacionBase();
  const out = [];
  for (const c of cajas) {
    const existencias = Object.fromEntries(MONEDAS.map((m) => [m, { cantidad: 0, costo: 0, costo_promedio: null }]));
    for (const r of inv.filter((x) => x.caja_id === c.id)) {
      const q = Number(r.cantidad), k = Number(r.costo);
      existencias[r.moneda] = { cantidad: aPesos(q), costo: aPesos(k), costo_promedio: r.moneda !== 'MXN' && q > 0 ? Math.round((k / q) * 1e4) / 1e4 : null };
    }
    const uc = await ultimoCorte(db, c.id);
    const [pend] = await db.q(
      'SELECT COUNT(*) AS n FROM asientos WHERE (caja_id = ? OR caja_destino_id = ?) AND fecha_operacion > ? AND fecha_operacion < ?',
      [c.id, c.id, uc || '1000-01-01', hoyOp],
    );
    out.push({ ...c, activa: !!c.activa, existencias, ultimo_corte: uc, corte_pendiente: Number(pend.n) > 0 });
  }
  return out;
}

/** Movimientos de una caja con el efecto en cada moneda. */
export async function movimientosCaja(db, usuario, cajaId, { desde, hasta, limite = 500 }) {
  const caja = await cajaConAcceso(db, usuario, cajaId);
  const w = ['(a.caja_id = ? OR a.caja_destino_id = ?)'], p = [caja.id, caja.id];
  if (desde) { w.push('a.fecha_operacion >= ?'); p.push(desde); }
  if (hasta) { w.push('a.fecha_operacion <= ?'); p.push(hasta); }
  const filas = await db.q(
    `SELECT a.id, a.tipo, a.fecha_operacion AS fecha, a.caja_id, a.caja_destino_id, a.cliente_id, cl.nombre AS cliente, a.proveedor_id, pr.nombre AS proveedor,
            a.referencia, a.concepto, a.datos, a.cancela_a, a.cancelado_por, u.nombre AS usuario, a.creado_en
       FROM asientos a LEFT JOIN clientes cl ON cl.id = a.cliente_id LEFT JOIN proveedores pr ON pr.id = a.proveedor_id JOIN usuarios u ON u.id = a.usuario_id
      WHERE ${w.join(' AND ')} ORDER BY a.fecha_operacion DESC, a.id DESC LIMIT ${Math.min(Number(limite) || 500, 2000)}`,
    p,
  );
  const ids = filas.map((f) => f.id);
  const efectos = new Map();
  if (ids.length) {
    const ps = await db.q(
      `SELECT p.asiento_id, k.moneda, k.codigo, p.monto FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id
        WHERE p.asiento_id IN (${ids.map(() => '?').join(',')}) AND (k.codigo LIKE ? OR k.codigo = 'ING:CAMBIARIA')`,
      [...ids, `CAJA:${caja.id}:%`],
    );
    for (const x of ps) {
      const e = efectos.get(x.asiento_id) || { efecto: {}, utilidad_cambiaria: 0 };
      if (x.codigo === 'ING:CAMBIARIA') e.utilidad_cambiaria -= Number(x.monto);
      else e.efecto[x.moneda] = (e.efecto[x.moneda] || 0) + Number(x.monto);
      efectos.set(x.asiento_id, e);
    }
  }
  return filas.map((f) => {
    const e = efectos.get(f.id) || { efecto: {}, utilidad_cambiaria: 0 };
    const datos = f.datos ? JSON.parse(f.datos) : {};
    delete datos.inventario;
    return { ...f, fecha: String(f.fecha).slice(0, 10), datos,
      efecto: Object.fromEntries(Object.entries(e.efecto).map(([m, v]) => [m, aPesos(v)])),
      utilidad_cambiaria: e.utilidad_cambiaria ? aPesos(e.utilidad_cambiaria) : null };
  });
}

