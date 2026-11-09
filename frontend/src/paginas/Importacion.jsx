import { useRef, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Badge, Boton, Campo, Tabla, useAviso } from '../componentes/ui.jsx';

const CANALES = ['Mercado Libre', 'Paris', 'Ripley', 'Mayorista', 'Venta Directa Web'];

export default function Importacion() {
  const avisar = useAviso();
  const entrada = useRef(null);
  const [archivo, setArchivo] = useState(null);
  const [canal, setCanal] = useState(CANALES[0]);
  const [arrastrando, setArrastrando] = useState(false);
  const [sim, setSim] = useState(null); // resultado de simular (o del 422 de importar)
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [hecho, setHecho] = useState(null);

  function elegir(f) {
    setSim(null); setError(''); setHecho(null);
    if (f && !/\.xlsx$/i.test(f.name)) { setArchivo(null); return setError('Solo se aceptan archivos .xlsx'); }
    if (f && f.size > 10 * 1024 * 1024) { setArchivo(null); return setError('El archivo supera 10 MB'); }
    setArchivo(f ?? null);
  }
  const form = () => { const d = new FormData(); d.append('archivo', archivo); d.append('canal', canal); return d; };

  async function ejecutar(ruta) {
    setOcupado(true); setError(''); setHecho(null);
    try { return (await api(ruta, { metodo: 'POST', cuerpo: form() })).data; }
    catch (e) {
      if (e.status === 422 && e.detalle) setSim({ valido: false, errores: e.detalle, filas: null });
      setError(mensajeError(e)); // 409: reimportación (PEDIDO_DUPLICADO) o stock que cambió (STOCK_CAMBIO)
      return null;
    } finally { setOcupado(false); }
  }
  async function simular() { const d = await ejecutar('/pedidos/importaciones/simular'); if (d) setSim(d); }
  async function importar() {
    const d = await ejecutar('/pedidos/importaciones');
    if (d) { setHecho(d); setSim(null); setArchivo(null); avisar('Importación completada'); }
  }
  async function plantilla() {
    try {
      const { data } = await api('/pedidos/importaciones/plantilla', { blob: true });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(data), download: 'plantilla_ventas.xlsx' });
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setError(mensajeError(e)); }
  }

  return (
    <>
      <div className="cabecera">
        <div><h1>Carga Masiva de Pedidos</h1><p>Importa las ventas de un canal desde Excel. Primero simula: no se escribe nada hasta confirmar.</p></div>
        <Boton icono="caja" onClick={plantilla}>Descargar plantilla</Boton>
      </div>
      <div className="panel">
        <div
          className={`zona-carga ${arrastrando ? 'activa' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files[0]); }}
        >
          <p><strong>{archivo ? archivo.name : 'Arrastra aquí tu archivo .xlsx'}</strong></p>
          <p className="tenue">{archivo ? `${(archivo.size / 1024).toFixed(0)} KB` : 'o selecciónalo desde tu equipo (máx. 10 MB)'}</p>
          <Boton onClick={() => entrada.current.click()}>Seleccionar archivo</Boton>
          <input ref={entrada} type="file" accept=".xlsx" hidden aria-label="Archivo .xlsx" onChange={(e) => { elegir(e.target.files[0]); e.target.value = ''; }} />
        </div>
        <Campo etiqueta="Canal de venta" como="select" value={canal} onChange={(e) => { setCanal(e.target.value); setSim(null); }} className="canal-sel">
          {CANALES.map((c) => <option key={c}>{c}</option>)}
        </Campo>
        <Alerta>{error}</Alerta>
        {sim?.valido && <div className="alerta info" role="status">Planilla válida: {sim.pedidos} pedidos, {sim.lineas} líneas ({sim.filas} filas). Puedes importarla.</div>}
        <div className="acciones">
          <Boton onClick={simular} disabled={!archivo || ocupado}>Simular carga</Boton>
          <Boton variante="primario" onClick={importar} disabled={!sim?.valido || ocupado}>Importar pedidos</Boton>
        </div>
      </div>

      {hecho && (
        <div className="alerta info" role="status" style={{ marginTop: 20 }}>
          Lote {hecho.id_lote} importado en {hecho.canal}: {hecho.pedidos} pedidos, {hecho.lineas} líneas, {hecho.unidades} unidades descontadas del stock.
        </div>
      )}
      {sim && !sim.valido && sim.errores?.length > 0 && (
        <>
          <h2 style={{ margin: '24px 0 12px' }}>Errores por fila <Badge tono="mal">{sim.errores.length}</Badge></h2>
          <Tabla columnas={[{ t: 'Fila', d: true }, 'Motivo']}>
            {sim.errores.map((r, i) => <tr key={i}><td className="dato derecha">{r.fila}</td><td>{r.motivo}</td></tr>)}
          </Tabla>
        </>
      )}
    </>
  );
}
