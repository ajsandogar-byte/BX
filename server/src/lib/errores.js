/** Error con mensaje para el usuario y código HTTP. */
export class ErrorApp extends Error {
  constructor(status, mensaje, codigo = 'error') {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

export const noValido = (msg) => new ErrorApp(400, msg, 'no_valido');
export const sinAcceso = (msg = 'No tienes permiso para hacer esto.') => new ErrorApp(403, msg, 'sin_acceso');
export const noEncontrado = (msg = 'No se encontró.') => new ErrorApp(404, msg, 'no_encontrado');
export const conflicto = (msg) => new ErrorApp(409, msg, 'conflicto');
