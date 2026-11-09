import { useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Tabla } from '../componentes/ui.jsx';

const fila = () => ({ sku: '', cantidad: '' });

export default function Descarga() {
  const [numero, setNumero] = useState('');
  const [rut, setRut] = useState('');
  const [pedirRut, setPedirRut] = useState(false);
  const [bultos, setBultos] = useState([fila()]);
  const [error, setError] = useState('');
  const [res, setRes] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const setB = (i, k) => (e) => setBultos(bultos.map((b, j) => (j === i ? { ...b, [k]: e.target.value } : b)));

  async function confirmar(e) {
    e.preventDefault();
    setError(''); setRes(null); setOcupado(true);
    try {
      const cuerpo = { numero_factura: numero, bultos: bultos.map((b) => ({ sku: b.sku, cantidad: Number(b.cantidad) })), ...(rut && { rut_proveedor: rut }) };
      setRes((await api('/compras/descargas', { metodo: 'POST', cuerpo })).data);
      setNumero(''); setRut(''); setPedirRut(false); setBultos([fila()]);
    } catch (err) {
      if (err.codigo === 'FACTURA_AMBIGUA') setPedirRut(true); // misma factura en más de un proveedor
      setError(err.status === 404 ? `No hay una factura ${numero} registrada. Revisa el número.` : mensajeError(err));
    } finally { setOcupado(false); }
  }

  return (
    <div className="movil-pagina">
      <h1>Descarga de camión</h1>
      <p className="tenue">Cuenta los bultos por SKU y confírmalos contra el número de factura.</p>
      {res && (
        <div className={`alerta ${res.estado_documento === 'CONFORME' ? 'info' : ''}`} role="status" style={{ marginTop: 16 }}>
          Factura {res.numero_factura}: <Badge tono={res.estado_documento === 'CONFORME' ? 'ok' : 'mal'}>{res.estado_documento === 'CONFORME' ? 'Conforme' : 'Con discrepancia'}</Badge>
          {res.discrepancias.length > 0 && (
            <Tabla columnas={['SKU', { t: 'Esperado', d: true }, { t: 'Contado', d: true }]}>
              {res.discrepancias.map((d) => <tr key={d.sku}><td className="dato">{d.sku}</td><td className="dato derecha">{d.esperado}</td><td className="dato derecha">{d.contado}</td></tr>)}
            </Tabla>
          )}
        </div>
      )}
      <form onSubmit={confirmar} style={{ marginTop: 20 }}>
        <Campo etiqueta="N° de factura" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} required />
        {pedirRut && <Campo etiqueta="RUT del proveedor" ayuda="Esta factura existe para más de un proveedor." value={rut} onChange={(e) => setRut(e.target.value)} required />}
        <div className="seccion etiqueta">Bultos contados</div>
        {bultos.map((b, i) => (
          <div className="bulto-fila" key={i}>
            <Campo etiqueta="SKU" value={b.sku} onChange={setB(i, 'sku')} required />
            <Campo etiqueta="Cantidad" type="number" inputMode="numeric" min="0" step="1" value={b.cantidad} onChange={setB(i, 'cantidad')} required />
            <Boton className="icono-solo" aria-label="Quitar bulto" icono="x" disabled={bultos.length === 1} onClick={() => setBultos(bultos.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Boton icono="plus" onClick={() => setBultos([...bultos, fila()])}>Agregar SKU</Boton>
        <Alerta>{error}</Alerta>
        <Boton type="submit" variante="primario bloque" disabled={ocupado} style={{ marginTop: 16 }}>{ocupado ? 'Confirmando…' : 'Confirmar descarga'}</Boton>
      </form>
    </div>
  );
}
