import { query } from '../db.js';

const COLS = 'p.sku, p.modelo, p.nombre, p.marca, p.descripcion, p.categoria, p.estado, p.stock_minimo';

// Las columnas de costo/margen solo se piden a la BD si el rol puede verlas (HU08, PU-09).
const select = ({ verCostos, verPrecios }) => `
  SELECT ${COLS}, i.stock_fisico, i.stock_reservado, i.ubicacion_bodega
         ${verCostos ? ', p.costo_adquisicion_neto' : ''}
         ${verPrecios ? `, (SELECT COALESCE(json_object_agg(l.canal_venta, json_build_object('precio', l.precio_venta_neto${verCostos ? ", 'margen', l.margen_porcentual" : ''})), '{}'::json)
                            FROM lista_precio l WHERE l.sku = p.sku) AS precios` : ''}
    FROM producto p LEFT JOIN inventario i ON i.sku = p.sku`;

export async function listar(vis, { q, limite, offset }) {
  const filtro = q ? `WHERE p.sku ILIKE $1 OR p.modelo ILIKE $1 OR p.nombre ILIKE $1 OR p.marca ILIKE $1` : '';
  const params = q ? [`%${q.replace(/[\\%_]/g, '\\$&')}%`] : [];
  const { rows } = await query(`${select(vis)} ${filtro} ORDER BY p.sku LIMIT ${limite} OFFSET ${offset}`, params);
  const { rows: [{ total }] } = await query(`SELECT count(*)::int AS total FROM producto p ${filtro}`, params);
  return { filas: rows, total };
}

export async function obtener(vis, sku, db = { query }) {
  const { rows } = await db.query(`${select(vis)} WHERE p.sku = $1`, [sku]);
  return rows[0] ?? null;
}

// Fila completa (incluye costo) para auditoría; siempre dentro de la transacción.
export async function obtenerParaAuditoria(db, sku, bloquear = false) {
  const { rows } = await db.query(
    `SELECT sku, modelo, nombre, marca, descripcion, categoria, estado, stock_minimo, costo_adquisicion_neto
       FROM producto WHERE sku = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [sku]);
  return rows[0] ?? null;
}

export async function crear(db, p) {
  const { rows } = await db.query(
    `INSERT INTO producto (sku, modelo, nombre, marca, descripcion, categoria, costo_adquisicion_neto, stock_minimo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING sku, modelo, nombre, marca, descripcion, categoria, estado, stock_minimo, costo_adquisicion_neto`,
    [p.sku, p.modelo, p.nombre, p.marca, p.descripcion, p.categoria, p.costo_adquisicion_neto, p.stock_minimo]);
  await db.query(`INSERT INTO inventario (sku, stock_fisico, stock_reservado) VALUES ($1, 0, 0)`, [p.sku]);
  return rows[0];
}

// `campos` ya viene validado con nombres de columna de una lista blanca.
export async function actualizar(db, sku, campos) {
  const cols = Object.keys(campos);
  await db.query(`UPDATE producto SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE sku = $1`, [sku, ...Object.values(campos)]);
}

export async function precioActual(db, sku, canal) {
  const { rows } = await db.query(`SELECT precio_venta_neto, margen_porcentual FROM lista_precio WHERE sku = $1 AND canal_venta = $2 FOR UPDATE`, [sku, canal]);
  return rows[0] ?? null;
}

// El trigger fija el margen y rechaza precio <= costo; aquí solo se escribe el precio.
export async function fijarPrecio(db, sku, canal, precio) {
  const { rows } = await db.query(
    `INSERT INTO lista_precio (sku, canal_venta, precio_venta_neto) VALUES ($1,$2,$3)
     ON CONFLICT (sku, canal_venta) DO UPDATE SET precio_venta_neto = EXCLUDED.precio_venta_neto
     RETURNING canal_venta, precio_venta_neto, margen_porcentual`, [sku, canal, precio]);
  return rows[0];
}

export async function hayPrecioNoSuperaCosto(db, sku) {
  const { rowCount } = await db.query(`SELECT 1 FROM lista_precio WHERE sku = $1 AND margen_porcentual <= 0`, [sku]);
  return rowCount > 0;
}
