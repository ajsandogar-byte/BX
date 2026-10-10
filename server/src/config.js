// Configuración desde variables de entorno (ver .env.example).
const env = process.env;
const [h, m] = (env.HORA_CORTE || '16:30').split(':').map(Number);

export const config = {
  puerto: Number(env.PUERTO || 3000),
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PUERTO || 3306),
    user: env.DB_USUARIO || 'bx',
    password: env.DB_PASSWORD || '',
    database: env.DB_NOMBRE || 'bx',
  },
  // Cookie segura solo si se sirve por HTTPS.
  cookieSegura: env.COOKIE_SEGURA === '1',
  horasSesion: Number(env.HORAS_SESION || 12),
  corteMinutos: h * 60 + (m || 0),
  carpetaWeb: env.CARPETA_WEB || null,
};
