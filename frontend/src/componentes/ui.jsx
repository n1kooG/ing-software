import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';

const RUTAS = {
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  plus: <path d="M5 12h14M12 5v14" />,
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  salir: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  izq: <path d="m15 18-6-6 6-6" />,
  der: <path d="m9 18 6-6-6-6" />,
  menu: <path d="M4 12h16M4 6h16M4 18h16" />,
  caja: <><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></>,
  factura: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></>,
  subir: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></>,
  camion: <><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><circle cx="17" cy="18" r="2" /><circle cx="7" cy="18" r="2" /></>,
  casa: <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 22V12h6v10" /></>,
  usuarios: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
};
export const Icono = ({ n }) => <svg className="icono" viewBox="0 0 24 24" aria-hidden="true">{RUTAS[n]}</svg>;

export const Logo = () => <span className="logo" aria-hidden="true">ó</span>;

export function Boton({ variante, icono, children, ...p }) {
  return <button type="button" {...p} className={`btn ${variante ?? ''} ${p.className ?? ''}`}>{icono && <Icono n={icono} />}{children}</button>;
}

// Campo con etiqueta, ayuda y error asociados (accesible). `como` = 'input' | 'select' | 'textarea'.
export function Campo({ etiqueta, error, ayuda, como = 'input', children, className = '', ...p }) {
  const id = useId();
  const Tag = como;
  return (
    <div className={`campo ${error ? 'error' : ''} ${className}`}>
      <label htmlFor={id}>{etiqueta}</label>
      <Tag id={id} className="entrada" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : ayuda ? `${id}-a` : undefined} {...p}>{children}</Tag>
      {error ? <span id={`${id}-e`} className="msg-error" role="alert">{error}</span> : ayuda && <span id={`${id}-a`} className="ayuda">{ayuda}</span>}
    </div>
  );
}

export const Badge = ({ tono, children }) => <span className={`badge ${tono ?? ''}`}>{children}</span>;

export const Alerta = ({ children, tipo }) => children ? <div className={`alerta ${tipo ?? ''}`} role="alert">{children}</div> : null;

export function Tabla({ columnas, vacio, children }) {
  return (
    <div className="tabla-wrap">
      <table>
        <thead><tr>{columnas.map((c) => <th key={c.t ?? c} className={c.d ? 'derecha' : ''}>{c.t ?? c}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {vacio && <p className="vacio">{vacio}</p>}
    </div>
  );
}

export function Modal({ titulo, subtitulo, onClose, lado, chico, pie, children }) {
  const ref = useRef(null);
  const tid = useId();
  useEffect(() => {
    const previo = document.activeElement;
    const enfocables = () => [...ref.current.querySelectorAll('button, input:not([readonly]), select, textarea, [href]')].filter((e) => !e.disabled);
    (enfocables().find((e) => e.dataset.inicial !== undefined) ?? enfocables()[1] ?? ref.current).focus();
    const tecla = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const f = enfocables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('keydown', tecla); previo?.focus?.(); };
  }, [onClose]);
  return (
    <div className={`velo-modal ${lado ? 'lado' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${lado ? 'lado' : ''} ${chico ? 'chico' : ''}`} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1}>
        <div className="modal-cab">
          <div><h2 id={tid}>{titulo}</h2>{subtitulo && <p>{subtitulo}</p>}</div>
          <Boton className="icono-solo" aria-label="Cerrar" onClick={onClose}><Icono n="x" /></Boton>
        </div>
        <div className="modal-cuerpo">{children}</div>
        {pie && <div className="modal-pie">{pie}</div>}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useAviso = () => useContext(ToastCtx);
export function AvisosProvider({ children }) {
  const [lista, setLista] = useState([]);
  const avisar = useCallback((texto, tipo = 'ok') => {
    const id = Math.random();
    setLista((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => setLista((l) => l.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={avisar}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{lista.map((t) => <div key={t.id} className={`toast ${t.tipo === 'error' ? 'error' : ''}`}>{t.texto}</div>)}</div>
    </ToastCtx.Provider>
  );
}

export const clp = (v) => (v === null || v === undefined || v === '' ? null : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(v)));
export const pct = (v) => (v === null || v === undefined ? null : `${Number(v).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`);
