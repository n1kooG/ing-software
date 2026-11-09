import PDFDocument from 'pdfkit';
import * as repo from '../repositories/pedidos.js';
import * as despachos from '../repositories/despachos.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { tiene } from '../middleware/auth.js';

const bad = (msg, status = 400, codigo = 'VALIDACION') => new AppError(status, msg, codigo);
const BODEGA = ['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION']; // los 4 estados reversibles (Tabla 17)
const ESTADOS = [...BODEGA, 'EN_RUTA', 'ENTREGADO', 'RECHAZADO'];

// Los errores de los triggers del esquema (transición no permitida, chofer inválido) son 409; la regla vive en la BD, no se repite aquí.
const dePg = (e) => {
  if (e.code === '23514') throw bad(e.message, 409, 'TRANSICION_INVALIDA');
  if (e.code === '23505') throw bad('El pedido ya tiene un despacho asignado', 409, 'YA_ASIGNADO');
  throw e;
};

// Bodega (sin pedidos:leer) ve solo lo que debe preparar; el Administrador ve todo para supervisar (CU-06).
export function listar(req, { estado, canal } = {}) {
  if (estado && !ESTADOS.includes(estado)) throw bad('Estado inválido');
  const estados = estado ? [estado] : tiene(req, 'pedidos:leer') ? null : BODEGA;
  return repo.listar(estados, canal ? String(canal) : null);
}

async function existente(id) {
  const o = await repo.obtener(id);
  if (!o) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
  return o;
}

export async function detalle(req, id) {
  const o = await existente(id);
  const items = await repo.items(id);
  // El precio de venta es del Administrador (precios:leer); Bodega solo recibe lo que necesita para recolectar.
  return { ...o, items: tiene(req, 'precios:leer') ? items : items.map(({ precio_unitario, subtotal, ...resto }) => resto) };
}

export async function cambiarEstado(req, id, estado) {
  if (!BODEGA.includes(estado)) throw bad(`Estado inválido. Permitidos: ${BODEGA.join(', ')}`);
  try {
    return await conTransaccion(async (c) => {
      const antes = await repo.bloquear(c, id);
      if (!antes) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
      if (antes === estado) return { id_orden: id, estado_orden: estado };
      await repo.fijarEstado(c, id, estado);
      await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'CAMBIO_ESTADO', antes: { id_orden: id, estado_orden: antes }, despues: { id_orden: id, estado_orden: estado } }, c);
      return { id_orden: id, estado_orden: estado };
    });
  } catch (e) { return dePg(e); }
}

// Discrepancia de picking (dañado / faltante): no hay tabla propia, queda en la bitácora inmutable.
export async function comentar(req, id, { sku, tipo, comentario } = {}) {
  await existente(id);
  if (!['DANADO', 'FALTANTE'].includes(tipo)) throw bad('tipo debe ser DANADO o FALTANTE');
  const txt = typeof comentario === 'string' ? comentario.trim() : '';
  if (!txt || txt.length > 300) throw bad('El comentario es obligatorio (máximo 300 caracteres)');
  const s = String(sku ?? '').trim().toUpperCase();
  if (!(await repo.skuEnOrden(id, s))) throw bad(`El SKU ${s} no pertenece al pedido`, 422, 'SKU_FUERA_DE_PEDIDO');
  await conTransaccion((c) => auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'DISCREPANCIA', despues: { id_orden: id, sku: s, tipo, comentario: txt } }, c));
  return { id_orden: id, sku: s, tipo, comentario: txt };
}

// Etiqueta de despacho 10×15 cm (CU-10). Se genera en memoria; no se guarda.
export async function etiqueta(req, id) {
  const o = await detalle(req, id);
  const doc = new PDFDocument({ size: [283, 425], margin: 16 });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  doc.fontSize(16).text(o.codigo_externo, { align: 'center' }).fontSize(9).text(`Canal: ${o.canal_origen}`, { align: 'center' }).moveDown(0.6);
  doc.fontSize(11).text(o.nombre_cliente).fontSize(9)
    .text(o.direccion_despacho ?? 'Sin dirección registrada').text(o.comuna ?? '').text(o.telefono_contacto ?? '').moveDown(0.6);
  doc.fontSize(9).text('Contenido:');
  for (const i of o.items) doc.text(`${i.cantidad} x ${i.sku} - ${i.nombre}`, { width: 250 });
  doc.end();
  await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'orden_venta', accion: 'ETIQUETA', despues: { id_orden: id } });
  return { pdf: await fin, nombre: `etiqueta_${o.codigo_externo}.pdf` };
}

// CU-06 / T50: asigna chofer (EN_CAMION -> EN_RUTA) y crea el despacho en una sola transacción con su auditoría.
export async function asignarChofer(req, id, idChofer) {
  if (!Number.isInteger(idChofer) || idChofer <= 0) throw bad('id_chofer debe ser un entero');
  try {
    return await conTransaccion(async (c) => {
      const antes = await repo.bloquear(c, id);
      if (!antes) throw new AppError(404, 'Pedido no encontrado', 'NO_ENCONTRADO');
      const idDespacho = await despachos.insertar(c, id, idChofer); // trg_despacho_solo_chofer exige un CHOFER activo
      await repo.fijarEstado(c, id, 'EN_RUTA'); // trg_orden_transicion exige EN_CAMION
      await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'despacho', accion: 'ASIGNACION_CHOFER', antes: { id_orden: id, estado_orden: antes }, despues: { id_orden: id, id_despacho: idDespacho, id_usuario_chofer: idChofer, estado_orden: 'EN_RUTA' } }, c);
      return { id_despacho: idDespacho, id_orden: id, id_usuario_chofer: idChofer, estado_orden: 'EN_RUTA' };
    });
  } catch (e) { return dePg(e); }
}
