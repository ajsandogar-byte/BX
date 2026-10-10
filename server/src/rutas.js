// Rutas de la API. Cada una valida la entrada, revisa permisos y llama al servicio.
import { z } from 'zod';
import { crearRouter } from './lib/http.js';
import { exigir, ROLES, cajaConAcceso } from './auth/permisos.js';
import { noValido, sinAcceso } from './lib/errores.js';
import { aCentavos, MONEDAS } from './lib/dinero.js';
import { esFecha, fechaOperacionBase } from './lib/fechas.js';
import * as U from './servicios/usuarios.js';
import * as K from './servicios/catalogos.js';
import * as O from './servicios/operaciones.js';
import * as Cj from './servicios/caja.js';
import * as Ct from './servicios/cortes.js';
import * as R from './servicios/reportes.js';
import { cancelar, leerAsiento, ultimoCorte } from './contabilidad/libro.js';

// ---------- Validación ----------
const dinero = (msg = 'Monto no válido.') => z.union([z.string(), z.number()]).transform((v, c) => {
  const x = aCentavos(v);
  if (!Number.isInteger(x)) { c.addIssue({ code: 'custom', message: msg }); return z.NEVER; }
  return x;
});
const pct = z.coerce.number({ invalid_type_error: 'Porcentaje no válido.' }).min(0, 'El porcentaje no puede ser negativo.').max(100, 'El porcentaje no puede pasar de 100.');
const id = z.coerce.number().int().positive();
const fecha = z.string().refine(esFecha, 'Fecha no válida.');
const texto = (max) => z.string().trim().max(max).optional().nullable();

function validar(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) {
    const i = r.error.issues[0];
    throw noValido(i.message && !i.message.startsWith('Expected') && !i.message.startsWith('Required') ? i.message : `Revisa el campo "${i.path.join('.') || 'datos'}".`);
  }
  return r.data;
}
const esAdmin = (u) => u.rol === 'admin';

export function crearRutas() {
  const r = crearRouter();

  // ---------- Sesión ----------
  r.get('/api/auth/yo', async ({ usuario, db }) => {
    let caja = null;
    if (usuario.caja_id) [caja] = await db.q('SELECT id, nombre, tipo FROM cajas WHERE id = ?', [usuario.caja_id]);
    return { ...usuario, rol_nombre: ROLES[usuario.rol], caja, fecha_operacion: fechaOperacionBase() };
  });
  r.post('/api/auth/password', async ({ usuario, db, body, ip }) => {
    await U.cambiarPropia(db, usuario, validar(z.object({ actual: z.string(), nueva: z.string() }), body), ip);
    return { ok: true };
  });

  // ---------- Usuarios (admin) ----------
  const usuarioSchema = z.object({
    nombre: z.string().trim().min(2, 'Escribe el nombre.').max(120),
    usuario: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'El usuario solo puede tener letras, números, punto, guion y guion bajo (3 a 40).'),
    rol: z.enum(['admin', 'cuentas', 'supervisor', 'cajero'], { errorMap: () => ({ message: 'Rol no válido.' }) }),
    caja_id: id.nullable().optional(),
  });
  r.get('/api/usuarios', async ({ usuario, db }) => { exigir(usuario, 'usuarios'); return U.listar(db); });
  r.post('/api/usuarios', async ({ usuario, db, body, ip }) => { exigir(usuario, 'usuarios'); return U.crear(db, usuario, validar(usuarioSchema, body), ip); });
  r.patch('/api/usuarios/:id', async ({ usuario, db, body, params, ip }) => {
    exigir(usuario, 'usuarios');
    const d = validar(usuarioSchema.omit({ usuario: true }).partial().extend({ activo: z.boolean().optional() }), body);
    await U.actualizar(db, usuario, Number(params.id), d, ip);
    return { ok: true };
  });
  r.post('/api/usuarios/:id/restablecer', async ({ usuario, db, params, ip }) => { exigir(usuario, 'usuarios'); return U.restablecer(db, usuario, Number(params.id), ip); });
  // Lista corta de quienes pueden atender clientes (para el formulario de clientes).
  r.get('/api/usuarios/atienden', async ({ usuario, db }) => {
    exigir(usuario, 'cuentas');
    return db.q("SELECT id, nombre FROM usuarios WHERE activo = 1 AND rol IN ('admin','cuentas') ORDER BY nombre");
  });

  // ---------- Clientes ----------
  const clienteSchema = z.object({
    nombre: z.string().trim().min(2, 'Escribe el nombre del cliente.').max(160),
    comision_base: pct, modalidad: z.enum(['NA', 'CF'], { errorMap: () => ({ message: 'La modalidad debe ser N/A o C/F.' }) }),
    atiende_id: id.nullable().optional(), notas: texto(2000), activo: z.boolean().optional(),
  });
  r.get('/api/clientes', async ({ usuario, db }) => { exigir(usuario, 'cuentas'); return K.listarClientes(db); });
  // Nombres de clientes para quien opera caja (entradas/salidas con cliente).
  r.get('/api/clientes/nombres', async ({ db }) => db.q('SELECT id, nombre FROM clientes WHERE activo = 1 ORDER BY nombre'));
  r.post('/api/clientes', async ({ usuario, db, body, ip }) => { exigir(usuario, 'cuentas'); return K.guardarCliente(db, usuario, null, validar(clienteSchema, body), ip); });
  r.patch('/api/clientes/:id', async ({ usuario, db, body, params, ip }) => { exigir(usuario, 'cuentas'); return K.guardarCliente(db, usuario, Number(params.id), validar(clienteSchema, body), ip); });
  r.get('/api/clientes/:id/estado-cuenta', async ({ usuario, db, params }) => { exigir(usuario, 'cuentas'); return O.estadoDeCuenta(db, `CLI:${Number(params.id)}`, -1); });

  // ---------- Proveedores ----------
  const proveedorSchema = z.object({
    nombre: z.string().trim().min(2, 'Escribe el nombre del proveedor.').max(160),
    tipo: z.enum(['interno', 'externo']), comision_na: pct, comision_cf: pct, notas: texto(2000), activo: z.boolean().optional(),
  });
  r.get('/api/proveedores', async ({ usuario, db }) => { exigir(usuario, 'cuentas'); return K.listarProveedores(db); });
  r.get('/api/proveedores/nombres', async ({ db }) => db.q('SELECT id, nombre, tipo FROM proveedores WHERE activo = 1 ORDER BY nombre'));
  r.post('/api/proveedores', async ({ usuario, db, body, ip }) => { exigir(usuario, 'cuentas'); return K.guardarProveedor(db, usuario, null, validar(proveedorSchema, body), ip); });
  r.patch('/api/proveedores/:id', async ({ usuario, db, body, params, ip }) => { exigir(usuario, 'cuentas'); return K.guardarProveedor(db, usuario, Number(params.id), validar(proveedorSchema, body), ip); });
  r.get('/api/proveedores/:id/estado-cuenta', async ({ usuario, db, params }) => { exigir(usuario, 'cuentas'); return O.estadoDeCuenta(db, `PROV:${Number(params.id)}`, 1); });

  // ---------- Operaciones de clientes y proveedores ----------
  const operacionSchema = z.object({
    tipo: z.enum(['deposito', 'pago', 'ajuste', 'saldo_inicial']),
    fecha: fecha.optional(), cliente_id: id.optional(), proveedor_id: id.optional(),
    monto: dinero(), pct_cliente: pct.optional(), pct_proveedor: pct.optional(),
    modalidad: z.enum(['NA', 'CF']).optional(), aplica: z.enum(['cliente', 'proveedor']).optional(),
    referencia: texto(120), concepto: texto(255),
  });
  r.post('/api/operaciones', async ({ usuario, db, body, ip }) => {
    exigir(usuario, 'cuentas');
    const d = validar(operacionSchema, body);
    if (d.tipo !== 'ajuste' && d.tipo !== 'saldo_inicial' && d.monto <= 0) throw noValido('El monto debe ser positivo. Para restar usa un ajuste.');
    if (d.tipo === 'saldo_inicial' && !esAdmin(usuario)) throw sinAcceso('Solo un administrador puede capturar saldos iniciales.');
    return db.tx((t) => O.registrarOperacion(t, usuario, d, ip));
  });
  r.get('/api/operaciones', async ({ usuario, db, query }) => {
    exigir(usuario, 'cuentas');
    return O.listarOperaciones(db, query);
  });

  // ---------- Cajas ----------
  r.get('/api/cajas', async ({ usuario, db }) => {
    exigir(usuario, 'cajas');
    const cajas = await K.listarCajas(db, usuario);
    return Cj.resumenCajas(db, usuario, cajas);
  });
  r.post('/api/cajas', async ({ usuario, db, body, ip }) => {
    exigir(usuario, 'administrarCajas');
    return K.crearCaja(db, usuario, validar(z.object({ nombre: z.string().trim().min(2, 'Escribe el nombre de la sucursal.').max(80) }), body), ip);
  });
  r.patch('/api/cajas/:id', async ({ usuario, db, body, params, ip }) => {
    exigir(usuario, 'administrarCajas');
    await K.actualizarCaja(db, usuario, Number(params.id), validar(z.object({ nombre: z.string().trim().min(2).max(80).optional(), activa: z.boolean().optional() }), body), ip);
    return { ok: true };
  });
  // Lista de cajas destino para traspasos (solo nombres).
  r.get('/api/cajas/destinos', async ({ usuario, db }) => { exigir(usuario, 'cajas'); return db.q('SELECT id, nombre, tipo FROM cajas WHERE activa = 1 ORDER BY tipo, nombre'); });

  const movCajaSchema = z.object({
    tipo: z.enum(['compra', 'venta', 'entrada', 'salida', 'gasto', 'traspaso', 'retiro_utilidad', 'saldo_inicial']),
    moneda: z.enum(MONEDAS), cantidad: dinero(), tc: z.coerce.number().positive('Tipo de cambio no válido.').optional().nullable(),
    categoria: texto(60), destino_id: id.optional(), cliente_id: id.optional().nullable(), proveedor_id: id.optional().nullable(),
    referencia: texto(120), concepto: texto(255), fecha: fecha.optional(),
  });
  r.post('/api/cajas/:id/movimientos', async ({ usuario, db, body, params, ip }) => {
    exigir(usuario, 'cajas');
    const d = validar(movCajaSchema, body);
    return db.tx((t) => Cj.movimientoCaja(t, usuario, Number(params.id), d, ip));
  });
  r.get('/api/cajas/:id/movimientos', async ({ usuario, db, params, query }) => { exigir(usuario, 'cajas'); return Cj.movimientosCaja(db, usuario, Number(params.id), query); });

  // ---------- Cortes ----------
  r.get('/api/cajas/:id/corte', async ({ usuario, db, params, query }) => {
    exigir(usuario, 'cajas');
    return Ct.vistaPrevia(db, usuario, Number(params.id), validar(fecha, query.fecha));
  });
  const montosMoneda = z.object(Object.fromEntries(MONEDAS.map((m) => [m, dinero(`Monto no válido en ${m}.`).optional()]))).partial();
  r.post('/api/cajas/:id/cortes', async ({ usuario, db, body, params, ip }) => {
    exigir(usuario, 'cajas');
    const d = validar(z.object({ fecha, contado: montosMoneda, enviado: montosMoneda.optional(), nota: texto(255) }), body);
    return db.tx((t) => Ct.hacerCorte(t, usuario, Number(params.id), d, ip));
  });
  r.get('/api/cajas/:id/cortes', async ({ usuario, db, params }) => { exigir(usuario, 'cajas'); return Ct.listarCortes(db, usuario, Number(params.id)); });
  r.post('/api/cortes/:id/reabrir', async ({ usuario, db, body, params, ip }) => {
    await db.tx((t) => Ct.reabrir(t, usuario, Number(params.id), body?.motivo, ip));
    return { ok: true };
  });

  // ---------- Cancelaciones ----------
  async function exigirSobreAsiento(t, usuario, a) {
    if (a.caja_id) {
      exigir(usuario, 'cajas');
      await cajaConAcceso(t, usuario, a.caja_id);
    } else exigir(usuario, 'cuentas');
  }
  r.get('/api/asientos/:id', async ({ usuario, db, params }) => {
    const a = await leerAsiento(db, Number(params.id));
    await exigirSobreAsiento(db, usuario, a);
    return a;
  });
  r.post('/api/asientos/:id/cancelar', async ({ usuario, db, body, params, ip }) => {
    const { motivo } = validar(z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo de la cancelación.').max(200) }), body);
    return db.tx(async (t) => {
      const a = await leerAsiento(t, Number(params.id));
      await exigirSobreAsiento(t, usuario, a);
      if (a.tipo === 'ajuste_corte' || a.datos?.del_corte) {
        throw noValido('Esta operación es parte de un corte. Para corregirla, reabre el día.');
      }
      if (a.datos?.linea_id) throw noValido('Esta operación viene de un estado de cuenta. Desasígnala desde ahí.');
      if (['saldo_inicial', 'retiro_utilidad'].includes(a.tipo) && !esAdmin(usuario)) throw sinAcceso('Solo un administrador puede cancelar esta operación.');
      // Fuera del administrador, nadie deshace operaciones de días ya cerrados.
      if (!esAdmin(usuario) && a.caja_id) {
        for (const c of [a.caja_id, a.caja_destino_id].filter(Boolean)) {
          const uc = await ultimoCorte(t, c);
          if (uc && String(a.fecha_operacion).slice(0, 10) <= uc) throw sinAcceso('Esa operación es de un día ya cerrado. Pide a un administrador que la cancele.');
        }
      }
      const r2 = await cancelar(t, a.id, { usuarioId: usuario.id, motivo, ip });
      return { id: r2.id, fecha: r2.fecha };
    });
  });

  // ---------- Reportes ----------
  r.get('/api/resumen', async ({ usuario, db }) => {
    const out = { rol: usuario.rol };
    if (['admin', 'cuentas'].includes(usuario.rol)) out.cuentas = await R.resumenCuentas(db);
    if (esAdmin(usuario)) out.cajas = await R.resumenCajas(db);
    return out;
  });
  r.get('/api/verificar-libro', async ({ usuario, db }) => { exigir(usuario, 'reporteGeneral'); return R.verificarLibro(db); });
  r.get('/api/bitacora', async ({ usuario, db, query }) => {
    exigir(usuario, 'bitacora');
    const lim = Math.min(Number(query.limite) || 200, 1000);
    return db.q(`SELECT b.*, u.nombre AS usuario FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id DESC LIMIT ${lim}`);
  });

  return r;
}

