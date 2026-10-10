// Entrada, sesión y navegación. Cada rol solo ve sus secciones (el servidor también lo valida).
import { useEffect, useState } from 'react';
import { get, post } from './api.js';
import { Campo } from './ui.jsx';
import { Resumen } from './paginas/Resumen.jsx';
import { Cajas } from './paginas/Cajas.jsx';
import { Clientes } from './paginas/Clientes.jsx';
import { Proveedores } from './paginas/Proveedores.jsx';
import { Operaciones } from './paginas/Operaciones.jsx';
import { Usuarios } from './paginas/Usuarios.jsx';

const SECCIONES = [
  { id: 'resumen', nombre: 'Resumen', roles: ['admin', 'cuentas'], C: Resumen },
  { id: 'cajas', nombre: 'Cajas', roles: ['admin', 'supervisor', 'cajero'], C: Cajas },
  { id: 'operaciones', nombre: 'Operaciones', roles: ['admin', 'cuentas'], C: Operaciones },
  { id: 'clientes', nombre: 'Clientes', roles: ['admin', 'cuentas'], C: Clientes },
  { id: 'proveedores', nombre: 'Proveedores', roles: ['admin', 'cuentas'], C: Proveedores },
  { id: 'usuarios', nombre: 'Usuarios', roles: ['admin'], C: Usuarios },
];

function useHash() {
  const [h, setH] = useState(() => location.hash.slice(2));
  useEffect(() => {
    const f = () => setH(location.hash.slice(2));
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

export function App() {
  const [yo, setYo] = useState(undefined); // undefined = cargando, null = sin sesión
  const hash = useHash();

  const cargarYo = () => get('/auth/yo').then(setYo, () => setYo(null));
  useEffect(() => {
    cargarYo();
    const f = () => setYo(null);
    addEventListener('bx:sin-sesion', f);
    return () => removeEventListener('bx:sin-sesion', f);
  }, []);

  if (yo === undefined) return <div className="login"><p className="mut">Cargando…</p></div>;
  if (yo === null) return <Entrar onListo={cargarYo} />;
  if (yo.debe_cambiar_password) return <CambiarPassword yo={yo} onListo={cargarYo} />;

  const mias = SECCIONES.filter((s) => s.roles.includes(yo.rol));
  const [id, ...resto] = hash.split('/');
  const actual = mias.find((s) => s.id === id) || mias[0];
  const salir = async () => { await post('/auth/logout').catch(() => {}); setYo(null); location.hash = ''; };

  return (
    <>
      <header className="top">
        <div className="wrap">
          <div className="bar">
            <div className="brand">BX<small>Saldos, cajas y cortes</small></div>
            <div className="yo"><b>{yo.nombre}</b><br />{yo.rol_nombre}{yo.caja ? ` · ${yo.caja.nombre}` : ''}</div>
            <button className="btn sm" type="button" onClick={salir}>Salir</button>
          </div>
          <nav className="tabs" aria-label="Secciones">
            {mias.map((s) => <a key={s.id} href={`#/${s.id}`} aria-current={s.id === actual.id ? 'page' : undefined}>{s.nombre}</a>)}
          </nav>
        </div>
      </header>
      <main className="wrap">
        <actual.C yo={yo} ruta={resto} />
      </main>
    </>
  );
}

function Entrar({ onListo }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function enviar(e) {
    e.preventDefault(); setOcupado(true); setError('');
    try { await post('/auth/login', { usuario, password }); onListo(); }
    catch (er) { setError(er.message); }
    finally { setOcupado(false); }
  }
  return (
    <div className="login">
      <form onSubmit={enviar} noValidate>
        <div><h1>BX</h1><p className="hint" style={{ margin: '4px 0 0' }}>Entra con tu usuario.</p></div>
        <Campo etiqueta="Usuario"><input id="usuario" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus /></Campo>
        <Campo etiqueta="Contraseña"><input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
        <div className="err">{error}</div>
        <button className="btn primary" type="submit" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function CambiarPassword({ yo, onListo }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [otra, setOtra] = useState('');
  const [error, setError] = useState('');
  async function enviar(e) {
    e.preventDefault(); setError('');
    if (nueva !== otra) return setError('Las dos contraseñas nuevas no coinciden.');
    try { await post('/auth/password', { actual, nueva }); onListo(); }
    catch (er) { setError(er.message); }
  }
  return (
    <div className="login">
      <form onSubmit={enviar} noValidate>
        <div><h1>Hola, {yo.nombre}</h1><p className="hint" style={{ margin: '4px 0 0' }}>Antes de empezar, cambia la contraseña temporal que te dieron. Usa al menos 10 caracteres con letras y números.</p></div>
        <Campo etiqueta="Contraseña temporal"><input id="pw-actual" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} autoFocus /></Campo>
        <Campo etiqueta="Nueva contraseña"><input id="pw-nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} /></Campo>
        <Campo etiqueta="Repite la nueva contraseña"><input id="pw-otra" type="password" autoComplete="new-password" value={otra} onChange={(e) => setOtra(e.target.value)} /></Campo>
        <div className="err">{error}</div>
        <button className="btn primary" type="submit">Guardar y entrar</button>
      </form>
    </div>
  );
}
