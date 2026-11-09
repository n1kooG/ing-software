// Ayudas compartidas por las pruebas del Sprint 3 (no es una suite: el patrón de npm test es *.test.js).
import { crearApp } from '../src/app.js';
import { iniciarCache } from '../src/cache.js';
import { query } from '../src/db.js';

const PASS = 'Demo-Oregon-2026';

export async function iniciar() {
  await iniciarCache();
  const server = crearApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
  const http = (metodo, ruta, token, body) => fetch(base + ruta, {
    method: metodo,
    headers: { ...(body && !(body instanceof FormData) && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') }));
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
  const login = async (email) => (await http('POST', '/api/auth/login', null, { email, password: PASS })).body.token;
  const tokens = { admin: await login('admin@tiendaoregon.cl'), bodega: await login('bodega@tiendaoregon.cl'), chofer: await login('chofer@tiendaoregon.cl') };
  const id = async (email) => (await query(`SELECT id_usuario FROM usuario WHERE email = $1`, [email])).rows[0].id_usuario;
  return { server, http, ...tokens, idChofer: await id('chofer@tiendaoregon.cl'), idAdmin: await id('admin@tiendaoregon.cl'), idBodega: await id('bodega@tiendaoregon.cl') };
}

// Crea un pedido de prueba (lote + orden + líneas) sin tocar el stock. Devuelve id_orden.
export async function crearPedido(marca, { canal = 'Mayorista', estado = 'PENDIENTE_PREPARACION', lineas = [['TH-4500', 1]] } = {}) {
  const idUsuario = (await query(`SELECT id_usuario FROM usuario WHERE email = 'admin@tiendaoregon.cl'`)).rows[0].id_usuario;
  const { rows: [l] } = await query(`INSERT INTO lote_importacion (id_usuario, nombre_archivo, url_archivo_s3, total_ordenes, total_lineas) VALUES ($1,$2,'x',1,$3) RETURNING id_lote`, [idUsuario, `${marca}.xlsx`, lineas.length]);
  const { rows: [o] } = await query(
    `INSERT INTO orden_venta (id_lote, codigo_externo, canal_origen, nombre_cliente, direccion_despacho, comuna, telefono_contacto) VALUES ($1,$2,$3,'Cliente S3','Providencia 1251','Providencia','+56911112222') RETURNING id_orden`,
    [l.id_lote, `${marca}-1`, canal]);
  for (const [sku, cant] of lineas) await query(`INSERT INTO detalle_venta (id_orden, sku, cantidad_vendida, precio_unitario) VALUES ($1,$2,$3,5000)`, [o.id_orden, sku, cant]);
  if (estado !== 'PENDIENTE_PREPARACION') { // se recorre el flujo real para respetar el trigger de transición
    const ruta = { ARMADO: ['ARMADO'], ETIQUETADO: ['ARMADO', 'ETIQUETADO'], EN_CAMION: ['ARMADO', 'ETIQUETADO', 'EN_CAMION'] }[estado];
    for (const e of ruta) await query(`UPDATE orden_venta SET estado_orden = $2 WHERE id_orden = $1`, [o.id_orden, e]);
  }
  return o.id_orden;
}

export async function limpiar(marca) {
  await query(`DELETE FROM despacho WHERE id_orden IN (SELECT o.id_orden FROM orden_venta o JOIN lote_importacion l USING (id_lote) WHERE l.nombre_archivo LIKE $1)`, [`${marca}%`]);
  await query(`DELETE FROM orden_venta WHERE id_lote IN (SELECT id_lote FROM lote_importacion WHERE nombre_archivo LIKE $1)`, [`${marca}%`]);
  await query(`DELETE FROM lote_importacion WHERE nombre_archivo LIKE $1`, [`${marca}%`]); // audit_log es inmutable y conserva el rastro
}
