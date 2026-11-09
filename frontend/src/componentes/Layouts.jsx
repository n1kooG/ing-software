import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSesion } from '../sesion.jsx';
import { Boton, Icono, Logo } from './ui.jsx';

export const ROL = { ADMINISTRADOR: 'Administrador', BODEGA: 'Bodega', CHOFER: 'Chofer' };

// Panel de oficina: módulos de los Sprints 1 y 2.
const ITEMS = [['/catalogo', 'Catálogo Maestro', 'caja'], ['/compras', 'Recepción de Compras', 'factura'], ['/importacion', 'Carga de Pedidos', 'subir'], ['/usuarios', 'Usuarios y Roles', 'usuarios']];

export function Oficina() {
  const { usuario, logout } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setAbierto(false), [pathname]);
  return (
    <div className="oficina">
      <header className="topbar-movil">
        <Boton className="icono-solo" aria-label="Abrir menú" onClick={() => setAbierto(true)}><Icono n="menu" /></Boton>
        <strong>Tienda Oregón</strong>
      </header>
      <aside className={`sidebar ${abierto ? 'abierto' : ''}`} aria-label="Navegación principal">
        <Link to="/dashboard" className="marca"><Logo /><span><strong>Tienda Oregón</strong><small>SGI · Módulo Jefatura</small></span></Link>
        <nav className="nav">
          {ITEMS.map(([to, txt, ic]) => <NavLink key={to} to={to}><Icono n={ic} />{txt}</NavLink>)}
        </nav>
        <div className="pie-usuario">
          <strong>{usuario.nombre}</strong>
          <span className="rol">{ROL[usuario.rol] ?? usuario.rol}</span>
          <button type="button" onClick={logout}><Icono n="salir" />Salir del sistema</button>
        </div>
      </aside>
      <div className="velo-nav" onClick={() => setAbierto(false)} />
      <main className="contenido"><Outlet /></main>
    </div>
  );
}

export function Bienvenida({ texto }) {
  const { usuario } = useSesion();
  return (
    <section className="bienvenida">
      <span className="etiqueta">Bienvenido</span>
      <h1>{usuario.nombre}</h1>
      <span className="badge">{ROL[usuario.rol] ?? usuario.rol}</span>
      <hr />
      <p className="tenue">{texto}</p>
    </section>
  );
}

function CabMovil({ panel }) {
  const { logout } = useSesion();
  return (
    <header className="movil-cab">
      <Logo />
      <div className="quien"><strong>Tienda Oregón</strong><small>{panel}</small></div>
      <Boton icono="salir" onClick={logout}>Salir</Boton>
    </header>
  );
}

// Chofer: móvil, solo bienvenida por ahora.
export function Movil({ panel, texto }) {
  return <div className="movil"><CabMovil panel={panel} /><main><Bienvenida texto={texto} /></main></div>;
}

// Bodega: cabecera + contenido + navegación inferior (solo lo habilitado en el Sprint 2).
export function MovilBodega() {
  return (
    <div className="movil con-nav">
      <CabMovil panel="Panel bodega" />
      <main><Outlet /></main>
      <nav className="nav-inferior" aria-label="Navegación de bodega">
        <NavLink to="/bodega" end><Icono n="casa" />Inicio</NavLink>
        <NavLink to="/bodega/descarga"><Icono n="camion" />Descarga</NavLink>
      </nav>
    </div>
  );
}
