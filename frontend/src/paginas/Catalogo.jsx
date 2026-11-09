import { useCallback, useEffect, useState } from 'react';
import { api, mensajeError } from '../api.js';
import { Alerta, Boton, Campo, Icono, Modal, Tabla, clp, pct, useAviso } from '../componentes/ui.jsx';
import { useSesion } from '../sesion.jsx';

const LIM = 10;
const CANALES = [['WEB', 'Web'], ['MARKETPLACE', 'Marketplace'], ['MAYORISTA', 'Mayorista']];
const precioDe = (p, canal) => p.precios?.[canal]?.precio;

export default function Catalogo() {
  const [q, setQ] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState({ filas: [], total: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(null); // null | { producto?: fila } (sin producto = crear)

  useEffect(() => { const t = setTimeout(() => { setBusca(q.trim()); setPagina(1); }, 300); return () => clearTimeout(t); }, [q]);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const { data, total } = await api(`/productos?q=${encodeURIComponent(busca)}&pagina=${pagina}&limite=${LIM}`);
      setDatos({ filas: data, total });
    } catch (e) { setError(mensajeError(e)); } finally { setCargando(false); }
  }, [busca, pagina]);
  useEffect(() => { cargar(); }, [cargar]);

  const { filas, total } = datos;
  const paginas = Math.max(1, Math.ceil(total / LIM));
  const desde = total ? (pagina - 1) * LIM + 1 : 0;
  const cerrar = useCallback(() => setPanel(null), []);

  return (
    <>
      <div className="cabecera">
        <div>
          <h1>Catálogo Maestro de Productos</h1>
          <p>Identificación única con SKU inmutable, costos de adquisición y precios por canal.</p>
        </div>
        <Boton variante="primario" icono="plus" onClick={() => setPanel({})}>Crear producto</Boton>
      </div>

      <div className="barra-herr">
        <div className="buscador">
          <Icono n="search" />
          <input className="entrada" type="search" aria-label="Buscar por SKU, modelo o marca" placeholder="Buscar por SKU, modelo o marca" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="tenue">{total} {total === 1 ? 'producto' : 'productos'}</span>
      </div>

      <Alerta>{error}</Alerta>
      <Tabla
        columnas={['SKU', 'Descripción / Modelo', 'Marca', 'Ubicación', { t: 'Costo neto ($)', d: 1 }, { t: 'Precio Web ($)', d: 1 }, { t: 'Precio Mayorista ($)', d: 1 }, { t: 'Stock físico', d: 1 }, 'Acción']}
        vacio={!cargando && !filas.length && !error ? (busca ? 'Sin resultados para la búsqueda.' : 'Aún no hay productos.') : cargando ? 'Cargando…' : null}
      >
        {filas.map((p) => {
          const bajo = p.stock_minimo > 0 && p.stock_fisico < p.stock_minimo;
          return (
            <tr key={p.sku}>
              <td className="dato">{p.sku}</td>
              <td>{p.nombre}<div className="dato celda-sec">{p.modelo}</div></td>
              <td>{p.marca}</td>
              <td>{p.ubicacion_bodega ?? <span className="celda-sec">Sin ubicación</span>}</td>
              <td className="dato derecha">{clp(p.costo_adquisicion_neto) ?? '—'}</td>
              <td className="dato derecha">{clp(precioDe(p, 'WEB')) ?? '—'}</td>
              <td className="dato derecha">{clp(precioDe(p, 'MAYORISTA')) ?? '—'}</td>
              <td className="dato derecha" style={bajo ? { color: 'var(--danger)' } : undefined}>{bajo && '● '}{p.stock_fisico ?? 0} un.</td>
              <td><Boton className="icono-solo" aria-label={`Editar ${p.sku}`} onClick={() => setPanel({ producto: p })}><Icono n="pencil" /></Boton></td>
            </tr>
          );
        })}
      </Tabla>

      <div className="paginacion">
        <span>{total ? `Mostrando ${desde}–${desde + filas.length - 1} de ${total}` : ''}</span>
        <div className="pags">
          <Boton className="icono-solo" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}><Icono n="izq" /></Boton>
          <Boton className="icono-solo pag-activa" aria-current="page">{pagina}</Boton>
          <Boton className="icono-solo" aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}><Icono n="der" /></Boton>
        </div>
      </div>

      {panel && <FormProducto producto={panel.producto} onClose={cerrar} onCambios={cargar} />}
    </>
  );
}

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

function FormProducto({ producto, onClose, onCambios }) {
  const { puede } = useSesion();
  const avisar = useAviso();
  const editar = !!producto;
  const verCostos = puede('costos:leer');
  const [f, setF] = useState(() => ({
    sku: producto?.sku ?? '', modelo: producto?.modelo ?? '', marca: producto?.marca ?? '', nombre: producto?.nombre ?? '',
    categoria: producto?.categoria ?? '', descripcion: producto?.descripcion ?? '',
    costo: producto?.costo_adquisicion_neto ? String(Number(producto.costo_adquisicion_neto)) : '', stock_minimo: String(producto?.stock_minimo ?? 0),
    activo: (producto?.estado ?? 'ACTIVO') === 'ACTIVO',
    ...Object.fromEntries(CANALES.map(([c]) => [`p_${c}`, precioDe(producto ?? {}, c) ? String(Number(precioDe(producto, c))) : ''])),
  }));
  const [err, setErr] = useState({});
  const [alerta, setAlerta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: k === 'sku' ? e.target.value.toUpperCase() : e.target.value }); setErr({ ...err, [k]: undefined }); };

  function validar() {
    const e = {};
    const vacio = 'Campo obligatorio';
    if (!editar && !f.sku.trim()) e.sku = vacio;
    for (const k of ['modelo', 'marca', 'nombre']) if (!f[k].trim()) e[k] = vacio;
    if (verCostos) { if (f.costo === '') e.costo = vacio; else if (!(num(f.costo) >= 0)) e.costo = 'Debe ser un número mayor o igual a 0'; }
    if (!Number.isInteger(num(f.stock_minimo)) || num(f.stock_minimo) < 0) e.stock_minimo = 'Debe ser un entero mayor o igual a 0';
    for (const [c] of CANALES) {
      const v = f[`p_${c}`];
      if (v !== '' && !(num(v) > 0)) e[`p_${c}`] = 'Debe ser mayor a 0';
      if (v === '' && precioDe(producto ?? {}, c)) e[`p_${c}`] = 'El precio no puede quedar vacío';
    }
    setErr(e);
    return !Object.keys(e).length;
  }

  async function guardar(ev) {
    ev.preventDefault();
    setAlerta('');
    if (!validar()) return;
    setEnviando(true);
    const datos = { modelo: f.modelo, marca: f.marca, nombre: f.nombre, categoria: f.categoria, descripcion: f.descripcion, stock_minimo: num(f.stock_minimo) };
    const sku = editar ? producto.sku : f.sku.trim();
    const cambios = CANALES.filter(([c]) => f[`p_${c}`] !== '' && num(f[`p_${c}`]) !== Number(precioDe(producto ?? {}, c) ?? NaN));
    const pasoPrecios = async () => { for (const [c] of cambios) await api(`/productos/${sku}/precios/${c}`, { metodo: 'PUT', cuerpo: { precio: num(f[`p_${c}`]) } }); };
    const pasoProducto = () => editar
      ? api(`/productos/${sku}`, { metodo: 'PUT', cuerpo: { ...datos, estado: f.activo ? 'ACTIVO' : 'INACTIVO', ...(verCostos && { costo_adquisicion_neto: num(f.costo) }) } })
      : api('/productos', { metodo: 'POST', cuerpo: { sku, ...datos, costo_adquisicion_neto: num(f.costo) } });
    // Un costo mayor exige fijar primero los precios; en los demás casos el producto va primero.
    const costoSube = editar && verCostos && num(f.costo) > Number(producto.costo_adquisicion_neto);
    let hecho = false;
    try {
      for (const paso of costoSube ? [pasoPrecios, pasoProducto] : [pasoProducto, pasoPrecios]) { await paso(); hecho = true; }
      avisar(editar ? 'Cambios guardados' : 'Producto creado');
      onCambios(); onClose();
    } catch (e) {
      if (e.codigo === 'SKU_DUPLICADO') setErr({ sku: 'El SKU ya existe en el catálogo' });
      else { setAlerta(mensajeError(e)); document.querySelector('.modal-cuerpo')?.scrollTo(0, 0); }
      if (hecho) onCambios();
    } finally { setEnviando(false); }
  }

  return (
    <Modal lado titulo={editar ? 'Editar producto' : 'Crear producto'} subtitulo={editar ? `${producto.sku} · ${producto.nombre}` : 'Completa los datos del nuevo producto'} onClose={onClose}
      pie={<><Boton onClick={onClose}>Cancelar</Boton><Boton variante="primario" type="submit" form="form-producto" disabled={enviando}>{enviando ? 'Guardando…' : editar ? 'Guardar cambios' : 'Crear producto'}</Boton></>}>
      <form id="form-producto" onSubmit={guardar} noValidate>
        <Alerta>{alerta}</Alerta>
        <div className="seccion etiqueta">Identificación</div>
        <Campo etiqueta="SKU" value={f.sku} onChange={set('sku')} readOnly={editar} error={err.sku} data-inicial={editar ? undefined : ''} placeholder="Ej. TH-4500" maxLength={30}
          ayuda={editar && <><Icono n="lock" />SKU inmutable: no se puede modificar después de creado.</>} />
        <div className="grid2">
          <Campo etiqueta="Modelo" value={f.modelo} onChange={set('modelo')} error={err.modelo} placeholder="Ej. TH-4500" />
          <Campo etiqueta="Marca" value={f.marca} onChange={set('marca')} error={err.marca} placeholder="Ej. Thomas" />
        </div>
        <Campo etiqueta="Nombre del producto" value={f.nombre} onChange={set('nombre')} error={err.nombre} placeholder="Ej. Hervidor Eléctrico 1.7L" />
        <div className="grid2">
          <Campo etiqueta="Categoría (opcional)" value={f.categoria} onChange={set('categoria')} placeholder="Sin categoría" />
          <Campo etiqueta="Descripción (opcional)" value={f.descripcion} onChange={set('descripcion')} placeholder="Sin descripción" />
        </div>

        <div className="seccion etiqueta">Costo e inventario</div>
        <div className="grid2">
          {verCostos && <Campo etiqueta="Costo de adquisición neto ($)" type="number" min="0" inputMode="decimal" value={f.costo} onChange={set('costo')} error={err.costo} placeholder="0" />}
          <Campo etiqueta="Stock mínimo (un.)" type="number" min="0" value={f.stock_minimo} onChange={set('stock_minimo')} error={err.stock_minimo} />
          {editar && <Campo etiqueta="Ubicación en bodega" value={producto.ubicacion_bodega ?? ''} readOnly placeholder="Sin ubicación" />}
          {editar && <Campo etiqueta="Stock físico (un.)" value={producto.stock_fisico ?? 0} readOnly />}
        </div>
        {editar && (
          <div className="interruptor">
            <button type="button" role="switch" aria-checked={f.activo} aria-label="Producto activo" onClick={() => setF({ ...f, activo: !f.activo })} />
            <span>Producto activo</span><span className="tenue">Inactivar no borra el historial.</span>
          </div>
        )}

        <div className="seccion etiqueta">Precios por canal</div>
        {CANALES.map(([c, nombre]) => {
          const margen = producto?.precios?.[c]?.margen;
          return (
            <div className="precio-fila" key={c}>
              <span className="canal">{nombre}</span>
              <Campo etiqueta="Precio de venta neto ($)" type="number" min="0" inputMode="decimal" value={f[`p_${c}`]} onChange={set(`p_${c}`)} error={err[`p_${c}`]} placeholder="Sin precio" />
              {verCostos && <div><span className="etiqueta">Margen</span><div className="dato margen" style={margen === undefined ? { color: 'var(--ink-3)' } : undefined}>{pct(margen) ?? '—'}</div></div>}
            </div>
          );
        })}
        {verCostos && <p className="tenue" style={{ fontSize: 13 }}>El margen se calcula automáticamente con el costo registrado y solo lo ve el Administrador.</p>}
      </form>
    </Modal>
  );
}
