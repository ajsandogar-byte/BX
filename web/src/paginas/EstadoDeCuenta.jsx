// Estado de cuenta con saldo corrido (clientes y proveedores).
import { useState } from 'react';
import { useDatos } from '../api.js';
import { dinero, pct, MODALIDAD } from '../formato.js';
import { DialogoCancelar, Estado, PillTipo } from '../ui.jsx';

export function EstadoDeCuenta({ titulo, ruta, saldo }) {
  const [v, setV] = useState(0);
  const ec = useDatos(`${ruta}?v=${v}`);
  const [cancelar, setCancelar] = useState(null);
  const lista = [...(ec.data || [])].reverse();
  return (
    <>
      <div className="panel-h"><h2>{titulo}</h2><span className="eyebrow">Saldo</span> <b className={saldo < 0 ? 'neg' : ''} style={{ fontFamily: 'var(--f-mono)' }}>{dinero(saldo)}</b></div>
      <Estado cargando={ec.cargando && !ec.data} error={ec.error} vacio={!lista.length && 'Sin movimientos todavía.'}>
        <div className="tscroll">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th className="n">Movimiento</th><th className="n">Saldo</th><th></th></tr></thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id} className={m.cancelado_por ? 'cancelado' : ''}>
                  <td className="d">{m.fecha}</td>
                  <td className="tipo"><PillTipo tipo={m.tipo} cancelado={!!m.cancelado_por} cancela={!!m.cancela_a} /></td>
                  <td>
                    {[m.referencia, m.concepto].filter(Boolean).join(' · ')}
                    {m.datos?.monto != null && m.tipo === 'deposito' && (
                      <span className="hint"> {dinero(m.datos.monto / 100)} · cliente {pct(m.datos.pct_cliente)} · proveedor {pct(m.datos.pct_proveedor)} {MODALIDAD[m.datos.modalidad]}</span>
                    )}
                  </td>
                  <td className={'n ' + (m.movimiento < 0 ? 'neg' : 'pos')}>{m.movimiento > 0 ? '+' : ''}{dinero(m.movimiento)}</td>
                  <td className="n">{dinero(m.saldo)}</td>
                  <td className="acts">{!m.caja_id && !m.cancelado_por && !m.cancela_a && <button className="btn sm danger" type="button" onClick={() => setCancelar(m)}>Cancelar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Estado>
      <DialogoCancelar asiento={cancelar} onCerrar={() => setCancelar(null)} onHecho={() => setV((x) => x + 1)} />
    </>
  );
}
