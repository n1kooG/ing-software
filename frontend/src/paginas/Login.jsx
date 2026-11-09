import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alerta, Boton, Campo, Logo } from '../componentes/ui.jsx';
import { mensajeError } from '../api.js';
import { HOME, useSesion } from '../sesion.jsx';

const KEY = 'sgi_correo';
const correoGuardado = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const guardar = (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } };

// Estantería decorativa del fondo.
const Fondo = () => (
  <svg aria-hidden="true" preserveAspectRatio="xMidYMid slice">
    <defs>
      <pattern id="est" width="360" height="250" patternUnits="userSpaceOnUse">
        <path d="M0 246h360" stroke="#162540" strokeWidth="6" /><path d="M120 0v246M240 0v246" stroke="#162540" strokeWidth="2" />
        <rect x="40" y="100" width="110" height="140" rx="4" fill="none" stroke="#1b2d4d" strokeWidth="2" />
        <rect x="190" y="70" width="130" height="170" rx="4" fill="none" stroke="#1b2d4d" strokeWidth="2" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#est)" />
  </svg>
);

export default function Login() {
  const { login, aviso } = useSesion();
  const nav = useNavigate();
  const [email, setEmail] = useState(correoGuardado);
  const [password, setPassword] = useState('');
  const [recordar, setRecordar] = useState(() => !!correoGuardado());
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Debes ingresar correo y contraseña');
    setError(''); setEnviando(true);
    try {
      const u = await login(email.trim(), password);
      guardar(recordar ? email.trim() : ''); // solo el correo, nunca la contraseña
      nav(HOME[u.rol] ?? '/login', { replace: true });
    } catch (err) {
      setError(mensajeError(err));
    } finally { setEnviando(false); }
  }

  return (
    <div className="login">
      <header className="login-cab"><Logo /><span>Sistema de Gestión de <em>Inventario</em></span></header>
      <div className="login-fondo">
        <Fondo />
        <form className="login-tarjeta" onSubmit={enviar} noValidate>
          <h1>Iniciar sesión</h1>
          <p className="sub">Accede a tu cuenta de Comercial Oregón</p>
          <Campo etiqueta="Correo electrónico" type="email" autoComplete="username" placeholder="Ingrese su correo" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Campo etiqueta="Contraseña" type="password" autoComplete="current-password" placeholder="Ingrese su contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="zona-msg"><Alerta>{error || aviso}</Alerta></div>
          <label className="casilla"><input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />Recordar usuario</label>
          <Boton variante="primario bloque" type="submit" disabled={enviando}>{enviando ? 'Ingresando…' : 'Iniciar sesión'}</Boton>
        </form>
      </div>
    </div>
  );
}
