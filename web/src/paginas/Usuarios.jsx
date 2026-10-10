// Usuarios (solo administrador): alta con contraseña temporal, rol, caja, activar/desactivar.
import { useState } from 'react';
import { useDatos, post, patch } from '../api.js';
import { Campo, Dialogo, Estado, useAviso } from '../ui.jsx';

const ROLES = { admin: 'Administrador', cuentas: 'Administrador de cuentas', supervisor: 'Supervisor de sucursales', cajero: 'Cajero' };
const DESCRIPCION = {
  admin: 'Todo, incluidos usuarios, sucursales y saldos iniciales.',
  cuentas: 'Clientes, proveedores y operaciones. No ve cajas.',
  supervisor: 'Las cajas de las sucursales (no la matriz). Puede reabrir cortes.',
  cajero: 'Solo su caja: opera y hace su corte.',
};

export function Usuarios({ yo }) {
  const usuarios = useDatos('/usuarios');
  const cajas = useDatos('/cajas/destinos');
  const [nuevo, setNuevo] = useState(false);
  const [secreto, setSecreto] = useState(null);
  const avisar = useAviso();

  async function cambiar(u, cambios) {
    try { await patch(`/usuarios/${u.id}`, cambios); avisar('Usuario actualizado'); usuarios.recargar(); }
    catch (e) { avisar(e.message, true); usuarios.recargar(); }
  }
  async function restablecer(u) {
    try { const r = await post(`/usuarios/${u.id}/restablecer`); setSecreto({ nombre: u.nombre, usuario: u.usuario, pass: r.passwordTemporal }); }
    catch (e) { avisar(e.message, true); }
  }

  return (
    <>
      <div className="cabeza"><h1>Usuarios</h1><button className="btn primary" type="button" onClick={() => setNuevo(true)}>+ Usuario</button></div>
      <div className="panel">
        <Estado cargando={usuarios.cargando && !usuarios.data} error={usuarios.error}>
          <div className="tscroll">
            <table>
              <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Caja</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
              <tbody>
                {(usuarios.data || []).map((u) => (
                  <tr key={u.id} className={u.activo ? '' : 'cancelado'}>
                    <td>{u.nombre}{u.id === yo.id && <span className="pill">Tú</span>}</td>
                    <td className="d">{u.usuario}</td>
                    <td>
                      <select aria-label={`Rol de ${u.nombre}`} value={u.rol} style={{ width: 'auto', padding: '4px 8px', fontSize: 14 }}
                        onChange={(e) => cambiar(u, { rol: e.target.value, caja_id: e.target.value === 'cajero' ? (u.caja_id || cajas.data?.[0]?.id) : null })}>
                        {Object.entries(ROLES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                      </select>
                    </td>
                    <td>
                      {u.rol === 'cajero'
                        ? <select aria-label={`Caja de ${u.nombre}`} value={u.caja_id ?? ''} style={{ width: 'auto', padding: '4px 8px', fontSize: 14 }} onChange={(e) => cambiar(u, { caja_id: Number(e.target.value) })}>
                            {(cajas.data || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                          </select>
                        : <span className="mut">{u.rol === 'supervisor' ? 'Todas las sucursales' : '—'}</span>}
                    </td>
                    <td>{u.activo ? (u.debe_cambiar_password ? <span className="pill aviso">Contraseña temporal</span> : <span className="pill ok">Activo</span>) : <span className="pill">Inactivo</span>}</td>
                    <td className="d">{u.ultimo_acceso ? new Date(u.ultimo_acceso.replace(' ', 'T') + 'Z').toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'}</td>
                    <td className="acts">
                      <button className="btn sm" type="button" onClick={() => restablecer(u)}>Nueva contraseña</button>
                      {u.id !== yo.id && <button className={'btn sm' + (u.activo ? ' danger' : '')} type="button" onClick={() => cambiar(u, { activo: !u.activo })}>{u.activo ? 'Desactivar' : 'Activar'}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Estado>
        <p className="hint" style={{ padding: '12px 16px', margin: 0 }}>Al cambiar el rol, la caja o desactivar a alguien, se cierra su sesión para que vuelva a entrar con los permisos nuevos.</p>
      </div>
      <FormUsuario abierto={nuevo} cajas={cajas.data || []} onCerrar={() => setNuevo(false)} onHecho={(s) => { usuarios.recargar(); setSecreto(s); }} />
      <Dialogo abierto={!!secreto} onCerrar={() => setSecreto(null)} titulo="Contraseña temporal">
        {secreto && (
          <>
            <p style={{ margin: 0 }}>Entrégale estos datos a <b>{secreto.nombre}</b>. La contraseña solo se muestra esta vez; al entrar, el sistema le pedirá cambiarla.</p>
            <div><span className="eyebrow">Usuario</span><div className="secreto">{secreto.usuario}</div></div>
            <div><span className="eyebrow">Contraseña temporal</span><div className="secreto" id="pass-temporal">{secreto.pass}</div></div>
            <div className="acciones"><button className="btn primary" type="button" onClick={() => setSecreto(null)}>Listo</button></div>
          </>
        )}
      </Dialogo>
    </>
  );
}

function FormUsuario({ abierto, cajas, onCerrar, onHecho }) {
  const [f, setF] = useState({ nombre: '', usuario: '', rol: 'cajero', caja_id: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function enviar() {
    setError('');
    try {
      const r = await post('/usuarios', { ...f, caja_id: f.rol === 'cajero' && f.caja_id ? Number(f.caja_id) : null });
      onHecho({ nombre: f.nombre, usuario: f.usuario.toLowerCase(), pass: r.passwordTemporal });
      setF({ nombre: '', usuario: '', rol: 'cajero', caja_id: '' });
      onCerrar();
    } catch (er) { setError(er.message); }
  }
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Nuevo usuario" onEnviar={enviar} enviarTexto="Crear usuario" error={error}>
      <div className="row">
        <Campo etiqueta="Nombre completo"><input id="u-nombre" value={f.nombre} onChange={set('nombre')} autoFocus /></Campo>
        <Campo etiqueta="Usuario para entrar" hint="Letras, números, punto o guion."><input id="u-usuario" value={f.usuario} onChange={set('usuario')} autoCapitalize="none" /></Campo>
      </div>
      <Campo etiqueta="Rol" hint={DESCRIPCION[f.rol]}>
        <select id="u-rol" value={f.rol} onChange={set('rol')}>{Object.entries(ROLES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      </Campo>
      {f.rol === 'cajero' && (
        <Campo etiqueta="Su caja">
          <select id="u-caja" value={f.caja_id} onChange={set('caja_id')}><option value="">— Elige —</option>{cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        </Campo>
      )}
    </Dialogo>
  );
}
