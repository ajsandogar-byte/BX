// Permisos por rol. El servidor es quien decide: la pantalla solo refleja esto.
import { sinAcceso, noEncontrado } from '../lib/errores.js';

export const ROLES = {
  admin: 'Administrador',
  cuentas: 'Administrador de cuentas',
  supervisor: 'Supervisor de sucursales',
  cajero: 'Cajero',
};

export const PUEDE = {
  usuarios: ['admin'],
  bitacora: ['admin'],
  cuentas: ['admin', 'cuentas'],          // clientes, proveedores, depósitos, pagos, estados de cuenta
  cajas: ['admin', 'supervisor', 'cajero'],
  administrarCajas: ['admin'],            // alta de sucursales
  reabrirCorte: ['admin', 'supervisor'],
  reporteGeneral: ['admin'],
};

export function exigir(usuario, permiso) {
  if (!usuario || !PUEDE[permiso].includes(usuario.rol)) throw sinAcceso();
}

/** ¿Puede este usuario ver y operar esta caja? */
export function puedeCaja(usuario, caja) {
  if (!usuario || !caja) return false;
  if (usuario.rol === 'admin') return true;
  if (usuario.rol === 'supervisor') return caja.tipo === 'sucursal';
  if (usuario.rol === 'cajero') return usuario.caja_id === caja.id;
  return false;
}

/** Carga la caja y verifica acceso. Responde "no encontrada" si no tiene acceso, para no revelar cajas ajenas. */
export async function cajaConAcceso(t, usuario, cajaId) {
  const [caja] = await t.q('SELECT id, nombre, tipo, activa FROM cajas WHERE id = ?', [cajaId]);
  if (!caja || !puedeCaja(usuario, caja)) throw noEncontrado('No existe esa caja o no tienes acceso a ella.');
  return caja;
}

/** Filtro SQL de cajas visibles para el usuario. */
export function filtroCajas(usuario, alias = 'c') {
  if (usuario.rol === 'admin') return { sql: '1=1', params: [] };
  if (usuario.rol === 'supervisor') return { sql: `${alias}.tipo = 'sucursal'`, params: [] };
  if (usuario.rol === 'cajero') return { sql: `${alias}.id = ?`, params: [usuario.caja_id ?? -1] };
  return { sql: '1=0', params: [] };
}
