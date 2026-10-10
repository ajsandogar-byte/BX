// Operaciones de clientes y proveedores (en pesos): depósitos, pagos, ajustes y saldos iniciales.
import { reglas } from '../contabilidad/reglas.js';
import { registrar } from '../contabilidad/libro.js';
import { noEncontrado, noValido } from '../lib/errores.js';
import { fechaOperacionBase } from '../lib/fechas.js';
import { aPesos } from '../lib/dinero.js';

async function cliente(t, id) {
  const [c] = await t.q('SELECT * FROM clientes WHERE id = ?', [id]);
  if (!c) throw noEncontrado('No existe ese cliente.');
  if (!c.activo) throw noValido(`El cliente ${c.nombre} está inactivo.`);
  return { ...c, comision_base: Number(c.comision_base) };
}
async function proveedor(t, id) {
  const [p] = await t.q('SELECT * FROM proveedores WHERE id = ?', [id]);
  if (!p) throw noEncontrado('No existe ese proveedor.');
  if (!p.activo) throw noValido(`El proveedor ${p.nombre} está inactivo.`);
  return { ...p, comision_na: Number(p.comision_na), comision_cf: Number(p.comision_cf) };
}
export const pctProveedor = (p, modalidad) => (modalidad === 'CF' ? p.comision_cf : p.comision_na);

/**
 * d: { tipo, fecha?, cliente_id?, proveedor_id?, monto (centavos), pct_cliente?, pct_proveedor?, modalidad?, aplica?, referencia?, concepto?, linea_id? }
 * Los porcentajes, si no vienen, se toman de la base del cliente y del proveedor según la modalidad.
 */
export async function registrarOperacion(t, usuario, d, ip) {
  const fecha = d.fecha || fechaOperacionBase();
  const base = { fecha, usuarioId: usuario.id, referencia: d.referencia, concepto: d.concepto, ip };

  if (d.tipo === 'deposito') {
    const c = await cliente(t, d.cliente_id), p = await proveedor(t, d.proveedor_id);
    const modalidad = d.modalidad || c.modalidad;
    const pctCli = d.pct_cliente ?? c.comision_base;
    const pctProv = d.pct_proveedor ?? pctProveedor(p, modalidad);
    const a = reglas.deposito({ clienteId: c.id, proveedorId: p.id, monto: d.monto, pctCliente: pctCli, pctProveedor: pctProv });
    const id = await registrar(t, { ...base, tipo: 'deposito', clienteId: c.id, proveedorId: p.id,
      datos: { monto: d.monto, modalidad, pct_cliente: pctCli, pct_proveedor: pctProv, base_cliente: c.comision_base, base_proveedor: pctProveedor(p, modalidad), linea_id: d.linea_id ?? null } }, a);
    return { id, fecha, abono_cliente: aPesos(a.resumen.abonoCliente), abono_proveedor: aPesos(a.resumen.abonoProveedor), utilidad: aPesos(a.resumen.utilidad) };
  }
  if (d.tipo === 'pago') {
    const c = await cliente(t, d.cliente_id), p = await proveedor(t, d.proveedor_id);
    const id = await registrar(t, { ...base, tipo: 'pago', clienteId: c.id, proveedorId: p.id, datos: { monto: d.monto, linea_id: d.linea_id ?? null } },
      reglas.pago({ clienteId: c.id, proveedorId: p.id, monto: d.monto }));
    return { id, fecha };
  }
  if (d.tipo === 'ajuste' || d.tipo === 'saldo_inicial') {
    const inicial = d.tipo === 'saldo_inicial';
    if (d.aplica === 'cliente') {
      const c = await cliente(t, d.cliente_id);
      const a = inicial ? reglas.inicialCliente({ clienteId: c.id, monto: d.monto }) : reglas.ajusteCliente({ clienteId: c.id, monto: d.monto });
      return { id: await registrar(t, { ...base, tipo: d.tipo, clienteId: c.id, datos: { monto: d.monto } }, a), fecha };
    }
    if (d.aplica === 'proveedor') {
      const p = await proveedor(t, d.proveedor_id);
      const a = inicial ? reglas.inicialProveedor({ proveedorId: p.id, monto: d.monto }) : reglas.ajusteProveedor({ proveedorId: p.id, monto: d.monto });
      return { id: await registrar(t, { ...base, tipo: d.tipo, proveedorId: p.id, datos: { monto: d.monto } }, a), fecha };
    }
    throw noValido('Indica si el ajuste es para un cliente o un proveedor.');
  }
  throw noValido('Tipo de operación no válido.');
}

/** Movimientos de una cuenta (cliente o proveedor) con saldo corrido. signo: -1 para pasivos (clientes). */
export async function estadoDeCuenta(db, codigo, signo) {
  const filas = await db.q(
    `SELECT a.id, a.tipo, a.fecha_operacion AS fecha, a.cliente_id, a.proveedor_id, a.caja_id, a.referencia, a.concepto,
            a.datos, a.cancela_a, a.cancelado_por, p.monto
       FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id JOIN asientos a ON a.id = p.asiento_id
      WHERE k.codigo = ? ORDER BY a.fecha_operacion, a.id`,
    [codigo],
  );
  let saldo = 0;
  return filas.map((f) => {
    const mov = signo * Number(f.monto);
    saldo += mov;
    const datos = f.datos ? JSON.parse(f.datos) : {};
    delete datos.inventario;
    return { id: f.id, tipo: f.tipo, fecha: String(f.fecha).slice(0, 10), cliente_id: f.cliente_id, proveedor_id: f.proveedor_id, caja_id: f.caja_id,
      referencia: f.referencia, concepto: f.concepto, datos, cancela_a: f.cancela_a, cancelado_por: f.cancelado_por,
      movimiento: aPesos(mov), saldo: aPesos(saldo) };
  });
}

/** Lista general de operaciones de clientes/proveedores (no de caja) con filtros. */
export async function listarOperaciones(db, { desde, hasta, cliente_id, proveedor_id, tipo, limite = 500 }) {
  const w = ['a.caja_id IS NULL'], p = [];
  if (desde) { w.push('a.fecha_operacion >= ?'); p.push(desde); }
  if (hasta) { w.push('a.fecha_operacion <= ?'); p.push(hasta); }
  if (cliente_id) { w.push('a.cliente_id = ?'); p.push(cliente_id); }
  if (proveedor_id) { w.push('a.proveedor_id = ?'); p.push(proveedor_id); }
  if (tipo) { w.push('a.tipo = ?'); p.push(tipo); }
  const filas = await db.q(
    `SELECT a.id, a.tipo, a.fecha_operacion AS fecha, a.cliente_id, cl.nombre AS cliente, a.proveedor_id, pr.nombre AS proveedor,
            a.referencia, a.concepto, a.datos, a.cancela_a, a.cancelado_por, a.usuario_id, u.nombre AS usuario, a.creado_en
       FROM asientos a LEFT JOIN clientes cl ON cl.id = a.cliente_id LEFT JOIN proveedores pr ON pr.id = a.proveedor_id
       JOIN usuarios u ON u.id = a.usuario_id
      WHERE ${w.join(' AND ')} ORDER BY a.fecha_operacion DESC, a.id DESC LIMIT ${Math.min(Number(limite) || 500, 2000)}`,
    p,
  );
  // Efecto en cliente y proveedor desde las partidas.
  const ids = filas.map((f) => f.id);
  const efectos = new Map();
  if (ids.length) {
    const ps = await db.q(
      `SELECT p.asiento_id, k.codigo, p.monto FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id
        WHERE p.asiento_id IN (${ids.map(() => '?').join(',')}) AND (k.codigo LIKE 'CLI:%' OR k.codigo LIKE 'PROV:%' OR k.codigo LIKE 'NOID:%' OR k.codigo IN ('ING:COMISIONES','COSTO:COMISIONES'))`,
      ids,
    );
    for (const x of ps) {
      const e = efectos.get(x.asiento_id) || { cliente: 0, proveedor: 0, utilidad: 0, no_identificado: 0 };
      const m = Number(x.monto);
      if (x.codigo.startsWith('CLI:')) e.cliente -= m;
      else if (x.codigo.startsWith('PROV:')) e.proveedor += m;
      else if (x.codigo.startsWith('NOID:')) e.no_identificado -= m;
      else e.utilidad -= m;
      efectos.set(x.asiento_id, e);
    }
  }
  return filas.map((f) => {
    const e = efectos.get(f.id) || { cliente: 0, proveedor: 0, utilidad: 0, no_identificado: 0 };
    const datos = f.datos ? JSON.parse(f.datos) : {};
    delete datos.inventario;
    return { ...f, fecha: String(f.fecha).slice(0, 10), datos,
      efecto_cliente: aPesos(e.cliente), efecto_proveedor: aPesos(e.proveedor), utilidad: aPesos(e.utilidad), efecto_no_identificado: aPesos(e.no_identificado) };
  });
}
