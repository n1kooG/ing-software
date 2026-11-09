// HU04 / T17–T22: importación masiva de ventas desde .xlsx. Validación completa antes de escribir; luego una sola transacción.
import path from 'node:path';
import * as repo from '../repositories/pedidos.js';
import * as inventario from '../repositories/inventario.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { almacenamientoActivo, subir } from '../storage.js';
import { formatearRut } from '../rut.js';
import { leerPlanilla } from '../excel.js';

// Canales de la Tabla 26 del documento. La planilla no trae canal: se elige al cargarla.
export const CANALES_VENTA = ['Mercado Libre', 'Paris', 'Ripley', 'Mayorista', 'Venta Directa Web'];
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
const txt = (v) => String(v ?? '').trim();

export function validarCanal(canal) {
  if (!CANALES_VENTA.includes(canal)) throw new AppError(400, `canal inválido; usa uno de: ${CANALES_VENTA.join(', ')}`, 'VALIDACION');
  return canal;
}

function nombreSeguro(original) {
  const base = path.basename(String(original ?? '')).replace(/[^\w.-]/g, '_');
  if (!/\.xlsx$/i.test(base)) throw new AppError(400, 'Solo se aceptan archivos .xlsx', 'ARCHIVO_INVALIDO');
  return base.slice(0, 150);
}

// Informe fila por fila sin escribir nada. Devuelve también los pedidos agrupados (uno por RUT de cliente).
export async function analizar(buffer) {
  const filas = await leerPlanilla(buffer);
  const errores = [];
  const err = (f, m) => errores.push({ fila: f.fila, motivo: m, texto: `fila ${f.fila}: ${m}` });
  const ok = [];
  for (const f of filas) {
    const rut = formatearRut(f.rut), nombre = txt(f.nombre), sku = txt(f.sku).replace(/\s+/g, '').toUpperCase();
    const cantidad = num(f.cantidad), precio = num(f.precio);
    const antes = errores.length;
    if (!txt(f.rut)) err(f, 'RUT CLIENTE es obligatorio'); else if (!rut) err(f, `RUT CLIENTE con formato inválido (${txt(f.rut)})`);
    if (!nombre) err(f, 'NOMBRE CLIENTE es obligatorio'); else if (nombre.length > 120) err(f, 'NOMBRE CLIENTE supera 120 caracteres');
    if (!sku) err(f, 'SKU es obligatorio');
    if (!Number.isInteger(cantidad) || cantidad <= 0) err(f, `CANTIDAD debe ser un entero mayor a 0 (${txt(f.cantidad) || 'vacía'})`);
    if (!Number.isFinite(precio) || precio < 0) err(f, `PRECIO debe ser un número ≥ 0 (${txt(f.precio) || 'vacío'})`);
    if (errores.length === antes) ok.push({ fila: f.fila, rut, nombre, sku, cantidad, precio });
  }
  const invalidos = await repo.rutsInvalidos([...new Set(ok.map((o) => o.rut))]);
  const disponible = await inventario.disponiblePorSku([...new Set(ok.map((o) => o.sku))]);
  const acumulado = new Map(), vistos = new Set(), pedidos = new Map();
  for (const l of ok) {
    if (invalidos.has(l.rut)) { err(l, `RUT CLIENTE con dígito verificador inválido (${l.rut})`); continue; }
    if (!disponible.has(l.sku)) { err(l, `SKU inexistente: ${l.sku}`); continue; }
    if (vistos.has(`${l.rut}|${l.sku}`)) { err(l, `SKU ${l.sku} repetido para el cliente ${l.rut}`); continue; }
    vistos.add(`${l.rut}|${l.sku}`);
    const total = (acumulado.get(l.sku) ?? 0) + l.cantidad; // el stock se valida sobre el total acumulado por SKU
    acumulado.set(l.sku, total);
    if (total > disponible.get(l.sku)) { err(l, `stock insuficiente para ${l.sku}: disponible ${disponible.get(l.sku)}, acumulado en la planilla ${total}`); continue; }
    if (!pedidos.has(l.rut)) pedidos.set(l.rut, { rut: l.rut, nombre: l.nombre, lineas: [] });
    pedidos.get(l.rut).lineas.push(l);
  }
  errores.sort((a, b) => a.fila - b.fila);
  return { filas: filas.length, errores, pedidos: [...pedidos.values()], acumulado };
}

const resumen = (a) => ({ filas: a.filas, pedidos: a.pedidos.length, lineas: a.pedidos.reduce((s, p) => s + p.lineas.length, 0), errores: a.errores });

export async function simular(buffer, archivo, canal) {
  nombreSeguro(archivo); validarCanal(canal);
  const a = await analizar(buffer);
  return { valido: a.errores.length === 0, ...resumen(a) };
}

export async function importar(req, buffer, archivo, canal) {
  const nombre = nombreSeguro(archivo); validarCanal(canal);
  const a = await analizar(buffer);
  if (a.errores.length) {
    throw Object.assign(new AppError(422, `La planilla tiene ${a.errores.length} error(es); no se escribió nada`, 'IMPORTACION_INVALIDA'), { detalle: a.errores });
  }
  const { pedidos: nPedidos, lineas: nLineas } = resumen(a);
  const unidades = [...a.acumulado.values()].reduce((s, v) => s + v, 0);
  // codigo_externo = nombre del archivo + correlativo: reimportar el mismo archivo en el mismo canal choca con UNIQUE(canal_origen, codigo_externo).
  const raiz = nombre.replace(/\.xlsx$/i, '').slice(0, 34);
  const ordenes = a.pedidos.map((p, i) => ({ ...p, codigo: `${raiz}-${String(i + 1).padStart(3, '0')}` }));

  try {
    return await conTransaccion(async (c) => {
      const idLote = await repo.insertarLote(c, { idUsuario: req.usuario.id_usuario, archivo: nombre, ordenes: nPedidos, lineas: nLineas });
      const ids = await repo.insertarOrdenes(c, idLote, canal, ordenes);
      await repo.insertarDetalles(c, ordenes.flatMap((o) => o.lineas.map((l) => ({ idOrden: ids.get(o.codigo), sku: l.sku, cantidad: l.cantidad, precio: l.precio }))));
      for (const sku of [...a.acumulado.keys()].sort()) { // orden fijo: evita interbloqueos entre importaciones simultáneas
        if (!(await inventario.rebajarFisico(sku, a.acumulado.get(sku), c))) throw new AppError(409, `El stock de ${sku} cambió durante la importación; no se escribió nada. Vuelve a simular la carga`, 'STOCK_CAMBIO');
      }
      const clave = `lotes/${idLote}/${nombre}`;
      if (almacenamientoActivo()) await subir(clave, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); // si falla, la transacción se revierte
      await repo.fijarClaveLote(c, idLote, clave); // con almacenamiento desactivado queda la clave prevista pero el objeto no existe (solo desarrollo)
      await auditar(req, {
        idUsuario: req.usuario.id_usuario, tabla: 'lote_importacion', accion: 'IMPORTACIÓN',
        despues: { id_lote: idLote, archivo: nombre, canal, ordenes: nPedidos, lineas: nLineas, unidades },
      }, c);
      return { id_lote: idLote, archivo: nombre, canal, pedidos: nPedidos, lineas: nLineas, unidades, url_archivo_s3: clave };
    });
  } catch (e) {
    if (e.code === '23505') throw new AppError(409, 'Alguno de los pedidos de este archivo ya fue importado en este canal (mismo archivo)', 'PEDIDO_DUPLICADO');
    throw e;
  }
}
