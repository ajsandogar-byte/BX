// Casos delicados de cancelación detectados en revisión.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearDbPrueba, crearUsuario, arrancar, cliente, fijarHora } from './ayuda.js';

let db, srv, admin, cajero, suc;
before(async () => {
  fijarHora('2026-10-12T10:00');
  db = await crearDbPrueba();
  srv = await arrancar(db);
  await crearUsuario(db, { usuario: 'admin', rol: 'admin' });
  admin = await cliente(srv.base).entrar('admin');
  suc = (await admin.post('/api/cajas', { nombre: 'Sucursal Sur' })).data.id;
  await crearUsuario(db, { usuario: 'beto', rol: 'cajero', caja_id: suc });
  cajero = await cliente(srv.base).entrar('beto');
});
after(async () => { await srv.cerrar(); await db.cerrar(); });

const mov = (u, d) => u.post(`/api/cajas/${suc}/movimientos`, d);

test('cancelar una compra después de vender usa el costo promedio actual y el libro sigue cuadrando', async () => {
  await mov(admin, { tipo: 'saldo_inicial', moneda: 'MXN', cantidad: 100000 });
  const c1 = (await mov(cajero, { tipo: 'compra', moneda: 'USD', cantidad: 100, tc: 20 })).data.id;
  await mov(cajero, { tipo: 'compra', moneda: 'USD', cantidad: 100, tc: 18 });
  await mov(cajero, { tipo: 'venta', moneda: 'USD', cantidad: 100, tc: 19.5 });
  const r = await cajero.post(`/api/asientos/${c1}/cancelar`, { motivo: 'Compra equivocada' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const caja = (await cajero.get('/api/cajas')).data[0];
  assert.equal(caja.existencias.USD.cantidad, 0);
  assert.equal(caja.existencias.USD.costo, 0);
  const v = (await admin.get('/api/verificar-libro')).data;
  assert.equal(v.cuadra, true, JSON.stringify(v));
});

test('un cajero no puede cancelar saldos iniciales ni operaciones de días cerrados', async () => {
  const movs = (await cajero.get(`/api/cajas/${suc}/movimientos`)).data;
  const ini = movs.find((m) => m.tipo === 'saldo_inicial');
  assert.equal((await cajero.post(`/api/asientos/${ini.id}/cancelar`, { motivo: 'prueba' })).status, 403);
  const gasto = (await mov(cajero, { tipo: 'gasto', moneda: 'MXN', cantidad: 100, categoria: 'Luz' })).data.id;
  const esp = (await cajero.get(`/api/cajas/${suc}/corte?fecha=2026-10-12`)).data.esperado;
  assert.equal((await cajero.post(`/api/cajas/${suc}/cortes`, { fecha: '2026-10-12', contado: esp })).status, 200);
  fijarHora('2026-10-12T17:00'); // ya pasó el corte: lo nuevo va al 13
  assert.equal((await cajero.post(`/api/asientos/${gasto}/cancelar`, { motivo: 'prueba' })).status, 403);
  // El admin sí puede; la cancelación queda con fecha de hoy.
  const r = await admin.post(`/api/asientos/${gasto}/cancelar`, { motivo: 'Gasto duplicado' });
  assert.equal(r.status, 200);
  assert.equal(r.data.fecha, '2026-10-13');
  assert.equal((await admin.get('/api/verificar-libro')).data.cuadra, true);
});
