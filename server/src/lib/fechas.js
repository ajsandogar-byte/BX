import { config } from '../config.js';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Reloj del sistema (se puede fijar en pruebas). */
export const reloj = { ahora: () => new Date() };

/** Fecha (YYYY-MM-DD) y minutos del día en Ciudad de México. */
export function ahoraMx(fecha = reloj.ahora()) {
  const p = Object.fromEntries(fmt.formatToParts(fecha).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

export function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Día de operación: después de la hora de corte (16:30) se registra al día siguiente. */
export function fechaOperacionBase(ahora = reloj.ahora()) {
  const { fecha, minutos } = ahoraMx(ahora);
  return minutos >= config.corteMinutos ? sumarDias(fecha, 1) : fecha;
}

/** Marca de tiempo UTC para columnas DATETIME. */
export const marca = (d = reloj.ahora()) => d.toISOString().slice(0, 19).replace('T', ' ');

export const esFecha = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

/** Rango [desde, hasta) del mes actual (o del mes YYYY-MM dado). */
export function rangoMes(mes = ahoraMx().fecha.slice(0, 7)) {
  const [y, m] = mes.split('-').map(Number);
  const sig = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${mes}-01`, `${sig}-01`];
}
