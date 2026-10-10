// Cliente de la API: manda la cabecera de protección y convierte errores en mensajes claros.
import { useCallback, useEffect, useState } from 'react';

export class ErrorApi extends Error {
  constructor(mensaje, status, codigo) { super(mensaje); this.status = status; this.codigo = codigo; }
}

export async function api(metodo, ruta, cuerpo) {
  let res;
  try {
    res = await fetch('/api' + ruta, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-bx': '1' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi('No hay conexión con el servidor. Revisa tu red e intenta de nuevo.', 0, 'red');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && ruta !== '/auth/login') window.dispatchEvent(new Event('bx:sin-sesion'));
    throw new ErrorApi(data?.error || 'Ocurrió un error. Intenta de nuevo.', res.status, data?.codigo);
  }
  return data;
}
export const get = (r) => api('GET', r);
export const post = (r, c = {}) => api('POST', r, c);
export const patch = (r, c = {}) => api('PATCH', r, c);

/** Carga datos de una ruta; `recargar()` vuelve a pedirlos. Con ruta null no carga nada. */
export function useDatos(ruta) {
  const [estado, setEstado] = useState({ data: null, error: null, cargando: !!ruta });
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    if (!ruta) { setEstado({ data: null, error: null, cargando: false }); return; }
    let vivo = true;
    setEstado((e) => ({ ...e, cargando: true }));
    get(ruta).then(
      (data) => vivo && setEstado({ data, error: null, cargando: false }),
      (error) => vivo && setEstado({ data: null, error, cargando: false }),
    );
    return () => { vivo = false; };
  }, [ruta, vuelta]);
  const recargar = useCallback(() => setVuelta((v) => v + 1), []);
  return { ...estado, recargar };
}
