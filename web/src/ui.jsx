// Piezas de interfaz reutilizables.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TIPOS } from './formato.js';
import { post } from './api.js';

// ---------- Avisos ----------
const ToastCtx = createContext(() => {});
export function ProveedorAvisos({ children }) {
  const [t, setT] = useState(null);
  const timer = useRef();
  const avisar = useCallback((texto, mal = false) => {
    setT({ texto, mal });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), mal ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={avisar}>
      {children}
      {t && <div className={'toast' + (t.mal ? ' mal' : '')} role="status">{t.texto}</div>}
    </ToastCtx.Provider>
  );
}
export const useAviso = () => useContext(ToastCtx);

// ---------- Diálogo ----------
export function Dialogo({ abierto, onCerrar, titulo, children, onEnviar, enviarTexto = 'Guardar', ocupado, error }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog ref={ref} onClose={onCerrar} onCancel={onCerrar}>
      {abierto && (
        <form noValidate onSubmit={(e) => { e.preventDefault(); onEnviar?.(); }}>
          <div className="dlg-h"><h2>{titulo}</h2><button type="button" className="btn sm" onClick={onCerrar}>Cerrar</button></div>
          {children}
          {error !== undefined && <div className="err">{error}</div>}
          {onEnviar && (
            <div className="acciones">
              <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
              <button type="submit" className="btn primary" disabled={ocupado}>{ocupado ? 'Guardando…' : enviarTexto}</button>
            </div>
          )}
        </form>
      )}
    </dialog>
  );
}

// ---------- Controles ----------
export function Seg({ opciones, valor, onCambio, etiqueta }) {
  return (
    <div className="seg" role="group" aria-label={etiqueta}>
      {opciones.map(([v, t]) => (
        <button key={v} type="button" aria-pressed={valor === v} onClick={() => onCambio(v)}>{t}</button>
      ))}
    </div>
  );
}

export function Campo({ etiqueta, hint, hintCambio, children, oculto }) {
  if (oculto) return null;
  return (
    <label className="f">
      {etiqueta}
      {children}
      {hint && <span className={'hint' + (hintCambio ? ' changed' : '')}>{hint}</span>}
    </label>
  );
}

export function PillTipo({ tipo, cancelado, cancela }) {
  const [t, c] = TIPOS[tipo] || [tipo, ''];
  return (
    <>
      <span className={'pill ' + c}>{t}</span>
      {cancelado && <span className="pill mal">Cancelada</span>}
      {cancela && <span className="pill">Cancelación</span>}
    </>
  );
}

export function Estado({ cargando, error, vacio, children }) {
  if (error) return <div className="empty neg">{error.message}</div>;
  if (cargando) return <div className="empty">Cargando…</div>;
  if (vacio) return <div className="empty">{vacio}</div>;
  return children;
}

// ---------- Cancelar una operación (con motivo) ----------
export function DialogoCancelar({ asiento, onCerrar, onHecho }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  useEffect(() => { setMotivo(''); setError(''); }, [asiento]);
  async function enviar() {
    setOcupado(true); setError('');
    try {
      const r = await post(`/asientos/${asiento.id}/cancelar`, { motivo });
      avisar(`Operación cancelada. La cancelación quedó con fecha ${r.fecha}.`);
      onHecho?.(); onCerrar();
    } catch (e) { setError(e.message); }
    finally { setOcupado(false); }
  }
  return (
    <Dialogo abierto={!!asiento} onCerrar={onCerrar} titulo="Cancelar operación" onEnviar={enviar} enviarTexto="Cancelar operación" ocupado={ocupado} error={error}>
      <p className="hint" style={{ margin: 0 }}>
        La operación no se borra: se registra un movimiento contrario con fecha de hoy y queda constancia de quién la canceló y por qué.
      </p>
      <Campo etiqueta="Motivo">
        <input id="motivo-cancelacion" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. capturada dos veces" autoFocus />
      </Campo>
    </Dialogo>
  );
}
