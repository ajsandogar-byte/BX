// Resumen general para el tablero.
import { aPesos, MONEDAS } from '../lib/dinero.js';
import { rangoMes } from '../lib/fechas.js';
import { saldosPorPrefijo } from './catalogos.js';

async function sumaCuentas(db, condicion, params, [desde, hasta] = []) {
  const w = [condicion];
  const p = [...params];
  if (desde) { w.push('a.fecha_operacion >= ? AND a.fecha_operacion < ?'); p.push(desde, hasta); }
  const [r] = await db.q(
    `SELECT COALESCE(SUM(p.monto),0) AS s FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id JOIN asientos a ON a.id = p.asiento_id WHERE ${w.join(' AND ')}`, p);
  return Number(r.s);
}

/** Parte de cuentas: clientes, proveedores, no identificados y utilidad por comisiones. */
export async function resumenCuentas(db) {
  const mes = rangoMes();
  const [cli, prov, noid] = await Promise.all([saldosPorPrefijo(db, 'CLI:'), saldosPorPrefijo(db, 'PROV:'), saldosPorPrefijo(db, 'NOID:')]);
  const tot = (m, s = 1) => [...m.values()].reduce((a, b) => a + s * b, 0);
  const comisionesMes = -(await sumaCuentas(db, "k.codigo IN ('ING:COMISIONES','COSTO:COMISIONES')", [], mes));
  const comisionesTotal = -(await sumaCuentas(db, "k.codigo IN ('ING:COMISIONES','COSTO:COMISIONES')", []));
  const [pend] = await db.q("SELECT COUNT(*) AS n, COALESCE(SUM(abono - cargo),0) AS s FROM edocta_lineas WHERE estado = 'pendiente'");
  return {
    saldo_clientes: aPesos(tot(cli, -1)),
    saldo_proveedores: aPesos(tot(prov)),
    no_identificado: aPesos(tot(noid, -1)),
    utilidad_comisiones_mes: aPesos(comisionesMes),
    utilidad_comisiones_total: aPesos(comisionesTotal),
    edocta_pendientes: { lineas: Number(pend.n), monto: aPesos(Number(pend.s)) },
  };
}

/** Parte de cajas (solo administrador): existencias consolidadas, utilidad cambiaria, gastos y utilidad neta. */
export async function resumenCajas(db) {
  const mes = rangoMes();
  const inv = await db.q('SELECT moneda, SUM(cantidad) AS q, SUM(costo) AS c FROM inventario GROUP BY moneda');
  const existencias = Object.fromEntries(MONEDAS.map((m) => [m, { cantidad: 0, costo: 0 }]));
  for (const r of inv) existencias[r.moneda] = { cantidad: aPesos(Number(r.q)), costo: aPesos(Number(r.c)) };
  const valor = MONEDAS.reduce((a, m) => a + Math.round((m === 'MXN' ? existencias[m].cantidad : existencias[m].costo) * 100), 0);
  const cambiariaMes = -(await sumaCuentas(db, "k.codigo = 'ING:CAMBIARIA'", [], mes));
  const gastosMes = await sumaCuentas(db, "(k.codigo LIKE 'GASTO:%' OR k.codigo = 'AJ:CORTE')", [], mes);
  const comisionesMes = -(await sumaCuentas(db, "k.codigo IN ('ING:COMISIONES','COSTO:COMISIONES')", [], mes));
  const comisionesTotal = -(await sumaCuentas(db, "k.codigo IN ('ING:COMISIONES','COSTO:COMISIONES')", []));
  const retiros = await db.q("SELECT datos FROM asientos WHERE tipo = 'retiro_utilidad' AND cancela_a IS NULL AND cancelado_por IS NULL");
  const retirado = retiros.reduce((a, r) => a + (JSON.parse(r.datos).cantidad || 0), 0);
  const gastosCat = await db.q(
    `SELECT k.nombre, SUM(p.monto) AS s FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id JOIN asientos a ON a.id = p.asiento_id
      WHERE k.codigo LIKE 'GASTO:%' AND a.fecha_operacion >= ? AND a.fecha_operacion < ? GROUP BY k.nombre ORDER BY s DESC`, mes);
  return {
    existencias, valor_total: aPesos(valor),
    utilidad_cambiaria_mes: aPesos(cambiariaMes),
    gastos_mes: aPesos(gastosMes),
    utilidad_neta_mes: aPesos(comisionesMes + cambiariaMes - gastosMes),
    comisiones_por_ingresar: aPesos(comisionesTotal - retirado),
    gastos_por_categoria: gastosCat.map((g) => ({ categoria: g.nombre.replace(/^Gasto · /, ''), monto: aPesos(Number(g.s)) })),
  };
}

/** Comprobación contable: todo debe sumar cero por moneda y las existencias deben cuadrar con las cuentas de caja. */
export async function verificarLibro(db) {
  const desc = await db.q('SELECT moneda, SUM(monto) AS s FROM partidas GROUP BY moneda HAVING SUM(monto) <> 0');
  const inv = await db.q(
    `SELECT i.caja_id, i.moneda, i.cantidad, COALESCE((SELECT SUM(p.monto) FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id WHERE k.codigo = CONCAT('CAJA:', i.caja_id, ':', i.moneda)),0) AS libro
       FROM inventario i`);
  const malos = inv.filter((r) => Number(r.cantidad) !== Number(r.libro));
  const costos = await db.q(
    `SELECT i.caja_id, i.moneda, i.cantidad, i.costo, COALESCE((SELECT SUM(p.monto) FROM partidas p JOIN cuentas k ON k.id = p.cuenta_id WHERE k.codigo = CONCAT('CONTRA:', i.caja_id, ':', i.moneda)),0) AS libro
       FROM inventario i WHERE i.moneda <> 'MXN'`);
  const costosMalos = costos.filter((r) => Number(r.costo) !== Number(r.libro) || (Number(r.cantidad) === 0 && Number(r.costo) !== 0));
  return { cuadra: !desc.length && !malos.length && !costosMalos.length, descuadres_moneda: desc, inventario_vs_libro: malos, costo_vs_libro: costosMalos };
}
