// Proveedores internos y externos: saldos, comisiones N/A y C/F, estado de cuenta.
import { useEffect, useState } from 'react';
import { useDatos, post, patch } from '../api.js';
import { dinero, pct } from '../formato.js';
import { Campo, Dialogo, Estado, useAviso } from '../ui.jsx';
import { EstadoDeCuenta } from './EstadoDeCuenta.jsx';

export function Proveedores() {
  const provs = useDatos('/proveedores');
  const [sel, setSel] = useState(null);
  const [editar, setEditar] = useState(null);
  const lista = provs.data || [];
  const prov = lista.find((p) => p.id === sel);
  const grupos = [['interno', 'Internos'], ['externo', 'Externos']].map(([t, n]) => [n, lista.filter((p) => p.tipo === t)]).filter(([, l]) => l.length);
  return (
    <>
      <div className="cabeza"><h1>Proveedores</h1><button className="btn primary" type="button" onClick={() => setEditar({})}>+ Proveedor</button></div>
      <div className="grid2">
        <div className="panel">
          <div className="panel-h"><h2>Saldos</h2></div>
          <Estado cargando={provs.cargando && !provs.data} error={provs.error} vacio={!lista.length && 'Aún no hay proveedores. Agrega el primero con “+ Proveedor”.'}>
            <div className="tscroll">
              <table>
                <thead><tr><th>Proveedor</th><th className="n">% N/A</th><th className="n">% C/F</th><th className="n">No ident.</th><th className="n">Saldo</th><th></th></tr></thead>
                <tbody>
                  {grupos.map(([nombre, l]) => [
                    <tr key={nombre}><td colSpan={6} className="eyebrow" style={{ background: 'var(--sunk)' }}>{nombre} · total {dinero(l.reduce((a, p) => a + p.saldo, 0))}</td></tr>,
                    ...l.map((p) => (
                      <tr key={p.id} className={'click' + (p.id === sel ? ' sel' : '')} tabIndex={0} onClick={() => setSel(p.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(p.id)}>
                        <td>{p.nombre}{!p.activo && <span className="pill">Inactivo</span>}</td>
                        <td className="n mut">{pct(p.comision_na)}</td>
                        <td className="n mut">{pct(p.comision_cf)}</td>
                        <td className={'n ' + (p.no_identificado ? 'neg' : 'mut')}>{p.tipo === 'interno' ? dinero(p.no_identificado) : '—'}</td>
                        <td className={'n ' + (p.saldo < 0 ? 'neg' : '')}>{dinero(p.saldo)}</td>
                        <td className="acts"><button className="btn sm" type="button" onClick={(e) => { e.stopPropagation(); setEditar(p); }}>Editar</button></td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </Estado>
        </div>
        <div className="panel">
          {prov
            ? <EstadoDeCuenta titulo={`Movimientos · ${prov.nombre}`} ruta={`/proveedores/${prov.id}/estado-cuenta`} saldo={prov.saldo} />
            : <div className="empty">Elige un proveedor para ver sus movimientos.</div>}
        </div>
      </div>
      <FormProveedor prov={editar} onCerrar={() => setEditar(null)} onHecho={provs.recargar} />
    </>
  );
}

function FormProveedor({ prov, onCerrar, onHecho }) {
  const [f, setF] = useState({});
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  useEffect(() => {
    if (prov) setF({ nombre: prov.nombre || '', tipo: prov.tipo || 'externo', comision_na: prov.comision_na ?? '', comision_cf: prov.comision_cf ?? '', notas: prov.notas || '', activo: prov.activo ?? true });
    setError('');
  }, [prov]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function enviar() {
    setOcupado(true); setError('');
    try {
      if (prov.id) await patch(`/proveedores/${prov.id}`, f); else await post('/proveedores', f);
      avisar('Proveedor guardado'); onHecho(); onCerrar();
    } catch (er) { setError(er.message); }
    finally { setOcupado(false); }
  }
  return (
    <Dialogo abierto={!!prov} onCerrar={onCerrar} titulo={prov?.id ? 'Editar proveedor' : 'Nuevo proveedor'} onEnviar={enviar} ocupado={ocupado} error={error}>
      <Campo etiqueta="Nombre"><input id="prov-nombre" value={f.nombre || ''} onChange={set('nombre')} autoFocus /></Campo>
      <Campo etiqueta="Tipo" hint="De los internos se cargan los estados de cuenta.">
        <select id="prov-tipo" value={f.tipo || 'externo'} onChange={set('tipo')}><option value="externo">Externo</option><option value="interno">Interno</option></select>
      </Campo>
      <div className="row">
        <Campo etiqueta="% que nos cobra en N/A"><input id="prov-na" className="num" inputMode="decimal" value={f.comision_na ?? ''} onChange={set('comision_na')} /></Campo>
        <Campo etiqueta="% que nos cobra en C/F"><input id="prov-cf" className="num" inputMode="decimal" value={f.comision_cf ?? ''} onChange={set('comision_cf')} /></Campo>
      </div>
      <Campo etiqueta="Notas"><textarea id="prov-notas" rows={2} value={f.notas || ''} onChange={set('notas')} /></Campo>
      {prov?.id && <label className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={!!f.activo} onChange={set('activo')} /> Activo</label>}
    </Dialogo>
  );
}
