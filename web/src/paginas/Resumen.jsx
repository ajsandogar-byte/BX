// Tablero: cifras de cuentas (admin y administrador de cuentas) y de cajas (solo admin).
import { useDatos } from '../api.js';
import { MONEDAS, NOMBRE_MONEDA, dinero, MODALIDAD } from '../formato.js';
import { Estado } from '../ui.jsx';

export function Resumen() {
  const r = useDatos('/resumen');
  const clientes = useDatos('/clientes');
  const provs = useDatos('/proveedores');
  const c = r.data?.cuentas, k = r.data?.cajas;
  const top = [...(clientes.data || [])].sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo)).slice(0, 10);
  const porAtiende = new Map();
  for (const cl of clientes.data || []) {
    const key = cl.atiende || 'Sin asignar';
    const a = porAtiende.get(key) || { n: 0, mes: 0, saldo: 0 };
    a.n++; a.mes += cl.depositado_mes; a.saldo += cl.saldo;
    porAtiende.set(key, a);
  }
  const maxGasto = Math.max(1, ...(k?.gastos_por_categoria || []).map((g) => g.monto));

  return (
    <>
      <h1>Resumen</h1>
      <Estado cargando={r.cargando && !r.data} error={r.error}>
        {c && (
          <div className="kpis">
            <div className="kpi"><span className="eyebrow">Saldo de clientes</span><span className="v">{dinero(c.saldo_clientes)}</span><span className="s">Lo que les debemos</span></div>
            <div className="kpi"><span className="eyebrow">Saldo en proveedores</span><span className="v">{dinero(c.saldo_proveedores)}</span><span className="s">Lo que tenemos con ellos</span></div>
            <div className="kpi attn"><span className="eyebrow">No identificado</span><span className="v">{dinero(c.no_identificado)}</span><span className="s">{c.edocta_pendientes.lineas ? `${c.edocta_pendientes.lineas} líneas por asignar` : 'En proveedores internos'}</span></div>
            <div className="kpi"><span className="eyebrow">Comisiones del mes</span><span className="v">{dinero(c.utilidad_comisiones_mes)}</span><span className="s">Acumulado {dinero(c.utilidad_comisiones_total)}</span></div>
            {k && <div className="kpi"><span className="eyebrow">Utilidad cambiaria del mes</span><span className="v">{dinero(k.utilidad_cambiaria_mes)}</span><span className="s">Ventas contra costo promedio</span></div>}
            {k && <div className="kpi"><span className="eyebrow">Utilidad neta del mes</span><span className={'v' + (k.utilidad_neta_mes < 0 ? ' neg' : '')}>{dinero(k.utilidad_neta_mes)}</span><span className="s">Comisiones + cambiaria − gastos ({dinero(k.gastos_mes)})</span></div>}
          </div>
        )}
        {k && (
          <div className="kpis" aria-label="Efectivo en todas las cajas">
            {MONEDAS.map((m) => (
              <div className="kpi" key={m}>
                <span className="eyebrow">{m} · {NOMBRE_MONEDA[m]}</span>
                <span className="v">{dinero(k.existencias[m].cantidad, m)}</span>
                <span className="s">{m === 'MXN' ? `Valor total de cajas ${dinero(k.valor_total)}` : k.existencias[m].cantidad ? `Costo ${dinero(k.existencias[m].costo)}` : 'Sin existencia'}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid2">
          <div className="panel">
            <div className="panel-h"><h2>Clientes con mayor saldo</h2><a className="btn sm" href="#/clientes">Ver todos</a></div>
            <Estado cargando={clientes.cargando && !clientes.data} error={clientes.error} vacio={!top.length && 'Aún no hay clientes.'}>
              <div className="tscroll">
                <table>
                  <thead><tr><th>Cliente</th><th>Atiende</th><th className="n">Depositado mes</th><th className="n">Saldo</th></tr></thead>
                  <tbody>
                    {top.map((cl) => (
                      <tr key={cl.id}>
                        <td>{cl.nombre} <span className="pill borde">{MODALIDAD[cl.modalidad]}</span></td>
                        <td className="mut">{cl.atiende || 'Sin asignar'}</td>
                        <td className="n">{dinero(cl.depositado_mes)}</td>
                        <td className={'n ' + (cl.saldo < 0 ? 'neg' : '')}>{dinero(cl.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Estado>
          </div>
          <div className="panel">
            <div className="panel-h"><h2>Proveedores</h2><a className="btn sm" href="#/proveedores">Ver todos</a></div>
            <Estado cargando={provs.cargando && !provs.data} error={provs.error} vacio={!provs.data?.length && 'Aún no hay proveedores.'}>
              <div className="tscroll">
                <table>
                  <thead><tr><th>Proveedor</th><th className="n">Recibido mes</th><th className="n">No ident.</th><th className="n">Saldo</th></tr></thead>
                  <tbody>
                    {(provs.data || []).map((p) => (
                      <tr key={p.id}>
                        <td>{p.nombre} <span className={'pill ' + (p.tipo === 'interno' ? 'fuerte' : '')}>{p.tipo === 'interno' ? 'Interno' : 'Externo'}</span></td>
                        <td className="n">{dinero(p.recibido_mes)}</td>
                        <td className={'n ' + (p.no_identificado ? 'neg' : 'mut')}>{p.tipo === 'interno' ? dinero(p.no_identificado) : '—'}</td>
                        <td className="n">{dinero(p.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Estado>
          </div>
          <div className="panel">
            <div className="panel-h"><h2>Por administrador de cuenta</h2></div>
            <div className="tscroll">
              <table>
                <thead><tr><th>Administrador</th><th className="n">Clientes</th><th className="n">Depositado mes</th><th className="n">Saldo clientes</th></tr></thead>
                <tbody>
                  {[...porAtiende.entries()].map(([n, a]) => (
                    <tr key={n}><td className={n === 'Sin asignar' ? 'mut' : ''}>{n}</td><td className="n">{a.n}</td><td className="n">{dinero(a.mes)}</td><td className="n">{dinero(a.saldo)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {k && (
            <div className="panel">
              <div className="panel-h"><h2>Gastos del mes por categoría</h2></div>
              {k.gastos_por_categoria.length ? (
                <div className="barras">
                  {k.gastos_por_categoria.map((g) => (
                    <div className="barra" key={g.categoria}><span>{g.categoria}</span><div className="barra-t"><i style={{ width: `${Math.max(2, (g.monto / maxGasto) * 100)}%` }} /></div><b>{dinero(g.monto)}</b></div>
                  ))}
                </div>
              ) : <div className="empty">Sin gastos este mes.</div>}
            </div>
          )}
        </div>
      </Estado>
    </>
  );
}
