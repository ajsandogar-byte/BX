// Catálogo de cuentas. Cada cuenta se identifica por un código estable y se crea la primera vez que se usa.
// Convención de signos en partidas: positivo = cargo (debe), negativo = abono (haber).
//   Activo/gasto crecen con cargos; pasivo/capital/ingreso crecen con abonos.
import { marca } from '../lib/fechas.js';

const N = { MXN: 'pesos', USD: 'dólares', EUR: 'euros', CAD: 'dólares canadienses', GBP: 'libras' };

export const C = {
  caja: (cajaId, mon) => ({ codigo: `CAJA:${cajaId}:${mon}`, nombre: `Caja ${cajaId} · ${N[mon]}`, naturaleza: 'activo', moneda: mon, caja_id: cajaId }),
  // Posición en unidades de divisa: contrapartida de la existencia física (cuenta de orden).
  posicion: (cajaId, mon) => ({ codigo: `POS:${cajaId}:${mon}`, nombre: `Posición ${mon} caja ${cajaId}`, naturaleza: 'orden', moneda: mon, caja_id: cajaId }),
  // Costo en pesos de la divisa en existencia.
  contravalor: (cajaId, mon) => ({ codigo: `CONTRA:${cajaId}:${mon}`, nombre: `Costo ${mon} caja ${cajaId}`, naturaleza: 'activo', moneda: 'MXN', caja_id: cajaId }),
  cliente: (id) => ({ codigo: `CLI:${id}`, nombre: `Cliente ${id}`, naturaleza: 'pasivo', moneda: 'MXN', cliente_id: id }),
  proveedor: (id) => ({ codigo: `PROV:${id}`, nombre: `Proveedor ${id}`, naturaleza: 'activo', moneda: 'MXN', proveedor_id: id }),
  noIdentificado: (provId) => ({ codigo: `NOID:${provId}`, nombre: `No identificados proveedor ${provId}`, naturaleza: 'pasivo', moneda: 'MXN', proveedor_id: provId }),
  ingresoComisiones: () => ({ codigo: 'ING:COMISIONES', nombre: 'Comisiones cobradas a clientes', naturaleza: 'ingreso', moneda: 'MXN' }),
  costoComisiones: () => ({ codigo: 'COSTO:COMISIONES', nombre: 'Comisiones pagadas a proveedores', naturaleza: 'gasto', moneda: 'MXN' }),
  utilidadCambiaria: () => ({ codigo: 'ING:CAMBIARIA', nombre: 'Utilidad cambiaria', naturaleza: 'ingreso', moneda: 'MXN' }),
  gasto: (categoria) => ({ codigo: `GASTO:${slug(categoria)}`, nombre: `Gasto · ${categoria}`, naturaleza: 'gasto', moneda: 'MXN' }),
  capitalInicial: () => ({ codigo: 'CAP:INICIAL', nombre: 'Saldos iniciales', naturaleza: 'capital', moneda: 'MXN' }),
  ajusteSaldos: () => ({ codigo: 'AJ:SALDOS', nombre: 'Ajustes a saldos', naturaleza: 'gasto', moneda: 'MXN' }),
  ajusteCorte: () => ({ codigo: 'AJ:CORTE', nombre: 'Sobrantes y faltantes de corte', naturaleza: 'gasto', moneda: 'MXN' }),
  otrasEntradas: () => ({ codigo: 'OTRAS:ENTRADAS', nombre: 'Entradas de efectivo sin contraparte', naturaleza: 'capital', moneda: 'MXN' }),
  otrasSalidas: () => ({ codigo: 'OTRAS:SALIDAS', nombre: 'Salidas de efectivo sin contraparte', naturaleza: 'capital', moneda: 'MXN' }),
};

export function slug(s) {
  return String(s).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'OTROS';
}

/** Devuelve el id de la cuenta, creándola si no existe. */
export async function idCuenta(t, spec, cache) {
  if (cache && cache.has(spec.codigo)) return cache.get(spec.codigo);
  let [fila] = await t.q('SELECT id FROM cuentas WHERE codigo = ?', [spec.codigo]);
  if (!fila) {
    try {
      await t.q(
        'INSERT INTO cuentas (codigo, nombre, naturaleza, moneda, caja_id, cliente_id, proveedor_id, creado_en) VALUES (?,?,?,?,?,?,?,?)',
        [spec.codigo, spec.nombre, spec.naturaleza, spec.moneda, spec.caja_id ?? null, spec.cliente_id ?? null, spec.proveedor_id ?? null, marca()],
      );
    } catch (e) {
      // Otra operación simultánea la acaba de crear: se usa esa.
      if (!/duplicate|unique/i.test(String(e.code) + ' ' + e.message)) throw e;
    }
    [fila] = await t.q('SELECT id FROM cuentas WHERE codigo = ?', [spec.codigo]);
  }
  if (cache) cache.set(spec.codigo, fila.id);
  return fila.id;
}
