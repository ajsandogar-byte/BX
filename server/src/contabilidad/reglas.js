// Reglas contables: cada función recibe datos ya validados (montos en centavos) y devuelve
//   partidas:   [{ cuenta, moneda, monto }]  (cuadran por moneda)
//   inventario: [{ caja_id, moneda, cantidad, costo }]  (cambios en la existencia de cada caja)
// Son funciones puras: no tocan la base de datos, así se pueden probar solas.
import { C } from './cuentas.js';
import { comision } from '../lib/dinero.js';

const p = (cuenta, monto) => ({ cuenta, moneda: cuenta.moneda, monto });
const inv = (caja_id, moneda, cantidad, costo = 0) => ({ caja_id, moneda, cantidad, costo });

/** Movimiento físico de una caja: actualiza caja + posición/costo cuando es divisa. */
function efectivo(cajaId, moneda, cantidad, costo, contraCuenta) {
  // cantidad > 0 entra a caja, < 0 sale. costo en pesos (mismo signo que cantidad) solo para divisas.
  if (moneda === 'MXN') {
    return { partidas: [p(C.caja(cajaId, 'MXN'), cantidad), p(contraCuenta, -cantidad)], inventario: [inv(cajaId, 'MXN', cantidad)] };
  }
  return {
    partidas: [
      p(C.caja(cajaId, moneda), cantidad), p(C.posicion(cajaId, moneda), -cantidad),
      p(C.contravalor(cajaId, moneda), costo), p(contraCuenta, -costo),
    ],
    inventario: [inv(cajaId, moneda, cantidad, costo)],
  };
}

export const reglas = {
  // ---------- Clientes y proveedores (pesos) ----------
  deposito({ clienteId, proveedorId, monto, pctCliente, pctProveedor }) {
    const comCli = comision(monto, pctCliente), comProv = comision(monto, pctProveedor);
    return {
      partidas: [
        p(C.proveedor(proveedorId), monto - comProv),
        p(C.costoComisiones(), comProv),
        p(C.cliente(clienteId), -(monto - comCli)),
        p(C.ingresoComisiones(), -comCli),
      ],
      inventario: [],
      resumen: { abonoCliente: monto - comCli, abonoProveedor: monto - comProv, utilidad: comCli - comProv },
    };
  },
  pago({ clienteId, proveedorId, monto }) {
    return { partidas: [p(C.cliente(clienteId), monto), p(C.proveedor(proveedorId), -monto)], inventario: [] };
  },
  /** monto > 0 aumenta el saldo a favor del cliente. */
  ajusteCliente({ clienteId, monto }) {
    return { partidas: [p(C.cliente(clienteId), -monto), p(C.ajusteSaldos(), monto)], inventario: [] };
  },
  /** monto > 0 aumenta lo que tenemos con el proveedor. */
  ajusteProveedor({ proveedorId, monto }) {
    return { partidas: [p(C.proveedor(proveedorId), monto), p(C.ajusteSaldos(), -monto)], inventario: [] };
  },
  inicialCliente({ clienteId, monto }) {
    return { partidas: [p(C.cliente(clienteId), -monto), p(C.capitalInicial(), monto)], inventario: [] };
  },
  inicialProveedor({ proveedorId, monto }) {
    return { partidas: [p(C.proveedor(proveedorId), monto), p(C.capitalInicial(), -monto)], inventario: [] };
  },
  /** Abono en estado de cuenta de un proveedor interno sin cliente identificado. */
  noIdentificado({ proveedorId, monto, pctProveedor }) {
    const com = comision(monto, pctProveedor);
    return {
      partidas: [p(C.proveedor(proveedorId), monto - com), p(C.costoComisiones(), com), p(C.noIdentificado(proveedorId), -monto)],
      inventario: [],
    };
  },
  /** Cargo en estado de cuenta sin cliente identificado. */
  cargoNoIdentificado({ proveedorId, monto }) {
    return { partidas: [p(C.noIdentificado(proveedorId), monto), p(C.proveedor(proveedorId), -monto)], inventario: [] };
  },

  // ---------- Cajas ----------
  /** Compra de divisa: entra divisa, salen pesos. mxn = cantidad * tc. */
  compra({ cajaId, moneda, cantidad, mxn }) {
    return {
      partidas: [
        p(C.caja(cajaId, moneda), cantidad), p(C.posicion(cajaId, moneda), -cantidad),
        p(C.contravalor(cajaId, moneda), mxn), p(C.caja(cajaId, 'MXN'), -mxn),
      ],
      inventario: [inv(cajaId, moneda, cantidad, mxn), inv(cajaId, 'MXN', -mxn)],
    };
  },
  /** Venta de divisa: sale divisa a su costo promedio, entran pesos; la diferencia es utilidad cambiaria. */
  venta({ cajaId, moneda, cantidad, mxn, costo }) {
    return {
      partidas: [
        p(C.caja(cajaId, moneda), -cantidad), p(C.posicion(cajaId, moneda), cantidad),
        p(C.caja(cajaId, 'MXN'), mxn), p(C.contravalor(cajaId, moneda), -costo),
        p(C.utilidadCambiaria(), -(mxn - costo)),
      ],
      inventario: [inv(cajaId, moneda, -cantidad, -costo), inv(cajaId, 'MXN', mxn)],
      resumen: { utilidad: mxn - costo },
    };
  },
  /** Entrada de efectivo. contraparte: { clienteId } | { proveedorId } | null. costo solo para divisa. */
  entrada({ cajaId, moneda, cantidad, costo = 0, contraparte }) {
    const contra = contraparte?.clienteId ? C.cliente(contraparte.clienteId)
      : contraparte?.proveedorId ? C.proveedor(contraparte.proveedorId) : C.otrasEntradas();
    return efectivo(cajaId, moneda, cantidad, costo, contra);
  },
  salida({ cajaId, moneda, cantidad, costo = 0, contraparte }) {
    const contra = contraparte?.clienteId ? C.cliente(contraparte.clienteId)
      : contraparte?.proveedorId ? C.proveedor(contraparte.proveedorId) : C.otrasSalidas();
    return efectivo(cajaId, moneda, -cantidad, -costo, contra);
  },
  gasto({ cajaId, moneda, cantidad, costo = 0, categoria }) {
    return efectivo(cajaId, moneda, -cantidad, -costo, C.gasto(categoria));
  },
  /** Pasar a caja comisiones ganadas que estaban con un proveedor. */
  retiroUtilidad({ cajaId, proveedorId, monto }) {
    return efectivo(cajaId, 'MXN', monto, 0, C.proveedor(proveedorId));
  },
  inicialCaja({ cajaId, moneda, cantidad, costo = 0 }) {
    return efectivo(cajaId, moneda, cantidad, costo, C.capitalInicial());
  },
  /** Diferencia de corte: dif > 0 sobrante, < 0 faltante. costo con el mismo signo (divisas). */
  ajusteCorte({ cajaId, moneda, diferencia, costo = 0 }) {
    return efectivo(cajaId, moneda, diferencia, costo, C.ajusteCorte());
  },
  /** Traspaso entre cajas. La divisa viaja con su costo. */
  traspaso({ origenId, destinoId, moneda, cantidad, costo = 0 }) {
    const partidas = [p(C.caja(origenId, moneda), -cantidad), p(C.caja(destinoId, moneda), cantidad)];
    if (moneda !== 'MXN') {
      partidas.push(
        p(C.posicion(origenId, moneda), cantidad), p(C.posicion(destinoId, moneda), -cantidad),
        p(C.contravalor(origenId, moneda), -costo), p(C.contravalor(destinoId, moneda), costo),
      );
    }
    return { partidas, inventario: [inv(origenId, moneda, -cantidad, -costo), inv(destinoId, moneda, cantidad, costo)] };
  },
};

/** Verifica que las partidas cuadren por moneda. Lanza si no. */
export function verificarCuadre(partidas) {
  const suma = {};
  for (const x of partidas) {
    if (!Number.isInteger(x.monto)) throw new Error(`Monto no entero en ${x.cuenta.codigo}`);
    suma[x.moneda] = (suma[x.moneda] || 0) + x.monto;
  }
  for (const [m, s] of Object.entries(suma)) if (s !== 0) throw new Error(`El asiento no cuadra en ${m}: ${s}`);
}

/** Asiento contrario para cancelar: mismas partidas e inventario con signo invertido. */
export function invertir({ partidas, inventario }) {
  return {
    partidas: partidas.map((x) => ({ ...x, monto: -x.monto })),
    inventario: inventario.map((x) => ({ ...x, cantidad: -x.cantidad, costo: -x.costo })),
  };
}
