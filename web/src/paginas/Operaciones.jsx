// Operaciones de clientes y proveedores: depósitos, pagos, ajustes y saldos iniciales.
import { useEffect, useMemo, useState } from 'react';
import { useDatos, post } from '../api.js';
import { dinero, pct, numero, MODALIDAD, hoyMx, rangoDeMes, fechaCorta } from '../formato.js';
import { Campo, DialogoCancelar, Estado, PillTipo, Seg, useAviso } from '../ui.jsx';

const AYUDA = {
  deposito: 'El cliente deposita al proveedor. Al cliente se le abona el monto menos nuestra comisión; al proveedor, el monto menos la suya.',
  pago: 'Pagamos por cuenta del cliente con fondos que tenemos en el proveedor. Se resta de los dos saldos.',
  ajuste: 'Corrección manual a un saldo. Usa monto negativo para restar.',
  saldo_inicial: 'Saldo con el que arranca un cliente o proveedor. Positivo: a favor del cliente / dinero nuestro en el proveedor.',
};

export function Operaciones({ yo }) {
  const [v, setV] = useState(0);
  return (
    <>
      <h1>Operaciones</h1>
      <div className="grid2">
        <FormOperacion yo={yo} onHecho={() => setV((x) => x + 1)} />
        <Lista vuelta={v} onHecho={() => setV((x) => x + 1)} />
      </div>
    </>
  );
}

function FormOperacion({ yo, onHecho }) {
  const clientes = useDatos('/clientes');
  const provs = useDatos('/proveedores');
  const vacio = { tipo: 'deposito', aplica: 'cliente', cliente_id: '', proveedor_id: '', monto: '', modalidad: '', pct_cliente: '', pct_proveedor: '', fecha: '', referencia: '', concepto: '' };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const cli = (clientes.data || []).find((c) => String(c.id) === String(f.cliente_id));
  const prov = (provs.data || []).find((p) => String(p.id) === String(f.proveedor_id));
  const modalidad = f.modalidad || cli?.modalidad || 'NA';
  const baseCli = cli?.comision_base;
  const baseProv = prov ? (modalidad === 'CF' ? prov.comision_cf : prov.comision_na) : undefined;

  // Al cambiar cliente, proveedor o modalidad se cargan los % base.
  useEffect(() => { setF((x) => ({ ...x, pct_cliente: baseCli ?? '' })); }, [f.cliente_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setF((x) => ({ ...x, pct_proveedor: baseProv ?? '' })); }, [f.proveedor_id, modalidad]); // eslint-disable-line react-hooks/exhaustive-deps

  const usaCli = f.tipo === 'deposito' || f.tipo === 'pago' || f.aplica === 'cliente';
  const usaProv = f.tipo === 'deposito' || f.tipo === 'pago' || f.aplica === 'proveedor';
  const m = numero(f.monto), pc = numero(f.pct_cliente), pp = numero(f.pct_proveedor);

  const vista = useMemo(() => {
    if (!Number.isFinite(m) || !m) return null;
    const r = (x) => Math.round(x * 100) / 100;
    if (f.tipo === 'deposito' && Number.isFinite(pc) && Number.isFinite(pp)) {
      return [['Saldo del cliente', r(m - (m * pc) / 100)], ['Saldo del proveedor', r(m - (m * pp) / 100)], ['Nuestra utilidad', r((m * (pc - pp)) / 100)]];
    }
    if (f.tipo === 'pago') return [['Saldo del cliente', -m], ['Saldo del proveedor', -m]];
    if (f.tipo === 'ajuste' || f.tipo === 'saldo_inicial') return [[f.aplica === 'cliente' ? 'Saldo del cliente' : 'Saldo del proveedor', m]];
    return null;
  }, [m, pc, pp, f.tipo, f.aplica]);

  async function enviar(e) {
    e.preventDefault(); setError('');
    const d = { tipo: f.tipo, monto: f.monto, referencia: f.referencia || undefined, concepto: f.concepto || undefined, fecha: f.fecha || undefined };
    if (usaCli) d.cliente_id = f.cliente_id || undefined;
    if (usaProv) d.proveedor_id = f.proveedor_id || undefined;
    if (f.tipo === 'ajuste' || f.tipo === 'saldo_inicial') d.aplica = f.aplica;
    if (f.tipo === 'deposito') { d.modalidad = modalidad; d.pct_cliente = f.pct_cliente; d.pct_proveedor = f.pct_proveedor; }
    if (usaCli && !d.cliente_id) return setError('Elige el cliente.');
    if (usaProv && !d.proveedor_id) return setError('Elige el proveedor.');
    setOcupado(true);
    try {
      const r = await post('/operaciones', d);
      avisar(f.tipo === 'deposito' ? `Depósito registrado · utilidad ${dinero(r.utilidad)}` : 'Operación registrada');
      setF((x) => ({ ...vacio, tipo: x.tipo, aplica: x.aplica }));
      clientes.recargar(); provs.recargar(); onHecho();
    } catch (er) { setError(er.message); }
    finally { setOcupado(false); }
  }

  const tipos = [['deposito', 'Depósito'], ['pago', 'Pago'], ['ajuste', 'Ajuste'], ...(yo.rol === 'admin' ? [['saldo_inicial', 'Saldo inicial']] : [])];
  const difCli = f.tipo === 'deposito' && baseCli != null && Number.isFinite(pc) && pc !== baseCli;
  const difProv = f.tipo === 'deposito' && baseProv != null && Number.isFinite(pp) && pp !== baseProv;
  return (
    <div className="panel">
      <div className="panel-h"><h2>Nueva operación</h2></div>
      <form className="panel-b" onSubmit={enviar} noValidate>
        <Seg etiqueta="Tipo de operación" opciones={tipos} valor={f.tipo} onCambio={set('tipo')} />
        <p className="hint" style={{ margin: 0 }}>{AYUDA[f.tipo]}</p>
        {(f.tipo === 'ajuste' || f.tipo === 'saldo_inicial') && (
          <Campo etiqueta="Aplicar a"><select id="op-aplica" value={f.aplica} onChange={set('aplica')}><option value="cliente">Un cliente</option><option value="proveedor">Un proveedor</option></select></Campo>
        )}
        <div className="row">
          {usaCli && (
            <Campo etiqueta="Cliente">
              <select id="op-cliente" value={f.cliente_id} onChange={set('cliente_id')}>
                <option value="">— Elige —</option>{(clientes.data || []).filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
          )}
          {usaProv && (
            <Campo etiqueta="Proveedor">
              <select id="op-proveedor" value={f.proveedor_id} onChange={set('proveedor_id')}>
                <option value="">— Elige —</option>{(provs.data || []).filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.tipo === 'interno' ? ' (interno)' : ''}</option>)}
              </select>
            </Campo>
          )}
        </div>
        <div className="row">
          <Campo etiqueta="Monto"><input id="op-monto" className="num" inputMode="decimal" value={f.monto} onChange={set('monto')} placeholder="0.00" autoComplete="off" /></Campo>
          {f.tipo === 'deposito' && (
            <Campo etiqueta="Modalidad" hint={cli ? `La del cliente es ${MODALIDAD[cli.modalidad]}` : undefined}>
              <select id="op-modalidad" value={modalidad} onChange={set('modalidad')}><option value="NA">N/A</option><option value="CF">C/F</option></select>
            </Campo>
          )}
        </div>
        {f.tipo === 'deposito' && (
          <div className="row">
            <Campo etiqueta="% al cliente" hint={baseCli == null ? undefined : difCli ? `Distinto a la base (${pct(baseCli)})` : `Base: ${pct(baseCli)}`} hintCambio={difCli}>
              <input id="op-pct-cliente" className="num" inputMode="decimal" value={f.pct_cliente} onChange={set('pct_cliente')} />
            </Campo>
            <Campo etiqueta={`% del proveedor (${MODALIDAD[modalidad]})`} hint={baseProv == null ? undefined : difProv ? `Distinto a la base (${pct(baseProv)})` : `Base: ${pct(baseProv)}`} hintCambio={difProv}>
              <input id="op-pct-proveedor" className="num" inputMode="decimal" value={f.pct_proveedor} onChange={set('pct_proveedor')} />
            </Campo>
          </div>
        )}
        <div className="row">
          <Campo etiqueta="Fecha" hint="Vacía = día de operación actual"><input id="op-fecha" type="date" value={f.fecha} max={hoyMx()} onChange={set('fecha')} /></Campo>
          <Campo etiqueta="Referencia"><input id="op-ref" value={f.referencia} onChange={set('referencia')} placeholder="Folio, rastreo…" autoComplete="off" /></Campo>
        </div>
        <Campo etiqueta="Concepto"><input id="op-concepto" value={f.concepto} onChange={set('concepto')} placeholder="Opcional" autoComplete="off" /></Campo>
        {vista && (
          <div className="preview">
            {vista.map(([l, x]) => <div key={l}><span>{l}</span><b className={x < 0 ? 'neg' : 'pos'}>{x > 0 ? '+' : ''}{dinero(x)}</b></div>)}
          </div>
        )}
        <div className="err">{error}</div>
        <div className="acciones"><button className="btn primary" type="submit" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Registrar'}</button></div>
      </form>
    </div>
  );
}

function Lista({ vuelta, onHecho }) {
  const [mes, setMes] = useState(hoyMx().slice(0, 7));
  const [desde, hasta] = rangoDeMes(mes);
  const ops = useDatos(`/operaciones?desde=${desde}&hasta=${hasta}&v=${vuelta}`);
  const [cancelar, setCancelar] = useState(null);
  const lista = ops.data || [];
  return (
    <div className="panel">
      <div className="panel-h"><h2>Registradas</h2><div className="filtros"><input type="month" id="op-mes" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes" /></div></div>
      <Estado cargando={ops.cargando && !ops.data} error={ops.error} vacio={!lista.length && 'Sin operaciones en este mes.'}>
        <div className="tscroll">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Cliente</th><th>Proveedor</th><th className="n">Cliente</th><th className="n">Proveedor</th><th className="n">Utilidad</th><th></th></tr></thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id} className={o.cancelado_por ? 'cancelado' : ''} title={[o.referencia, o.concepto, `Capturó ${o.usuario}`].filter(Boolean).join(' · ')}>
                  <td className="d">{fechaCorta(o.fecha)}</td>
                  <td className="tipo"><PillTipo tipo={o.tipo} cancelado={!!o.cancelado_por} cancela={!!o.cancela_a} />{o.datos?.modalidad && <span className="pill borde">{MODALIDAD[o.datos.modalidad]}</span>}</td>
                  <td>{o.cliente || '—'}</td>
                  <td>{o.proveedor || '—'}</td>
                  <td className={'n ' + (o.efecto_cliente < 0 ? 'neg' : o.efecto_cliente ? 'pos' : 'mut')}>{o.efecto_cliente ? dinero(o.efecto_cliente) : '—'}</td>
                  <td className={'n ' + (o.efecto_proveedor < 0 ? 'neg' : o.efecto_proveedor ? 'pos' : 'mut')}>{o.efecto_proveedor ? dinero(o.efecto_proveedor) : '—'}</td>
                  <td className={'n ' + (o.utilidad < 0 ? 'neg' : o.utilidad ? 'pos' : 'mut')}>{o.utilidad ? dinero(o.utilidad) : '—'}</td>
                  <td className="acts">{!o.cancelado_por && !o.cancela_a && <button className="btn sm danger" type="button" onClick={() => setCancelar(o)}>Cancelar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Estado>
      <DialogoCancelar asiento={cancelar} onCerrar={() => setCancelar(null)} onHecho={onHecho} />
    </div>
  );
}
