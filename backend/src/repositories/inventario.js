import { query } from '../db.js';

// Sin costos ni márgenes: sirve a Bodega. Usa los índices GIN/trigramas del modelo.
export async function buscar(q) {
  const { rows } = await query(
    `SELECT p.sku, p.modelo, p.nombre, p.marca,
            i.stock_fisico, i.stock_reservado, (i.stock_fisico - i.stock_reservado) AS stock_disponible,
            i.ubicacion_bodega
       FROM producto p JOIN inventario i ON i.sku = p.sku
      WHERE p.estado = 'ACTIVO'
        AND (p.sku ILIKE $1 || '%' OR p.modelo ILIKE '%' || $1 || '%' OR p.nombre ILIKE '%' || $1 || '%')
      ORDER BY (p.sku = upper($1)) DESC, (p.sku ILIKE $1 || '%') DESC, p.sku
      LIMIT 20`,
    [q],
  );
  return rows;
}

// Suma al stock físico (recepción de compra). Siempre dentro de la transacción del llamador.
export async function incrementarFisico(sku, cantidad, client) {
  const { rowCount } = await client.query(`UPDATE inventario SET stock_fisico = stock_fisico + $2 WHERE sku = $1`, [sku, cantidad]);
  return rowCount === 1;
}

// Rebaja atómica: la condición va en el WHERE, así dos ventas simultáneas no pueden dejar el stock negativo.
// false = no alcanzó el stock (o violaría stock_reservado <= stock_fisico) y no se modificó nada.
export async function rebajarFisico(sku, cantidad, client) {
  try {
    const { rowCount } = await client.query(
      `UPDATE inventario SET stock_fisico = stock_fisico - $2 WHERE sku = $1 AND stock_fisico - $2 >= stock_reservado`, [sku, cantidad]);
    return rowCount === 1;
  } catch (e) {
    if (e.code === '23514') return false;
    throw e;
  }
}

// SKU -> { disponible } para los SKU pedidos; los que no existen o están inactivos no aparecen.
export async function disponiblePorSku(skus) {
  const { rows } = await query(
    `SELECT p.sku, (i.stock_fisico - i.stock_reservado)::int AS disponible
       FROM producto p JOIN inventario i ON i.sku = p.sku WHERE p.sku = ANY($1) AND p.estado = 'ACTIVO'`, [skus]);
  return new Map(rows.map((r) => [r.sku, r.disponible]));
}
