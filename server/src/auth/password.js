import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const PARAMS = { N: 16384, r: 8, p: 1 };

/** Guarda la contraseña cifrada con scrypt (incluido en Node, sin dependencias). */
export async function cifrar(password) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(password, sal, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificar(password, guardado) {
  const [alg, N, r, p, sal, hash] = String(guardado).split('$');
  if (alg !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const calc = await scryptAsync(password, Buffer.from(sal, 'base64'), esperado.length, { N: Number(N), r: Number(r), p: Number(p) });
  return calc.length === esperado.length && timingSafeEqual(calc, esperado);
}

export function validarNueva(password) {
  if (typeof password !== 'string' || password.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La contraseña debe tener letras y números.';
  return null;
}

/** Contraseña temporal legible para dar de alta usuarios. */
export function temporal() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = randomBytes(12);
  let s = '';
  for (const x of b) s += abc[x % abc.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '7';
}
