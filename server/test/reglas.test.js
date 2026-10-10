import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reglas, verificarCuadre, invertir } from '../src/contabilidad/reglas.js';
import { aCentavos, costoSalida, comision } from '../src/lib/dinero.js';

test('aCentavos acepta formatos comunes y rechaza basura', () => {
  assert.equal(aCentavos('1,234.56'), 123456);
  assert.equal(aCentavos('$100'), 10000);
  assert.equal(aCentavos('-50.5'), -5050);
  assert.equal(aCentavos(0.1 + 0.2), 30);
  assert.ok(Number.isNaN(aCentavos('12.345')));
  assert.ok(Number.isNaN(aCentavos('abc')));
});

test('depósito: cuadra y reparte comisiones como en el prototipo', () => {
  const a = reglas.deposito({ clienteId: 1, proveedorId: 2, monto: 10_000_000, pctCliente: 3, pctProveedor: 2 });
  verificarCuadre(a.partidas);
  assert.equal(a.resumen.abonoCliente, 9_700_000);
  assert.equal(a.resumen.abonoProveedor, 9_800_000);
  assert.equal(a.resumen.utilidad, 100_000);
});

test('compra y venta de divisa cuadran por moneda y calculan utilidad cambiaria', () => {
  const c = reglas.compra({ cajaId: 1, moneda: 'USD', cantidad: 100_000, mxn: 1_820_000 });
  verificarCuadre(c.partidas);
  const costo = costoSalida(50_000, 100_000, 1_820_000);
  const v = reglas.venta({ cajaId: 1, moneda: 'USD', cantidad: 50_000, mxn: 930_000, costo });
  verificarCuadre(v.partidas);
  assert.equal(v.resumen.utilidad, 930_000 - 910_000);
});

test('traspaso de divisa mueve también su costo', () => {
  const t = reglas.traspaso({ origenId: 2, destinoId: 1, moneda: 'USD', cantidad: 60_000, costo: 1_080_000 });
  verificarCuadre(t.partidas);
  assert.deepEqual(t.inventario.map((x) => [x.caja_id, x.cantidad, x.costo]), [[2, -60_000, -1_080_000], [1, 60_000, 1_080_000]]);
});

test('cancelar invierte exactamente', () => {
  const a = reglas.gasto({ cajaId: 1, moneda: 'MXN', cantidad: 300_000, categoria: 'Renta' });
  const b = invertir(a);
  verificarCuadre([...a.partidas, ...b.partidas]);
  assert.equal(a.inventario[0].cantidad + b.inventario[0].cantidad, 0);
});

test('no identificado y su comisión', () => {
  const a = reglas.noIdentificado({ proveedorId: 3, monto: 500_000, pctProveedor: 2 });
  verificarCuadre(a.partidas);
  assert.equal(comision(500_000, 2), 10_000);
});

test('verificarCuadre detecta asientos descuadrados', () => {
  assert.throws(() => verificarCuadre([{ cuenta: { codigo: 'X' }, moneda: 'MXN', monto: 1 }]), /no cuadra/);
});
