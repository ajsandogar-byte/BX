// Prueba de punta a punta por HTTP: roles, operaciones, cajas, cortes y cancelaciones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearDbPrueba, crearUsuario, arrancar, cliente, fijarHora } from './ayuda.js';

let db, srv, admin, cuentas, supervisor, cajero, sucursalId, otraSucursalId, clienteId, provId;

before(async () => {
  fijarHora('2026-10-09T10:00');
  db = await crearDbPrueba();
  srv = await arrancar(db);
  await crearUsuario(db, { usuario: 'admin', rol: 'admin' });
  admin = await cliente(srv.base).entrar('admin');
});
after(async () => { await srv.cerrar(); await db.cerrar(); });

test('sin sesión no hay acceso y sin cabecera no se puede escribir', async () => {
  const anon = cliente(srv.base);
  assert.equal((await anon.get('/api/clientes')).status, 401);
  const r = await fetch(srv.base + '/api/auth/login', { method: 'POST', body: '{}' });
  assert.equal(r.status, 403);
});

test('el admin da de alta sucursales y usuarios con contraseña temporal', async () => {
  sucursalId = (await admin.post('/api/cajas', { nombre: 'Sucursal Centro' })).data.id;
  otraSucursalId = (await admin.post('/api/cajas', { nombre: 'Sucursal Norte' })).data.id;
  const r = await admin.post('/api/usuarios', { nombre: 'Ana Cajera', usuario: 'ana', rol: 'cajero', caja_id: sucursalId });
  assert.equal(r.status, 200);
  const temp = r.data.passwordTemporal;
  const ana = await cliente(srv.base).entrar('ana', temp);
  // Con contraseña temporal solo puede cambiarla.
  assert.equal((await ana.get('/api/cajas')).data.codigo, 'cambiar_password');
  assert.equal((await ana.post('/api/auth/password', { actual: temp, nueva: 'corta' })).status, 400);
  assert.equal((await ana.post('/api/auth/password', { actual: temp, nueva: 'NuevaClave2026' })).status, 200);
  cajero = ana;
  assert.equal((await admin.post('/api/usuarios', { nombre: 'Sin caja', usuario: 'x1', rol: 'cajero' })).status, 400);

  await crearUsuario(db, { usuario: 'carla', rol: 'cuentas' });
  await crearUsuario(db, { usuario: 'sergio', rol: 'supervisor' });
  cuentas = await cliente(srv.base).entrar('carla');
  supervisor = await cliente(srv.base).entrar('sergio');
});

test('cada rol solo ve lo suyo', async () => {
  assert.equal((await cajero.get('/api/clientes')).status, 403);
  assert.equal((await cuentas.get('/api/cajas')).status, 403);
  assert.equal((await supervisor.get('/api/usuarios')).status, 403);
  assert.deepEqual((await cajero.get('/api/cajas')).data.map((c) => c.nombre), ['Sucursal Centro']);
  assert.deepEqual((await supervisor.get('/api/cajas')).data.map((c) => c.nombre).sort(), ['Sucursal Centro', 'Sucursal Norte']);
  assert.equal((await admin.get('/api/cajas')).data.length, 3);
  // El cajero no puede tocar la matriz ni otra sucursal: la API responde como si no existieran.
  assert.equal((await cajero.post('/api/cajas/1/movimientos', { tipo: 'entrada', moneda: 'MXN', cantidad: '10' })).status, 404);
  assert.equal((await cajero.get(`/api/cajas/${otraSucursalId}/movimientos`)).status, 404);
  assert.equal((await supervisor.get('/api/cajas/1/movimientos')).status, 404);
});

test('clientes, proveedores y depósito con comisiones', async () => {
  const atiende = (await cuentas.get('/api/usuarios/atienden')).data.find((u) => u.nombre === 'carla');
  clienteId = (await cuentas.post('/api/clientes', { nombre: 'Cliente Uno', comision_base: 4, modalidad: 'CF', atiende_id: atiende.id })).data.id;
  provId = (await cuentas.post('/api/proveedores', { nombre: 'Banco Interno', tipo: 'interno', comision_na: 2, comision_cf: 3 })).data.id;
  const r = await cuentas.post('/api/operaciones', { tipo: 'deposito', cliente_id: clienteId, proveedor_id: provId, monto: '10,000' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.abono_cliente, 9600);
  assert.equal(r.data.abono_proveedor, 9700);
  assert.equal(r.data.utilidad, 100);
  // % especial en una operación.
  await cuentas.post('/api/operaciones', { tipo: 'deposito', cliente_id: clienteId, proveedor_id: provId, monto: 1000, pct_cliente: 5 });
  await cuentas.post('/api/operaciones', { tipo: 'pago', cliente_id: clienteId, proveedor_id: provId, monto: 2000 });
  const cl = (await cuentas.get('/api/clientes')).data[0];
  assert.equal(cl.saldo, 9600 + 950 - 2000);
  assert.equal(cl.atiende, 'carla');
  const pr = (await cuentas.get('/api/proveedores')).data[0];
  assert.equal(pr.saldo, 9700 + 970 - 2000);
  const ec = (await cuentas.get(`/api/clientes/${clienteId}/estado-cuenta`)).data;
  assert.equal(ec.at(-1).saldo, cl.saldo);
  // Un cajero no puede registrar depósitos.
  assert.equal((await cajero.post('/api/operaciones', { tipo: 'pago', cliente_id: clienteId, proveedor_id: provId, monto: 1 })).status, 403);
  // Saldo inicial: solo admin.
  assert.equal((await cuentas.post('/api/operaciones', { tipo: 'saldo_inicial', aplica: 'cliente', cliente_id: clienteId, monto: 5 })).status, 403);
});

test('caja: saldo inicial, compra, venta con utilidad cambiaria y validación de existencia', async () => {
  const mov = (u, caja, d) => u.post(`/api/cajas/${caja}/movimientos`, d);
  assert.equal((await mov(cajero, sucursalId, { tipo: 'saldo_inicial', moneda: 'MXN', cantidad: 50000 })).status, 403);
  assert.equal((await mov(admin, sucursalId, { tipo: 'saldo_inicial', moneda: 'MXN', cantidad: 50000 })).status, 200);
  assert.equal((await mov(admin, 1, { tipo: 'saldo_inicial', moneda: 'MXN', cantidad: 100000 })).status, 200);
  let r = await mov(cajero, sucursalId, { tipo: 'compra', moneda: 'USD', cantidad: 1000, tc: 18 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.fecha, '2026-10-09');
  r = await mov(cajero, sucursalId, { tipo: 'venta', moneda: 'USD', cantidad: 400, tc: 18.5 });
  assert.equal(r.data.utilidad_cambiaria, 200);
  // No se puede vender más de lo que hay.
  r = await mov(cajero, sucursalId, { tipo: 'venta', moneda: 'USD', cantidad: 601, tc: 18.5 });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /No alcanza/);
  // Ni sacar más pesos de los que hay.
  r = await mov(cajero, sucursalId, { tipo: 'gasto', moneda: 'MXN', cantidad: 999999, categoria: 'Renta' });
  assert.equal(r.status, 409);
  r = await mov(cajero, sucursalId, { tipo: 'gasto', moneda: 'MXN', cantidad: 500, categoria: 'Papelería' });
  assert.equal(r.status, 200);
  const caja = (await cajero.get('/api/cajas')).data[0];
  assert.equal(caja.existencias.MXN.cantidad, 50000 - 18000 + 7400 - 500);
  assert.equal(caja.existencias.USD.cantidad, 600);
  assert.equal(caja.existencias.USD.costo_promedio, 18);
});

test('entrada de efectivo de un cliente afecta su saldo', async () => {
  const antes = (await cuentas.get('/api/clientes')).data[0].saldo;
  const r = await cajero.post(`/api/cajas/${sucursalId}/movimientos`, { tipo: 'entrada', moneda: 'MXN', cantidad: 3000, cliente_id: clienteId });
  assert.equal(r.status, 200);
  assert.equal((await cuentas.get('/api/clientes')).data[0].saldo, antes + 3000);
});

test('después de las 4:30 se registra al día siguiente', async () => {
  fijarHora('2026-10-09T16:45');
  const r = await cajero.post(`/api/cajas/${sucursalId}/movimientos`, { tipo: 'compra', moneda: 'USD', cantidad: 100, tc: 18.2 });
  assert.equal(r.data.fecha, '2026-10-10');
});

test('corte con faltante y envío a matriz; el día queda cerrado', async () => {
  const prev = (await cajero.get(`/api/cajas/${sucursalId}/corte?fecha=2026-10-09`)).data;
  // El esperado del 9 no incluye la compra registrada para el 10.
  assert.equal(prev.esperado.USD, 600);
  const esperadoMxn = prev.esperado.MXN;
  const r = await cajero.post(`/api/cajas/${sucursalId}/cortes`, {
    fecha: '2026-10-09',
    contado: { MXN: esperadoMxn - 10, USD: 600, EUR: 0, CAD: 0, GBP: 0 },
    enviado: { MXN: 30000, USD: 600 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cortes = (await cajero.get(`/api/cajas/${sucursalId}/cortes`)).data;
  assert.equal(cortes[0].diferencia.MXN, -10);
  // Ya no se puede registrar con fecha del 9 (el admin lo intenta a propósito).
  const x = await admin.post(`/api/cajas/${sucursalId}/movimientos`, { tipo: 'gasto', moneda: 'MXN', cantidad: 1, categoria: 'Otros', fecha: '2026-10-09' });
  assert.equal(x.status, 409);
  // La matriz recibió el envío.
  const matriz = (await admin.get('/api/cajas')).data.find((c) => c.tipo === 'matriz');
  assert.equal(matriz.existencias.MXN.cantidad, 100000 + 30000);
  assert.equal(matriz.existencias.USD.cantidad, 600);
  // Viaja con el costo promedio de lo que había físicamente en la caja (incluye la compra de después del corte).
  assert.equal(matriz.existencias.USD.costo_promedio, Math.round(((600 * 18 + 100 * 18.2) / 700) * 1e4) / 1e4);
  // El cajero no puede reabrir; el supervisor sí, con motivo.
  assert.equal((await cajero.post(`/api/cortes/${cortes[0].id}/reabrir`, { motivo: 'error' })).status, 403);
  assert.equal((await supervisor.post(`/api/cortes/${cortes[0].id}/reabrir`, {})).status, 400);
  const antesSuc = (await supervisor.get('/api/cajas')).data.find((c) => c.id === sucursalId).existencias;
  assert.equal((await supervisor.post(`/api/cortes/${cortes[0].id}/reabrir`, { motivo: 'Revisar faltante' })).status, 200);
  // Al reabrir regresan el faltante y lo enviado a la matriz.
  const despuesSuc = (await supervisor.get('/api/cajas')).data.find((c) => c.id === sucursalId).existencias;
  assert.equal(despuesSuc.MXN.cantidad, antesSuc.MXN.cantidad + 10 + 30000);
  assert.equal(despuesSuc.USD.cantidad, antesSuc.USD.cantidad + 600);
  assert.equal((await admin.get('/api/verificar-libro')).data.cuadra, true);
});

test('cancelar en lugar de borrar: queda registro y el saldo regresa', async () => {
  const movs = (await cajero.get(`/api/cajas/${sucursalId}/movimientos`)).data;
  const gasto = movs.find((m) => m.tipo === 'gasto');
  assert.equal((await cajero.post(`/api/asientos/${gasto.id}/cancelar`, {})).status, 400);
  const antes = (await cajero.get('/api/cajas')).data[0].existencias.MXN.cantidad;
  const r = await cajero.post(`/api/asientos/${gasto.id}/cancelar`, { motivo: 'Capturado dos veces' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await cajero.get('/api/cajas')).data[0].existencias.MXN.cantidad, antes + 500);
  assert.equal((await cajero.post(`/api/asientos/${gasto.id}/cancelar`, { motivo: 'otra vez' })).status, 409);
  const bit = (await admin.get('/api/bitacora')).data;
  assert.ok(bit.some((b) => b.accion === 'cancelar'));
});

test('el libro cuadra y el resumen tiene sentido', async () => {
  const v = (await admin.get('/api/verificar-libro')).data;
  assert.equal(v.cuadra, true, JSON.stringify(v));
  const res = (await admin.get('/api/resumen')).data;
  assert.equal(res.cajas.utilidad_cambiaria_mes, 200);
  assert.ok(res.cuentas.utilidad_comisiones_mes > 0);
  const resCuentas = (await cuentas.get('/api/resumen')).data;
  assert.equal(resCuentas.cajas, undefined);
});

test('un usuario desactivado pierde la sesión', async () => {
  const lista = (await admin.get('/api/usuarios')).data;
  const ana = lista.find((u) => u.usuario === 'ana');
  assert.equal((await admin.patch(`/api/usuarios/${ana.id}`, { activo: false })).status, 200);
  assert.equal((await cajero.get('/api/cajas')).status, 401);
  // Debe quedar al menos un admin.
  const yo = lista.find((u) => u.usuario === 'admin');
  assert.equal((await admin.patch(`/api/usuarios/${yo.id}`, { rol: 'cuentas' })).status, 409);
});
