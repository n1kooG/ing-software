import * as repo from '../repositories/productos.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';

export const CANALES = ['WEB', 'MARKETPLACE', 'MAYORISTA'];
const bad = (msg) => new AppError(400, msg, 'VALIDACION');
const vis = (permisos) => ({ verCostos: permisos.includes('costos:leer'), verPrecios: permisos.includes('precios:leer') });
const normSku = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

const texto = (v, campo, max, obligatorio) => {
  if (v === undefined || v === null || v === '') {
    if (obligatorio) throw bad(`El campo ${campo} es obligatorio`);
    return null;
  }
  if (typeof v !== 'string') throw bad(`El campo ${campo} debe ser texto`);
  const t = v.trim();
  if (!t && obligatorio) throw bad(`El campo ${campo} es obligatorio`);
  if (t.length > max) throw bad(`El campo ${campo} admite máximo ${max} caracteres`);
  return t || null;
};
const numero = (v, campo, { entero = false, min = 0 } = {}) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || (entero && !Number.isInteger(v))) {
    throw bad(`El campo ${campo} debe ser un número ${entero ? 'entero ' : ''}mayor o igual a ${min}`);
  }
  return v;
};
const NOMBRES = { modelo: 60, nombre: 150, marca: 60 };

// SQLSTATE 23505 = unique_violation (PK de producto).
const duplicado = (e, sku) => e.code === '23505' ? new AppError(409, `Ya existe un producto con el SKU ${sku}`, 'SKU_DUPLICADO') : e;

export async function listar(permisos, { q, pagina, limite }) {
  const lim = Math.min(Math.max(parseInt(limite) || 50, 1), 200);
  const pag = Math.max(parseInt(pagina) || 1, 1);
  return repo.listar(vis(permisos), { q: typeof q === 'string' ? q.trim() : '', limite: lim, offset: (pag - 1) * lim });
}

export async function obtener(permisos, sku) {
  const p = await repo.obtener(vis(permisos), normSku(sku));
  if (!p) throw new AppError(404, 'Producto no encontrado', 'NO_ENCONTRADO');
  return p;
}

export async function crear(req, body = {}) {
  const sku = normSku(body.sku);
  if (!sku) throw bad('El campo sku es obligatorio');
  if (sku.length > 30) throw bad('El campo sku admite máximo 30 caracteres');
  const p = {
    sku,
    modelo: texto(body.modelo, 'modelo', 60, true),
    nombre: texto(body.nombre, 'nombre', 150, true),
    marca: texto(body.marca, 'marca', 60, true),
    descripcion: texto(body.descripcion, 'descripcion', 5000, false),
    categoria: texto(body.categoria, 'categoria', 60, false),
    costo_adquisicion_neto: numero(body.costo_adquisicion_neto, 'costo_adquisicion_neto'),
    stock_minimo: body.stock_minimo === undefined ? 0 : numero(body.stock_minimo, 'stock_minimo', { entero: true }),
  };
  try {
    await conTransaccion(async (db) => {
      const nuevo = await repo.crear(db, p);
      await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'producto', accion: 'CREAR', despues: nuevo }, db);
    });
  } catch (e) { throw duplicado(e, sku); }
  return obtener(req.usuario.permisos, sku);
}

export async function editar(req, skuParam, body = {}) {
  const sku = normSku(skuParam);
  // El SKU es inmutable: un cuerpo que intente cambiarlo se rechaza con mensaje claro.
  if (body.sku !== undefined && normSku(body.sku) !== sku) throw bad('El SKU no se puede modificar');
  const campos = {};
  for (const [k, max] of Object.entries(NOMBRES)) if (body[k] !== undefined) campos[k] = texto(body[k], k, max, true);
  if (body.descripcion !== undefined) campos.descripcion = texto(body.descripcion, 'descripcion', 5000, false);
  if (body.categoria !== undefined) campos.categoria = texto(body.categoria, 'categoria', 60, false);
  if (body.stock_minimo !== undefined) campos.stock_minimo = numero(body.stock_minimo, 'stock_minimo', { entero: true });
  if (body.estado !== undefined) {
    if (!['ACTIVO', 'INACTIVO'].includes(body.estado)) throw bad('El estado debe ser ACTIVO o INACTIVO');
    campos.estado = body.estado;
  }
  // El costo se cambia solo con costos:leer (quien lo ve, lo gestiona); el trigger recalcula los márgenes.
  if (body.costo_adquisicion_neto !== undefined) {
    if (!req.usuario.permisos.includes('costos:leer')) throw new AppError(403, 'No tienes permiso para modificar el costo', 'ACCESO_DENEGADO');
    campos.costo_adquisicion_neto = numero(body.costo_adquisicion_neto, 'costo_adquisicion_neto');
  }
  if (!Object.keys(campos).length) throw bad('No hay campos para modificar');

  await conTransaccion(async (db) => {
    const antes = await repo.obtenerParaAuditoria(db, sku, true);
    if (!antes) throw new AppError(404, 'Producto no encontrado', 'NO_ENCONTRADO');
    await repo.actualizar(db, sku, campos);
    // Un costo mayor o igual a un precio vigente dejaría un margen no positivo: se revierte todo.
    if (campos.costo_adquisicion_neto !== undefined && await repo.hayPrecioNoSuperaCosto(db, sku)) {
      throw new AppError(400, 'El nuevo costo no puede ser mayor o igual a un precio de venta vigente; actualiza primero los precios', 'PRECIO_INVALIDO');
    }
    const despues = await repo.obtenerParaAuditoria(db, sku);
    const accion = campos.estado && campos.estado !== antes.estado ? (campos.estado === 'INACTIVO' ? 'INACTIVAR' : 'REACTIVAR') : 'EDITAR';
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'producto', accion, antes, despues }, db);
  });
  return obtener(req.usuario.permisos, sku);
}

export async function fijarPrecio(req, skuParam, canalParam, body = {}) {
  const sku = normSku(skuParam);
  const canal = String(canalParam ?? '').toUpperCase();
  if (!CANALES.includes(canal)) throw bad(`Canal inválido. Canales permitidos: ${CANALES.join(', ')}`);
  const extra = Object.keys(body).filter((k) => k !== 'precio');
  if (extra.length) throw bad('Solo se acepta el campo precio: el margen se calcula automáticamente y el costo no se modifica aquí');
  const precio = numero(body.precio, 'precio', { min: 0.01 });
  const verCostos = req.usuario.permisos.includes('costos:leer');

  const fila = await conTransaccion(async (db) => {
    if (!(await repo.obtenerParaAuditoria(db, sku, true))) throw new AppError(404, 'Producto no encontrado', 'NO_ENCONTRADO');
    const antes = await repo.precioActual(db, sku, canal);
    let nuevo;
    try {
      nuevo = await repo.fijarPrecio(db, sku, canal, precio);
    } catch (e) {
      throw e.code === '23514' ? new AppError(400, e.message, 'PRECIO_INVALIDO') : e;
    }
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'lista_precio', accion: 'CAMBIAR_PRECIO',
      antes: antes && { sku, canal, ...antes }, despues: { sku, canal, ...nuevo } }, db);
    return nuevo;
  });
  return { sku, canal: fila.canal_venta, precio: fila.precio_venta_neto, ...(verCostos && { margen: fila.margen_porcentual }) };
}
