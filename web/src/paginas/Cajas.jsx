// Cajas: existencias por moneda, registro de movimientos, cancelaciones y corte diario.
import { useEffect, useMemo, useState } from 'react';
import { useDatos, post } from '../api.js';
import { MONEDAS, NOMBRE_MONEDA, dinero, tc as fTc, numero, fechaCorta, hoyMx, rangoDeMes } from '../formato.js';
import { Campo, Dialogo, DialogoCancelar, Estado, PillTipo, Seg, useAviso } from '../ui.jsx';

export function Cajas({ yo }) {
  const cajas = useDatos('/cajas');
  const [sel, setSel] = useState(null);
  const lista = cajas.data || [];
  useEffect(() => {
    if (!lista.length) return;
    if (!sel || !lista.some((c) => c.id === sel)) setSel(yo.caja_id && lista.some((c) => c.id === yo.caja_id) ? yo.caja_id : lista[0].id);
  }, [lista, sel, yo.caja_id]);
  const caja = lista.find((c) => c.id === sel);
  const [vuelta, setVuelta] = useState(0);
  const refrescar = () => { cajas.recargar(); setVuelta((v) => v + 1); };

  return (
    <>
      <div className="cabeza">
        <h1>Cajas</h1>
        {lista.length > 1 && (
          <label className="f" style={{ minWidth: 240 }}>Caja
            <select id="caja-sel" value={sel ?? ''} onChange={(e) => setSel(Number(e.target.value))}>
              {lista.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.tipo === 'matriz' ? ' (matriz)' : ''}</option>)}
            </select>
          </label>
        )}
      </div>
      <Estado cargando={cajas.cargando && !cajas.data} error={cajas.error} vacio={!lista.length && 'No tienes cajas asignadas. Pide a un administrador que te asigne una.'}>
        {caja && (
          <>
            <Existencias caja={caja} />
            <div className="grid2">
              <FormMovimiento caja={caja} yo={yo} onHecho={refrescar} />
              <PanelCorte caja={caja} yo={yo} vuelta={vuelta} onHecho={refrescar} />
            </div>
            <Movimientos caja={caja} yo={yo} vuelta={vuelta} onHecho={refrescar} />
          </>
        )}
        {lista.length > 1 && <TablaCajas lista={lista} sel={sel} onSel={setSel} yo={yo} onHecho={refrescar} />}
        {yo.rol === 'admin' && lista.length <= 1 && <TablaCajas lista={lista} sel={sel} onSel={setSel} yo={yo} onHecho={refrescar} />}
      </Estado>
    </>
  );
}

function Existencias({ caja }) {
  return (
    <div className="kpis" aria-label={`Existencias de ${caja.nombre}`}>
      {MONEDAS.map((m) => {
        const e = caja.existencias[m];
        return (
          <div className="kpi" key={m}>
            <span className="eyebrow">{m} · {NOMBRE_MONEDA[m]}</span>
            <span className={'v' + (e.cantidad < 0 ? ' neg' : '')}>{dinero(e.cantidad, m)}</span>
            <span className="s">{m === 'MXN' ? `Efectivo en ${caja.nombre}` : e.cantidad ? `Costo prom. ${fTc(e.costo_promedio)} · ${dinero(e.costo)}` : 'Sin existencia'}</span>
          </div>
        );
      })}
    </div>
  );
}

function TablaCajas({ lista, sel, onSel, yo, onHecho }) {
  const [nombre, setNombre] = useState('');
  const avisar = useAviso();
  const totales = MONEDAS.map((m) => lista.reduce((a, c) => a + c.existencias[m].cantidad, 0));
  async function agregar(e) {
    e.preventDefault();
    try { await post('/cajas', { nombre }); setNombre(''); avisar('Sucursal agregada'); onHecho(); }
    catch (er) { avisar(er.message, true); }
  }
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>{yo.rol === 'admin' ? 'Todas las cajas' : 'Sucursales'}</h2>
        {yo.rol === 'admin' && (
          <form className="filtros" onSubmit={agregar} noValidate>
            <input id="nueva-sucursal" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la sucursal" aria-label="Nombre de la sucursal" />
            <button className="btn sm" type="submit">+ Sucursal</button>
          </form>
        )}
      </div>
      <div className="tscroll">
        <table>
          <thead><tr><th>Caja</th>{MONEDAS.map((m) => <th key={m} className="n">{m}</th>)}<th>Último corte</th><th>Estado</th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} className={'click' + (c.id === sel ? ' sel' : '')} tabIndex={0} onClick={() => onSel(c.id)} onKeyDown={(e) => e.key === 'Enter' && onSel(c.id)}>
                <td>{c.nombre} <span className={'pill ' + (c.tipo === 'matriz' ? 'fuerte' : '')}>{c.tipo === 'matriz' ? 'Matriz' : 'Sucursal'}</span></td>
                {MONEDAS.map((m) => <td key={m} className={'n' + (c.existencias[m].cantidad ? '' : ' mut')}>{c.existencias[m].cantidad ? dinero(c.existencias[m].cantidad, m) : '—'}</td>)}
                <td className="d">{fechaCorta(c.ultimo_corte)}</td>
                <td>{c.corte_pendiente ? <span className="pill aviso">Corte pendiente</span> : <span className="pill ok">Al día</span>}</td>
              </tr>
            ))}
            <tr>
              <td><b>Total</b></td>
              {totales.map((v, i) => <td key={i} className="n"><b>{v ? dinero(v, MONEDAS[i]) : '—'}</b></td>)}
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Registrar movimiento ----------
const TIPOS_CAJA = [
  ['compra', 'Compra'], ['venta', 'Venta'], ['entrada', 'Entrada'], ['salida', 'Salida'],
  ['gasto', 'Gasto'], ['traspaso', 'Traspaso'],
];
const TIPOS_ADMIN = [['retiro_utilidad', 'Utilidad a caja'], ['saldo_inicial', 'Saldo inicial']];
const AYUDA = {
  compra: 'El cliente nos entrega divisa y le pagamos pesos.',
  venta: 'Le entregamos divisa y nos paga pesos. La utilidad se calcula contra el costo promedio de la caja.',
  entrada: 'Efectivo que entra. En pesos puedes cargarlo al saldo de un cliente o proveedor.',
  salida: 'Efectivo que sale. En pesos puedes cargarlo al saldo de un cliente o proveedor.',
  gasto: 'Gasto de operación pagado con esta caja.',
  traspaso: 'Mover efectivo a otra caja. La divisa viaja con su costo promedio.',
  retiro_utilidad: 'Pasar a caja comisiones ganadas que están con un proveedor.',
  saldo_inicial: 'Efectivo con el que arranca la caja en esa moneda.',
};
const CATEGORIAS = ['Renta', 'Nómina', 'Luz', 'Agua', 'Teléfono e internet', 'Papelería', 'Comisiones bancarias', 'Mantenimiento', 'Transporte', 'Impuestos', 'Otros'];

function FormMovimiento({ caja, yo, onHecho }) {
  const tipos = yo.rol === 'admin' ? [...TIPOS_CAJA, ...TIPOS_ADMIN] : TIPOS_CAJA;
  const vacio = { tipo: 'compra', moneda: 'USD', cantidad: '', tc: '', categoria: '', destino_id: '', contra: '', cliente_id: '', proveedor_id: '', referencia: '', concepto: '' };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const destinos = useDatos(f.tipo === 'traspaso' ? '/cajas/destinos' : null);
  const clientes = useDatos(f.contra === 'cliente' ? '/clientes/nombres' : null);
  const provs = useDatos(f.contra === 'proveedor' || f.tipo === 'retiro_utilidad' ? '/proveedores/nombres' : null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const esCambio = f.tipo === 'compra' || f.tipo === 'venta';
  const monedas = esCambio ? MONEDAS.filter((m) => m !== 'MXN') : f.tipo === 'retiro_utilidad' ? ['MXN'] : MONEDAS;
  useEffect(() => { if (!monedas.includes(f.moneda)) setF((x) => ({ ...x, moneda: monedas[0] })); }, [f.tipo]); // eslint-disable-line react-hooks/exhaustive-deps
  const conContra = (f.tipo === 'entrada' || f.tipo === 'salida') && f.moneda === 'MXN';
  const pideTc = esCambio || (f.moneda !== 'MXN' && (f.tipo === 'entrada' || f.tipo === 'saldo_inicial'));
  const ex = caja.existencias[f.moneda] || { cantidad: 0 };
  const q = numero(f.cantidad), t = numero(f.tc);

  const vista = useMemo(() => {
    if (!Number.isFinite(q) || !q) return null;
    const filas = [];
    if (esCambio && Number.isFinite(t) && t > 0) {
      const mx = Math.round(q * t * 100) / 100;
      filas.push([`${caja.nombre} · ${f.moneda}`, f.tipo === 'compra' ? q : -q, f.moneda], [`${caja.nombre} · MXN`, f.tipo === 'compra' ? -mx : mx, 'MXN']);
      if (f.tipo === 'venta' && ex.costo_promedio) filas.push(['Utilidad cambiaria estimada', Math.round((t - ex.costo_promedio) * q * 100) / 100, 'MXN']);
    } else if (!esCambio) {
      const signo = ['entrada', 'saldo_inicial', 'retiro_utilidad'].includes(f.tipo) ? 1 : -1;
      filas.push([`${caja.nombre} · ${f.moneda}`, signo * q, f.moneda]);
    }
    return filas;
  }, [q, t, f.tipo, f.moneda, caja.nombre, ex.costo_promedio, esCambio]);

  async function enviar(e) {
    e.preventDefault(); setError('');
    const d = { tipo: f.tipo, moneda: f.moneda, cantidad: f.cantidad, referencia: f.referencia || undefined, concepto: f.concepto || undefined };
    if (pideTc && f.tc) d.tc = f.tc;
    if (f.tipo === 'gasto') d.categoria = f.categoria;
    if (f.tipo === 'traspaso') d.destino_id = f.destino_id || undefined;
    if (conContra && f.contra === 'cliente') d.cliente_id = f.cliente_id || undefined;
    if (conContra && f.contra === 'proveedor') d.proveedor_id = f.proveedor_id || undefined;
    if (f.tipo === 'retiro_utilidad') d.proveedor_id = f.proveedor_id || undefined;
    setOcupado(true);
    try {
      const r = await post(`/cajas/${caja.id}/movimientos`, d);
      avisar(`Registrado con fecha ${fechaCorta(r.fecha)}${r.utilidad_cambiaria != null ? ` · utilidad ${dinero(r.utilidad_cambiaria)}` : ''}`);
      setF((x) => ({ ...vacio, tipo: x.tipo, moneda: x.moneda, tc: esCambio ? x.tc : '' }));
      onHecho();
    } catch (er) { setError(er.message); }
    finally { setOcupado(false); }
  }

  return (
    <div className="panel">
      <div className="panel-h"><h2>Registrar en {caja.nombre}</h2></div>
      <form className="panel-b" onSubmit={enviar} noValidate>
        <Seg etiqueta="Tipo de movimiento" opciones={tipos} valor={f.tipo} onCambio={set('tipo')} />
        <p className="hint" style={{ margin: 0 }}>{AYUDA[f.tipo]}</p>
        <div className="row">
          <Campo etiqueta="Moneda">
            <select id="mov-moneda" value={f.moneda} onChange={set('moneda')}>{monedas.map((m) => <option key={m} value={m}>{m} · {NOMBRE_MONEDA[m]}</option>)}</select>
          </Campo>
          <Campo etiqueta={esCambio ? `Cantidad de ${f.moneda}` : `Monto en ${f.moneda}`} hint={`En caja: ${dinero(ex.cantidad, f.moneda)}`}>
            <input id="mov-cantidad" className="num" inputMode="decimal" value={f.cantidad} onChange={set('cantidad')} placeholder="0.00" autoComplete="off" />
          </Campo>
          <Campo oculto={!pideTc} etiqueta={esCambio ? 'Tipo de cambio' : 'Tipo de cambio de costo'} hint={ex.costo_promedio ? `Costo promedio: ${fTc(ex.costo_promedio)}` : f.tipo === 'entrada' ? 'Opcional si ya hay existencia' : undefined}>
            <input id="mov-tc" className="num" inputMode="decimal" value={f.tc} onChange={set('tc')} placeholder="0.0000" autoComplete="off" />
          </Campo>
        </div>
        {f.tipo === 'gasto' && (
          <Campo etiqueta="Categoría">
            <input id="mov-categoria" list="categorias" value={f.categoria} onChange={set('categoria')} placeholder="Renta, nómina, luz…" />
            <datalist id="categorias">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist>
          </Campo>
        )}
        {f.tipo === 'traspaso' && (
          <Campo etiqueta="Caja destino">
            <select id="mov-destino" value={f.destino_id} onChange={set('destino_id')}>
              <option value="">— Elige —</option>
              {(destinos.data || []).filter((c) => c.id !== caja.id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
        )}
        {conContra && (
          <div className="row">
            <Campo etiqueta="Afecta el saldo de">
              <select id="mov-contra" value={f.contra} onChange={set('contra')}>
                <option value="">Nadie (solo caja)</option><option value="cliente">Un cliente</option><option value="proveedor">Un proveedor</option>
              </select>
            </Campo>
            {f.contra === 'cliente' && (
              <Campo etiqueta="Cliente">
                <select id="mov-cliente" value={f.cliente_id} onChange={set('cliente_id')}><option value="">— Elige —</option>{(clientes.data || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
              </Campo>
            )}
            {f.contra === 'proveedor' && (
              <Campo etiqueta="Proveedor">
                <select id="mov-proveedor" value={f.proveedor_id} onChange={set('proveedor_id')}><option value="">— Elige —</option>{(provs.data || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
              </Campo>
            )}
          </div>
        )}
        {f.tipo === 'retiro_utilidad' && (
          <Campo etiqueta="Proveedor del que se retira">
            <select id="mov-proveedor-ret" value={f.proveedor_id} onChange={set('proveedor_id')}><option value="">— Elige —</option>{(provs.data || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          </Campo>
        )}
        <div className="row">
          <Campo etiqueta="Referencia"><input id="mov-ref" value={f.referencia} onChange={set('referencia')} placeholder="Folio, recibo…" autoComplete="off" /></Campo>
          <Campo etiqueta="Concepto"><input id="mov-concepto" value={f.concepto} onChange={set('concepto')} placeholder="Opcional" autoComplete="off" /></Campo>
        </div>
        {vista && vista.length > 0 && (
          <div className="preview">
            {vista.map(([l, v, m]) => <div key={l}><span>{l}</span><b className={v < 0 ? 'neg' : 'pos'}>{v > 0 ? '+' : ''}{dinero(v, m)}</b></div>)}
          </div>
        )}
        <div className="err">{error}</div>
        <div className="acciones"><button className="btn primary" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar'}</button></div>
      </form>
    </div>
  );
}

// ---------- Movimientos ----------
function Movimientos({ caja, yo, vuelta, onHecho }) {
  const nombres = useDatos('/cajas/destinos');
  const nombreCaja = (id) => (nombres.data || []).find((c) => c.id === id)?.nombre || 'otra caja';
  const [mes, setMes] = useState(hoyMx().slice(0, 7));
  const [desde, hasta] = rangoDeMes(mes);
  const movs = useDatos(`/cajas/${caja.id}/movimientos?desde=${desde}&hasta=${hasta}&v=${vuelta}`);
  const [cancelar, setCancelar] = useState(null);
  const lista = movs.data || [];
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Movimientos de {caja.nombre}</h2>
        <div className="filtros"><input type="month" id="mov-mes" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes" /></div>
      </div>
      <Estado cargando={movs.cargando && !movs.data} error={movs.error} vacio={!lista.length && 'Sin movimientos en este mes.'}>
        <div className="tscroll">
          <table>
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Contraparte</th><th className="n">Entra</th><th className="n">Sale</th><th className="n">T.C.</th><th className="n">Utilidad</th><th>Capturó</th><th></th></tr></thead>
            <tbody>
              {lista.map((m) => {
                const entra = Object.entries(m.efecto).filter(([, v]) => v > 0).map(([k, v]) => dinero(v, k)).join(' / ');
                const sale = Object.entries(m.efecto).filter(([, v]) => v < 0).map(([k, v]) => dinero(-v, k)).join(' / ');
                const contra = m.cliente || m.proveedor || (m.tipo === 'traspaso' ? (m.caja_id === caja.id ? `Hacia ${nombreCaja(m.caja_destino_id)}` : `Desde ${nombreCaja(m.caja_id)}`) : '');
                const diaCerrado = caja.ultimo_corte && m.fecha <= caja.ultimo_corte;
                const soloAdmin = ['saldo_inicial', 'retiro_utilidad'].includes(m.tipo) || diaCerrado;
                const cancelable = !m.cancelado_por && !m.cancela_a && m.tipo !== 'ajuste_corte' && !m.datos?.del_corte && (yo.rol === 'admin' || !soloAdmin);
                return (
                  <tr key={m.id} className={m.cancelado_por ? 'cancelado' : ''}>
                    <td className="d">{m.fecha}</td>
                    <td className="tipo"><PillTipo tipo={m.tipo} cancelado={!!m.cancelado_por} cancela={!!m.cancela_a} />{m.datos?.moneda && m.datos.moneda !== 'MXN' && <span className="pill borde">{m.datos.moneda}</span>}</td>
                    <td>{[m.concepto, m.datos?.categoria, m.referencia].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={contra ? '' : 'mut'}>{contra || '—'}</td>
                    <td className="n pos">{entra}</td>
                    <td className="n neg">{sale}</td>
                    <td className="n mut">{m.datos?.tc ? fTc(m.datos.tc) : ''}</td>
                    <td className={'n ' + (m.utilidad_cambiaria < 0 ? 'neg' : 'pos')}>{m.utilidad_cambiaria != null ? dinero(m.utilidad_cambiaria) : ''}</td>
                    <td className="mut">{m.usuario}</td>
                    <td className="acts">{cancelable && <button className="btn sm danger" type="button" onClick={() => setCancelar(m)}>Cancelar</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Estado>
      <DialogoCancelar asiento={cancelar} onCerrar={() => setCancelar(null)} onHecho={onHecho} />
    </div>
  );
}

// ---------- Corte ----------
function PanelCorte({ caja, yo, vuelta, onHecho }) {
  const cortes = useDatos(`/cajas/${caja.id}/cortes?v=${vuelta}`);
  const [abierto, setAbierto] = useState(false);
  const [reabrir, setReabrir] = useState(null);
  const puedeReabrir = yo.rol === 'admin' || yo.rol === 'supervisor';
  const lista = cortes.data || [];
  const ultimoCerrado = lista.find((c) => c.estado === 'cerrado');
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Corte</h2>
        <button className="btn primary" type="button" onClick={() => setAbierto(true)}>Hacer corte</button>
      </div>
      <div className="panel-b" style={{ paddingBottom: 0 }}>
        <p className="hint" style={{ margin: 0 }}>
          {caja.corte_pendiente ? <span className="pill aviso">Corte pendiente</span> : <span className="pill ok">Al día</span>}{' '}
          Después de las 4:30 lo que se registre queda para el día siguiente. El corte cierra el día: ya no se puede registrar ni cancelar con esa fecha.
        </p>
      </div>
      <Estado cargando={cortes.cargando && !cortes.data} error={cortes.error} vacio={!lista.length && 'Esta caja aún no tiene cortes.'}>
        <div className="tscroll">
          <table>
            <thead><tr><th>Fecha</th><th>Diferencias</th><th>A matriz</th><th>Hizo</th><th></th></tr></thead>
            <tbody>
              {lista.slice(0, 15).map((c) => {
                const difs = Object.entries(c.diferencia).filter(([, v]) => v);
                const env = Object.entries(c.enviado).filter(([, v]) => v > 0);
                return (
                  <tr key={c.id} className={c.estado === 'reabierto' ? 'cancelado' : ''}>
                    <td className="d">{c.fecha}{c.estado === 'reabierto' && <> <span className="pill">Reabierto</span></>}</td>
                    <td>{difs.length ? difs.map(([m, v]) => <span key={m} className={'pill ' + (v < 0 ? 'mal' : 'ok')}>{v < 0 ? 'Faltante ' : 'Sobrante '}{dinero(Math.abs(v), m)}</span>) : <span className="pill ok">Cuadró</span>}</td>
                    <td className={env.length ? '' : 'mut'}>{env.length ? env.map(([m, v]) => dinero(v, m)).join(' · ') : '—'}</td>
                    <td className="mut">{c.usuario}</td>
                    <td className="acts">{puedeReabrir && c === ultimoCerrado && <button className="btn sm" type="button" onClick={() => setReabrir(c)}>Reabrir</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Estado>
      <DialogoCorte caja={caja} abierto={abierto} onCerrar={() => setAbierto(false)} onHecho={onHecho} />
      <DialogoReabrir corte={reabrir} onCerrar={() => setReabrir(null)} onHecho={onHecho} />
    </div>
  );
}

function DialogoCorte({ caja, abierto, onCerrar, onHecho }) {
  const [fecha, setFecha] = useState(hoyMx());
  const prev = useDatos(abierto ? `/cajas/${caja.id}/corte?fecha=${fecha}` : null);
  const [contado, setContado] = useState({});
  const [enviado, setEnviado] = useState({});
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const esSucursal = caja.tipo !== 'matriz';
  useEffect(() => { if (abierto) { setFecha(hoyMx()); setNota(''); setError(''); setEnviado({}); } }, [abierto]);
  useEffect(() => { if (prev.data) setContado(Object.fromEntries(MONEDAS.map((m) => [m, String(prev.data.esperado[m])]))); }, [prev.data]);

  async function enviar() {
    setError('');
    const enviadoLimpio = Object.fromEntries(Object.entries(enviado).filter(([, v]) => String(v).trim() !== ''));
    setOcupado(true);
    try {
      await post(`/cajas/${caja.id}/cortes`, { fecha, contado, enviado: esSucursal ? enviadoLimpio : undefined, nota: nota || undefined });
      avisar(`Corte de ${caja.nombre} del ${fechaCorta(fecha)} guardado`);
      onHecho(); onCerrar();
    } catch (er) { setError(er.message); }
    finally { setOcupado(false); }
  }
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={`Corte de ${caja.nombre}`} onEnviar={enviar} enviarTexto="Cerrar el día" ocupado={ocupado} error={error}>
      <Campo etiqueta="Fecha del corte" hint={prev.data?.ultimo_corte ? `Último corte: ${fechaCorta(prev.data.ultimo_corte)}` : 'Primer corte de esta caja'}>
        <input id="corte-fecha" type="date" value={fecha} max={hoyMx()} onChange={(e) => setFecha(e.target.value)} />
      </Campo>
      {prev.data?.cerrado && <div className="notice">Esa fecha ya está cerrada.</div>}
      <p className="hint" style={{ margin: 0 }}>Cuenta el efectivo y escribe lo que hay. Si no cuadra, la diferencia se registra como sobrante o faltante.{esSucursal && ' Lo que pongas en "Enviar a matriz" se traspasa en el mismo paso.'}</p>
      <div className="tscroll">
        <table>
          <thead><tr><th>Moneda</th><th className="n">Según sistema</th><th className="n">Contado</th><th className="n">Diferencia</th>{esSucursal && <th className="n">Enviar a matriz</th>}</tr></thead>
          <tbody>
            {MONEDAS.map((m) => {
              const esp = prev.data?.esperado[m] ?? 0;
              const c = numero(contado[m]);
              const dif = Number.isFinite(c) ? Math.round((c - esp) * 100) / 100 : null;
              return (
                <tr key={m}>
                  <td>{m}</td>
                  <td className="n">{dinero(esp, m)}</td>
                  <td className="n"><input id={`corte-c-${m}`} className="num" style={{ width: 130 }} inputMode="decimal" value={contado[m] ?? ''} onChange={(e) => setContado((x) => ({ ...x, [m]: e.target.value }))} aria-label={`Contado ${m}`} /></td>
                  <td className={'n ' + (dif == null || dif === 0 ? 'mut' : dif < 0 ? 'neg' : 'pos')}>{dif == null ? '—' : dif === 0 ? 'Cuadra' : (dif > 0 ? '+' : '') + dinero(dif, m)}</td>
                  {esSucursal && <td className="n"><input id={`corte-e-${m}`} className="num" style={{ width: 130 }} inputMode="decimal" placeholder="0.00" value={enviado[m] ?? ''} onChange={(e) => setEnviado((x) => ({ ...x, [m]: e.target.value }))} aria-label={`Enviar a matriz ${m}`} /></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Campo etiqueta="Nota"><input id="corte-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" /></Campo>
    </Dialogo>
  );
}

function DialogoReabrir({ corte, onCerrar, onHecho }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const avisar = useAviso();
  useEffect(() => { setMotivo(''); setError(''); }, [corte]);
  async function enviar() {
    try { await post(`/cortes/${corte.id}/reabrir`, { motivo }); avisar('Día reabierto'); onHecho(); onCerrar(); }
    catch (er) { setError(er.message); }
  }
  return (
    <Dialogo abierto={!!corte} onCerrar={onCerrar} titulo={`Reabrir el ${corte ? fechaCorta(corte.fecha) : ''}`} onEnviar={enviar} enviarTexto="Reabrir día" error={error}>
      <p className="hint" style={{ margin: 0 }}>Al reabrir se deshacen los sobrantes, faltantes y envíos a matriz de ese corte, y se puede volver a registrar y cancelar en ese día. Después vuelve a hacer el corte.</p>
      <Campo etiqueta="Motivo"><input id="reabrir-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></Campo>
    </Dialogo>
  );
}
