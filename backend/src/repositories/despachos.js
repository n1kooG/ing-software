import { query } from '../db.js';

export const insertar = async (c, idOrden, idChofer) =>
  (await c.query(`INSERT INTO despacho (id_orden, id_usuario_chofer) VALUES ($1, $2) RETURNING id_despacho`, [idOrden, idChofer])).rows[0].id_despacho;

// Paradas abiertas del chofer más las cerradas hoy (el contador de pendientes baja y el cierre queda visible).
export async function miRuta(idChofer) {
  const { rows } = await query(
    `SELECT ds.id_despacho, ds.id_orden, ds.estado_entrega, ds.fecha_asignacion, ds.fecha_cierre,
            o.codigo_externo, o.nombre_cliente, o.direccion_despacho, o.comuna, o.telefono_contacto, o.numero_documento_sii,
            (SELECT COALESCE(SUM(d.cantidad_vendida), 0)::int FROM detalle_venta d WHERE d.id_orden = o.id_orden) AS bultos
       FROM despacho ds JOIN orden_venta o ON o.id_orden = ds.id_orden
      WHERE ds.id_usuario_chofer = $1 AND (ds.estado_entrega = 'PENDIENTE' OR ds.fecha_cierre >= CURRENT_DATE)
      ORDER BY (ds.estado_entrega <> 'PENDIENTE'), o.comuna, ds.id_despacho`, [idChofer]);
  return rows;
}

export const bloquear = async (c, id) =>
  (await c.query(`SELECT id_despacho, id_orden, id_usuario_chofer, estado_entrega FROM despacho WHERE id_despacho = $1 FOR UPDATE`, [id])).rows[0] ?? null;

export const cerrar = (c, id, estado, motivo, clave) => c.query(
  `UPDATE despacho SET estado_entrega = $2, motivo_rechazo = $3, url_evidencia_s3 = $4, fecha_cierre = now() WHERE id_despacho = $1`, [id, estado, motivo, clave]);
