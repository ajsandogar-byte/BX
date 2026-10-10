// Todo el dinero se maneja en centavos enteros.

export const MONEDAS = ['MXN', 'USD', 'EUR', 'CAD', 'GBP'];
export const DIVISAS = MONEDAS.filter((m) => m !== 'MXN');

/** Convierte "1,234.56", 1234.56 o "-50" a centavos. Devuelve NaN si no es válido. */
export function aCentavos(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) : NaN;
  if (typeof valor !== 'string') return NaN;
  const s = valor.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const neg = s.startsWith('-');
  const [ent, dec = ''] = s.replace('-', '').split('.');
  const c = Number(ent) * 100 + Number((dec + '00').slice(0, 2));
  return neg ? -c : c;
}

/** Centavos a número con 2 decimales (para JSON). */
export const aPesos = (c) => Math.round(c) / 100;

/** Comisión en centavos: monto * pct / 100, redondeado al centavo. */
export const comision = (montoCent, pct) => Math.round((montoCent * pct) / 100);

/** Cantidad de divisa (centavos) por tipo de cambio = pesos (centavos). */
export const contravalor = (cantidadCent, tc) => Math.round(cantidadCent * tc);

/** Costo proporcional al sacar `q` de una existencia `cantidad` con costo total `costo`. */
export function costoSalida(q, cantidad, costo) {
  if (q === cantidad) return costo;
  if (cantidad <= 0) return 0;
  return Math.round((costo * q) / cantidad);
}
