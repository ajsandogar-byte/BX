// Clientes: saldos, alta/edición y estado de cuenta.
import { useEffect, useState } from 'react';
import { useDatos, post, patch } from '../api.js';
import { dinero, pct, MODALIDAD } from '../formato.js';
import { Campo, Dialogo, Estado, useAviso } from '../ui.jsx';
import { EstadoDeCuenta } from './EstadoDeCuenta.jsx';

export function Clientes() {
  const clientes = useDatos('/clientes');
  const [sel, setSel] = useState(null);
  const [editar, setEditar] = useState(null); // null cerrado, {} nuevo, {…} edición
  const [filtro, setFiltro] = useState('');
  const [atiende, setAtiende] = useState('');
  const lista = (clientes.data || []).filter((c) =>
    (!filtro || c.nombre.toLowerCase().includes(filtro.toLowerCase())) && (!atiende || String(c.atiende_id ?? '') === atiende));
  const personas = [...new Map((clientes.data || []).filter((c) => c.atiende_id).map((c) => [c.atiende_id, c.atiende])).entries()];
  const cliente = (clientes.data || []).find((c) => c.id === sel);

  return (
    <>
      <div className="cabeza"><h1>Clientes</h1><button className="btn primary" type="button" onClick={() => setEditar({})}>+ Cliente</button></div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-h">
            <h2>Saldos</h2>
            <div className="filtros">
              <input type="search" id="buscar-cliente" placeholder="Buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Buscar cliente" />
              <select id="filtro-atiende" value={atiende} onChange={(e) => setAtiende(e.target.value)} aria-label="Quién atiende">
                <option value="">Todos</option>{personas.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </div>
          </div>
          <Estado cargando={clientes.cargando && !clientes.data} error={clientes.error} vacio={!clientes.data?.length && 'Aún no hay clientes. Agrega el primero con “+ Cliente”.'}>
            <div className="tscroll">
              <table>
                <thead><tr><th>Cliente</th><th>Atiende</th><th className="n">% base</th><th className="n">Depositado mes</th><th className="n">Saldo</th><th></th></tr></thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.id} className={'click' + (c.id === sel ? ' sel' : '')} tabIndex={0} onClick={() => setSel(c.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(c.id)}>
                      <td>{c.nombre} <span className="pill borde">{MODALIDAD[c.modalidad]}</span>{!c.activo && <span className="pill">Inactivo</span>}{c.saldo < 0 && <span className="pill mal">Nos debe</span>}</td>
                      <td className={c.atiende ? '' : 'mut'}>{c.atiende || 'Sin asignar'}</td>
                      <td className="n mut">{pct(c.comision_base)}</td>
                      <td className="n">{dinero(c.depositado_mes)}</td>
                      <td className={'n ' + (c.saldo < 0 ? 'neg' : c.saldo > 0 ? 'pos' : 'mut')}>{dinero(c.saldo)}</td>
                      <td className="acts"><button className="btn sm" type="button" onClick={(e) => { e.stopPropagation(); setEditar(c); }}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Estado>
        </div>
        <div className="panel">
          {cliente
            ? <EstadoDeCuenta titulo={`Estado de cuenta · ${cliente.nombre}`} ruta={`/clientes/${cliente.id}/estado-cuenta`} saldo={cliente.saldo} otro="proveedor" />
            : <div className="empty">Elige un cliente para ver su estado de cuenta.</div>}
        </div>
      </div>
      <FormCliente cliente={editar} onCerrar={() => setEditar(null)} onHecho={clientes.recargar} />
    </>
  );
}

function FormCliente({ cliente, onCerrar, onHecho }) {
  const atienden = useDatos(cliente ? '/usuarios/atienden' : null);
  const [f, setF] = useState({});
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  useEffect(() => {
    if (cliente) setF({ nombre: cliente.nombre || '', comision_base: cliente.comision_base ?? '', modalidad: cliente.modalidad || 'NA', atiende_id: cliente.atiende_id ?? '', notas: cliente.notas || '', activo: cliente.activo ?? true });
    setError('');
  }, [cliente]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function enviar() {
    setOcupado(true); setError('');
    const d = { ...f, atiende_id: f.atiende_id ? Number(f.atiende_id) : null };
    try {
      if (cliente.id) await patch(`/clientes/${cliente.id}`, d); else await post('/clientes', d);
      avisar('Cliente guardado'); onHecho(); onCerrar();
    } catch (er) { setError(er.message); }
    finally { setOcupado(false); }
  }
  return (
    <Dialogo abierto={!!cliente} onCerrar={onCerrar} titulo={cliente?.id ? 'Editar cliente' : 'Nuevo cliente'} onEnviar={enviar} ocupado={ocupado} error={error}>
      <Campo etiqueta="Nombre"><input id="cli-nombre" value={f.nombre || ''} onChange={set('nombre')} autoFocus /></Campo>
      <div className="row">
        <Campo etiqueta="% base que le cobramos" hint="Se carga solo en cada depósito; se puede cambiar por operación.">
          <input id="cli-comision" className="num" inputMode="decimal" value={f.comision_base ?? ''} onChange={set('comision_base')} />
        </Campo>
        <Campo etiqueta="Modalidad">
          <select id="cli-modalidad" value={f.modalidad || 'NA'} onChange={set('modalidad')}><option value="NA">N/A</option><option value="CF">C/F</option></select>
        </Campo>
      </div>
      <Campo etiqueta="Lo atiende" hint="Usuarios con rol de Administrador de cuentas o Administrador.">
        <select id="cli-atiende" value={f.atiende_id ?? ''} onChange={set('atiende_id')}>
          <option value="">Sin asignar</option>{(atienden.data || []).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Notas"><textarea id="cli-notas" rows={2} value={f.notas || ''} onChange={set('notas')} /></Campo>
      {cliente?.id && <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!f.activo} onChange={set('activo')} /> Activo (un cliente inactivo no puede tener operaciones nuevas)</label>}
    </Dialogo>
  );
}
