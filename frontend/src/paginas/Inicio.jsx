import { Link } from 'react-router-dom';
import { Icono } from '../componentes/ui.jsx';
import { useSesion } from '../sesion.jsx';

export default function Inicio() {
  const { usuario } = useSesion();
  return (
    <>
      <div className="cabecera"><div><h1>Bienvenido, {usuario.nombre}</h1></div></div>
      <div className="accesos">
        <Link className="acceso" to="/catalogo"><Icono n="caja" /><div><strong>Catálogo Maestro</strong><span>Productos, costos y precios por canal.</span></div></Link>
        <Link className="acceso" to="/compras"><Icono n="factura" /><div><strong>Recepción de Compras</strong><span>Factura del proveedor, IVA y stock.</span></div></Link>
        <Link className="acceso" to="/importacion"><Icono n="subir" /><div><strong>Carga de Pedidos</strong><span>Importa ventas por canal desde Excel.</span></div></Link>
        <Link className="acceso" to="/usuarios"><Icono n="usuarios" /><div><strong>Usuarios y Roles</strong><span>Accesos y restricción de costos y márgenes.</span></div></Link>
      </div>
    </>
  );
}
