export const MONEDAS = ['MXN', 'USD', 'EUR', 'CAD', 'GBP'];
export const NOMBRE_MONEDA = { MXN: 'Pesos', USD: 'Dólares', EUR: 'Euros', CAD: 'Dólares canadienses', GBP: 'Libras' };
export const MODALIDAD = { NA: 'N/A', CF: 'C/F' };

const fmts = {};
/** Formatea dinero; en pesos con símbolo, en divisas con el código (USD 1,200.00). */
export function dinero(n, moneda = 'MXN') {
  fmts[moneda] ||= new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda, currencyDisplay: moneda === 'MXN' ? 'symbol' : 'code' });
  return fmts[moneda].format(Number(n) || 0);
}
export const pct = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Math.round(Number(n) * 1000) / 1000}%`);
export const tc = (n) => (n == null ? '—' : Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
export const fechaCorta = (f) => (f ? new Date(f.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');

/** Lee lo que escribió el usuario: "1,234.50" → 1234.5. NaN si no es número. */
export function numero(s) {
  const x = parseFloat(String(s ?? '').replace(/[,$\s]/g, ''));
  return Number.isFinite(x) ? x : NaN;
}

/** Hoy en Ciudad de México (YYYY-MM-DD). */
export function hoyMx() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export const TIPOS = {
  deposito: ['Depósito', 'ok'], pago: ['Pago', 'mal'], ajuste: ['Ajuste', 'aviso'], saldo_inicial: ['Saldo inicial', ''],
  compra: ['Compra', 'ok'], venta: ['Venta', 'mal'], entrada: ['Entrada', 'ok'], salida: ['Salida', 'mal'], gasto: ['Gasto', 'aviso'],
  traspaso: ['Traspaso', ''], retiro_utilidad: ['Utilidad a caja', 'fuerte'], ajuste_corte: ['Ajuste de corte', 'aviso'],
};

/** Primer y último día (YYYY-MM-DD) de un mes YYYY-MM. */
export function rangoDeMes(mes) {
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${mes}-01`, `${mes}-${String(ultimo).padStart(2, '0')}`];
}
