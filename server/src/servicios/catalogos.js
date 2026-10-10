// Clientes, proveedores y cajas, con sus saldos.
import { noEncontrado, conflicto, noValido } from '../lib/errores.js';
import { bitacora } from '../lib/bitacora.js';
import { marca, rangoMes } from '../lib/fechas.js';
import { aPesos, MONEDAS } from '../lib/dinero.js';
import { filtroCajas } from '../auth/permisos.js';

/** Saldos por código de cuenta con un prefijo (ej. 'CLI:'). */
export async function saldosPorPrefijo(db, prefijo) {
  const filas = await db.q(
    'SELECT k.codigo, SUM(p.monto) AS s FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id WHERE k.codigo LIKE ? GROUP BY k.codigo',
    [prefijo + '%'],
  );
  return new Map(filas.map((f) => [f.codigo, Number(f.s)]));
}

async function depositadoMes(db, campo) {
  const filas = await db.q(
    `SELECT ${campo} AS id, datos FROM asientos WHERE tipo = 'deposito' AND cancela_a IS NULL AND cancelado_por IS NULL AND fecha_operacion >= ? AND fecha_operacion < ?`,
    rangoMes(),
  );
  const out = new Map();
  for (const f of filas) out.set(f.id, (out.get(f.id) || 0) + (JSON.parse(f.datos).monto || 0));
  return out;
}

// ---------- Clientes ----------
export async function listarClientes(db) {
  const [clientes, saldos, mes] = await Promise.all([
    db.q(`SELECT c.*, u.nombre AS atiende FROM clientes c LEFT JOIN usuarios u ON u.id = c.atiende_id ORDER BY c.activo DESC, c.nombre`),
    saldosPorPrefijo(db, 'CLI:'),
    depositadoMes(db, 'cliente_id'),
  ]);
  return clientes.map((c) => ({
    id: c.id, nombre: c.nombre, comision_base: Number(c.comision_base), modalidad: c.modalidad,
    atiende_id: c.atiende_id, atiende: c.atiende, notas: c.notas, activo: !!c.activo,
    // Saldo a favor del cliente (lo que le debemos): pasivo, por eso se invierte el signo.
    saldo: aPesos(-(saldos.get(`CLI:${c.id}`) || 0)),
    depositado_mes: aPesos(mes.get(c.id) || 0),
  }));
}

async function validarAtiende(t, id) {
  if (id == null) return null;
  const [u] = await t.q("SELECT id FROM usuarios WHERE id = ? AND activo = 1 AND rol IN ('admin','cuentas')", [id]);
  if (!u) throw noValido('Quien atiende debe ser un usuario activo con rol de Administrador de cuentas o Administrador.');
  return id;
}

export async function guardarCliente(db, actor, id, d, ip) {
  return db.tx(async (t) => {
    const atiende = await validarAtiende(t, d.atiende_id ?? null);
    if (id) {
      const [c] = await t.q('SELECT id FROM clientes WHERE id = ?', [id]);
      if (!c) throw noEncontrado('No existe ese cliente.');
      await t.q('UPDATE clientes SET nombre=?, comision_base=?, modalidad=?, atiende_id=?, notas=?, activo=? WHERE id=?',
        [d.nombre.trim(), d.comision_base, d.modalidad, atiende, d.notas || null, d.activo === false ? 0 : 1, id]);
    } else {
      const r = await t.q('INSERT INTO clientes (nombre, comision_base, modalidad, atiende_id, notas, activo, creado_en) VALUES (?,?,?,?,?,1,?)',
        [d.nombre.trim(), d.comision_base, d.modalidad, atiende, d.notas || null, marca()]);
      id = r.insertId;
    }
    await bitacora(t, { usuarioId: actor.id, accion: 'guardar_cliente', entidad: 'cliente', entidadId: id, detalle: d, ip });
    return { id };
  });
}

// ---------- Proveedores ----------
export async function listarProveedores(db) {
  const [provs, saldos, noid, mes] = await Promise.all([
    db.q('SELECT * FROM proveedores ORDER BY activo DESC, tipo, nombre'),
    saldosPorPrefijo(db, 'PROV:'),
    saldosPorPrefijo(db, 'NOID:'),
    depositadoMes(db, 'proveedor_id'),
  ]);
  return provs.map((p) => ({
    id: p.id, nombre: p.nombre, tipo: p.tipo, comision_na: Number(p.comision_na), comision_cf: Number(p.comision_cf),
    notas: p.notas, activo: !!p.activo,
    saldo: aPesos(saldos.get(`PROV:${p.id}`) || 0),
    no_identificado: aPesos(-(noid.get(`NOID:${p.id}`) || 0)),
    recibido_mes: aPesos(mes.get(p.id) || 0),
  }));
}

export async function guardarProveedor(db, actor, id, d, ip) {
  return db.tx(async (t) => {
    if (id) {
      const [p] = await t.q('SELECT id FROM proveedores WHERE id = ?', [id]);
      if (!p) throw noEncontrado('No existe ese proveedor.');
      await t.q('UPDATE proveedores SET nombre=?, tipo=?, comision_na=?, comision_cf=?, notas=?, activo=? WHERE id=?',
        [d.nombre.trim(), d.tipo, d.comision_na, d.comision_cf, d.notas || null, d.activo === false ? 0 : 1, id]);
    } else {
      const r = await t.q('INSERT INTO proveedores (nombre, tipo, comision_na, comision_cf, notas, activo, creado_en) VALUES (?,?,?,?,?,1,?)',
        [d.nombre.trim(), d.tipo, d.comision_na, d.comision_cf, d.notas || null, marca()]);
      id = r.insertId;
    }
    await bitacora(t, { usuarioId: actor.id, accion: 'guardar_proveedor', entidad: 'proveedor', entidadId: id, detalle: d, ip });
    return { id };
  });
}

// ---------- Cajas ----------
export async function listarCajas(db, usuario) {
  const f = filtroCajas(usuario, 'c');
  return db.q(`SELECT c.id, c.nombre, c.tipo, c.activa FROM cajas c WHERE ${f.sql} ORDER BY c.tipo, c.nombre`, f.params);
}

export async function crearCaja(db, actor, { nombre }, ip) {
  return db.tx(async (t) => {
    const [e] = await t.q('SELECT id FROM cajas WHERE nombre = ?', [nombre.trim()]);
    if (e) throw conflicto('Ya existe una caja con ese nombre.');
    const r = await t.q("INSERT INTO cajas (nombre, tipo, activa, creado_en) VALUES (?, 'sucursal', 1, ?)", [nombre.trim(), marca()]);
    // Existencias en cero para cada moneda: sirven de candado cuando dos personas operan la misma caja.
    for (const m of MONEDAS) await t.q('INSERT INTO inventario (caja_id, moneda, cantidad, costo) VALUES (?,?,0,0)', [r.insertId, m]);
    await bitacora(t, { usuarioId: actor.id, accion: 'crear_caja', entidad: 'caja', entidadId: r.insertId, detalle: { nombre }, ip });
    return { id: r.insertId };
  });
}

export async function actualizarCaja(db, actor, id, { nombre, activa }, ip) {
  return db.tx(async (t) => {
    const [c] = await t.q('SELECT * FROM cajas WHERE id = ?', [id]);
    if (!c) throw noEncontrado('No existe esa caja.');
    if (c.tipo === 'matriz' && activa === false) throw conflicto('La matriz no se puede desactivar.');
    if (activa === false) {
      const [r] = await t.q('SELECT COALESCE(SUM(ABS(cantidad)),0) AS n FROM inventario WHERE caja_id = ?', [id]);
      if (Number(r.n) !== 0) throw conflicto('La caja todavía tiene efectivo. Traspásalo antes de desactivarla.');
    }
    await t.q('UPDATE cajas SET nombre = ?, activa = ? WHERE id = ?', [nombre?.trim() || c.nombre, activa === false ? 0 : 1, id]);
    await bitacora(t, { usuarioId: actor.id, accion: 'actualizar_caja', entidad: 'caja', entidadId: id, detalle: { nombre, activa }, ip });
  });
}
