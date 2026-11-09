import { query } from '../db.js';

export async function kpis() {
  const [{ rows: [k] }, { rows: criticos }] = await Promise.all([
    query(`SELECT COALESCE(SUM(i.stock_fisico * p.costo_adquisicion_neto), 0)::float AS valorizacion_inventario,
                  (SELECT COUNT(*) FROM orden_venta WHERE estado_orden IN ('PENDIENTE_PREPARACION','ARMADO','ETIQUETADO'))::int AS ordenes_pendientes,
                  (SELECT ROUND(AVG(margen_porcentual), 1)::float FROM lista_precio) AS margen_promedio
             FROM inventario i JOIN producto p ON p.sku = i.sku WHERE p.estado = 'ACTIVO'`),
    query(`SELECT sku, nombre, marca, stock_fisico, stock_minimo, ubicacion_bodega FROM v_stock_critico ORDER BY sku`),
  ]);
  return { ...k, stock_critico: criticos.length, productos_criticos: criticos };
}
