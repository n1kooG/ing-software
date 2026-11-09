import { query } from '../db.js';

export const skusExistentes = async (skus) =>
  new Set((await query(`SELECT sku FROM producto WHERE sku = ANY($1) AND estado = 'ACTIVO'`, [skus])).rows.map((r) => r.sku));

export async function insertarRecepcion(c, r) {
  const { rows } = await c.query(
    `INSERT INTO recepcion_compra (id_usuario, numero_factura, rut_proveedor, nombre_proveedor, fecha_emision, forma_pago, url_pdf_factura, monto_neto, monto_iva, monto_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id_recepcion`,
    [r.idUsuario, r.numeroFactura, r.rutProveedor, r.nombreProveedor, r.fechaEmision, r.formaPago, r.clavePdf, r.neto, r.iva, r.total]);
  return rows[0].id_recepcion;
}

export const insertarDetalle = (c, idRecepcion, items) => c.query(
  `INSERT INTO detalle_recepcion (id_recepcion, sku, cantidad_recibida, precio_unitario_neto)
   SELECT $1, sku, cant, precio FROM unnest($2::text[], $3::int[], $4::numeric[]) AS t(sku, cant, precio)`,
  [idRecepcion, items.map((i) => i.sku), items.map((i) => i.cantidad), items.map((i) => i.precio)]);

// Sin precios: sirve a Bodega (T49).
export async function recepcionesPorFactura(numeroFactura, rutProveedor) {
  const { rows } = await query(
    `SELECT id_recepcion, numero_factura, nombre_proveedor, estado_documento FROM recepcion_compra
      WHERE numero_factura = $1 AND ($2::text IS NULL OR rut_proveedor = $2)`, [numeroFactura, rutProveedor]);
  return rows;
}

export const detalleEsperado = async (idRecepcion, c) =>
  (await c.query(`SELECT sku, cantidad_recibida::int AS cantidad FROM detalle_recepcion WHERE id_recepcion = $1 ORDER BY sku`, [idRecepcion])).rows;

export const marcarEstado = (c, idRecepcion, estado) =>
  c.query(`UPDATE recepcion_compra SET estado_documento = $2 WHERE id_recepcion = $1`, [idRecepcion, estado]);
