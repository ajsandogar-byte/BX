import { marca } from './fechas.js';

/** Deja constancia de quién hizo qué. */
export async function bitacora(t, { usuarioId = null, accion, entidad = null, entidadId = null, detalle = null, ip = null }) {
  await t.q(
    'INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle, ip, creado_en) VALUES (?,?,?,?,?,?,?)',
    [usuarioId, accion, entidad, entidadId == null ? null : String(entidadId), detalle ? JSON.stringify(detalle) : null, ip, marca()],
  );
}
