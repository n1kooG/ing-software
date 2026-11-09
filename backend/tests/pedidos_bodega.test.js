// HU05 / T23–T26 (Bodega) y T50 (Administrador): pedidos pendientes, estados, discrepancias, etiqueta y asignación de chofer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `s3b${Date.now().toString(36)}`;
let t, cont = 0;
const nuevo = (o) => crearPedido(`${M}${++cont}`, o);
const auditoria = async (accion, idOrden) => (await query(`SELECT * FROM audit_log WHERE accion = $1 AND (valores_nuevos->>'id_orden')::int = $2 ORDER BY id_log`, [accion, idOrden])).rows;
const estado = async (id) => (await query(`SELECT estado_orden FROM orden_venta WHERE id_orden = $1`, [id])).rows[0].estado_orden;

before(async () => { t = await iniciar(); });
after(async () => { await limpiar(M); t.server.close(); await cerrarCache(); await pool.end(); });

test('T24: Bodega ve pedidos por canal y solo los 4 estados de bodega; sin precios ni costos', async () => {
  const a = await nuevo({ canal: 'Paris' });
  const b = await nuevo({ canal: 'Ripley' });
  const r = await t.http('GET', '/api/pedidos?canal=Paris', t.bodega);
  assert.equal(r.status, 200);
  assert.ok(r.body.some((x) => x.id_orden === a));
  assert.ok(!r.body.some((x) => x.id_orden === b));
  assert.ok(r.body.every((x) => x.canal_origen === 'Paris'));
  const todos = await t.http('GET', '/api/pedidos', t.bodega);
  assert.ok(todos.body.every((x) => ['PENDIENTE_PREPARACION', 'ARMADO', 'ETIQUETADO', 'EN_CAMION'].includes(x.estado_orden)));
  assert.equal((await t.http('GET', '/api/pedidos?estado=NOPE', t.bodega)).status, 400);
});

test('T25: detalle con checklist de ítems y ubicación; Bodega no recibe precios, el Administrador sí', async () => {
  const id = await nuevo({ lineas: [['TH-4500', 2], ['UT-FORNO', 1]] });
  const b = await t.http('GET', `/api/pedidos/${id}`, t.bodega);
  assert.equal(b.status, 200);
  assert.equal(b.body.items.length, 2);
  assert.deepEqual(Object.keys(b.body.items[0]).sort(), ['cantidad', 'modelo', 'nombre', 'sku', 'ubicacion_bodega']);
  assert.equal(b.body.items.find((i) => i.sku === 'TH-4500').ubicacion_bodega, 'Pasillo A - Estante 2');
  const a = await t.http('GET', `/api/pedidos/${id}`, t.admin);
  assert.equal(Number(a.body.items[0].precio_unitario), 5000);
  assert.equal((await t.http('GET', '/api/pedidos/999999999', t.bodega)).status, 404);
});

test('T25: cambio entre los 4 estados (reversible), auditado; el trigger bloquea saltos y EN_RUTA', async () => {
  const id = await nuevo();
  for (const e of ['ARMADO', 'ETIQUETADO', 'EN_CAMION', 'PENDIENTE_PREPARACION', 'ARMADO']) {
    const r = await t.http('PATCH', `/api/pedidos/${id}/estado`, t.bodega, { estado: e });
    assert.equal(r.status, 200, e);
    assert.equal(await estado(id), e);
  }
  const log = await auditoria('CAMBIO_ESTADO', id);
  assert.equal(log.length, 5);
  assert.deepEqual([log[0].valores_anteriores.estado_orden, log[0].valores_nuevos.estado_orden], ['PENDIENTE_PREPARACION', 'ARMADO']);
  assert.equal(log[0].id_usuario, t.idBodega);
  // Bodega no puede poner EN_RUTA ni ENTREGADO (son del flujo de ruta)
  assert.equal((await t.http('PATCH', `/api/pedidos/${id}/estado`, t.bodega, { estado: 'EN_RUTA' })).status, 400);
  assert.equal((await t.http('PATCH', `/api/pedidos/${id}/estado`, t.bodega, { estado: 'XX' })).status, 400);
  // Un pedido ya en ruta no vuelve a bodega: lo impide el trigger (409)
  const ruta = await nuevo({ estado: 'EN_CAMION' });
  await query(`UPDATE orden_venta SET estado_orden = 'EN_RUTA' WHERE id_orden = $1`, [ruta]);
  const r = await t.http('PATCH', `/api/pedidos/${ruta}/estado`, t.bodega, { estado: 'ARMADO' });
  assert.equal(r.status, 409);
  assert.equal(r.body.codigo, 'TRANSICION_INVALIDA');
  assert.equal(await estado(ruta), 'EN_RUTA');
  assert.equal((await t.http('PATCH', '/api/pedidos/999999999/estado', t.bodega, { estado: 'ARMADO' })).status, 404);
});

test('T25: RBAC — el chofer y el administrador no preparan (403 + ACCESO_DENEGADO)', async () => {
  const id = await nuevo();
  for (const tok of [t.chofer, t.admin]) {
    assert.equal((await t.http('PATCH', `/api/pedidos/${id}/estado`, tok, { estado: 'ARMADO' })).status, 403);
    assert.equal((await t.http('GET', `/api/pedidos/${id}/etiqueta`, tok)).status, 403);
  }
  assert.equal((await t.http('GET', `/api/pedidos/${id}`, t.chofer)).status, 403);
  assert.equal((await t.http('GET', `/api/pedidos/${id}`, null)).status, 401);
  assert.equal(await estado(id), 'PENDIENTE_PREPARACION');
  const n = (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'ACCESO_DENEGADO' AND valores_nuevos->>'ruta' = $1`, [`/api/pedidos/${id}/estado`])).rows[0].n;
  assert.equal(n, 2);
});

test('T25: comentario de discrepancia (dañado/faltante) queda en la bitácora; valida SKU y tipo', async () => {
  const id = await nuevo({ lineas: [['TH-4500', 1]] });
  const r = await t.http('POST', `/api/pedidos/${id}/comentarios`, t.bodega, { sku: 'th-4500', tipo: 'DANADO', comentario: 'Caja golpeada' });
  assert.equal(r.status, 201);
  const [fila] = await auditoria('DISCREPANCIA', id);
  assert.equal(fila.valores_nuevos.sku, 'TH-4500');
  assert.equal(fila.valores_nuevos.comentario, 'Caja golpeada');
  for (const mal of [{ sku: 'TH-4500', tipo: 'OTRO', comentario: 'x' }, { sku: 'TH-4500', tipo: 'FALTANTE', comentario: '  ' }]) {
    assert.equal((await t.http('POST', `/api/pedidos/${id}/comentarios`, t.bodega, mal)).status, 400);
  }
  assert.equal((await t.http('POST', `/api/pedidos/${id}/comentarios`, t.bodega, { sku: 'UT-FORNO', tipo: 'FALTANTE', comentario: 'x' })).status, 422);
});

test('T25: etiqueta PDF del pedido', async () => {
  const id = await nuevo();
  const r = await t.http('GET', `/api/pedidos/${id}/etiqueta`, t.bodega);
  assert.equal(r.status, 200);
  assert.match(r.tipo, /application\/pdf/);
  assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await t.http('GET', '/api/pedidos/999999999/etiqueta', t.bodega)).status, 404);
});

test('T50: el Administrador supervisa y asigna chofer: EN_CAMION -> EN_RUTA con despacho y auditoría', async () => {
  const id = await nuevo({ estado: 'EN_CAMION' });
  const r = await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  assert.equal(r.status, 200);
  assert.equal(await estado(id), 'EN_RUTA');
  const d = (await query(`SELECT * FROM despacho WHERE id_orden = $1`, [id])).rows[0];
  assert.equal(d.id_usuario_chofer, t.idChofer);
  assert.equal(d.estado_entrega, 'PENDIENTE');
  const [log] = await auditoria('ASIGNACION_CHOFER', id);
  assert.equal(log.id_usuario, t.idAdmin);
  assert.equal(log.valores_nuevos.id_usuario_chofer, t.idChofer);
  const sup = await t.http('GET', '/api/pedidos?estado=EN_RUTA', t.admin);
  const fila = sup.body.find((x) => x.id_orden === id);
  assert.equal(fila.id_usuario_chofer, t.idChofer);
  assert.ok(fila.nombre_chofer);
  // reasignar: el pedido ya está en ruta -> 409 y nada cambia
  assert.equal((await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer })).status, 409);
});

test('T50: asignación inválida no cambia nada (pedido sin cargar, usuario que no es chofer, RBAC)', async () => {
  const pendiente = await nuevo({ estado: 'ETIQUETADO' });
  assert.equal((await t.http('POST', `/api/pedidos/${pendiente}/asignar-chofer`, t.admin, { id_chofer: t.idChofer })).status, 409);
  assert.equal(await estado(pendiente), 'ETIQUETADO');
  assert.equal((await query(`SELECT count(*)::int n FROM despacho WHERE id_orden = $1`, [pendiente])).rows[0].n, 0);
  const listo = await nuevo({ estado: 'EN_CAMION' });
  assert.equal((await t.http('POST', `/api/pedidos/${listo}/asignar-chofer`, t.admin, { id_chofer: t.idBodega })).status, 409); // trigger: no es chofer
  assert.equal((await t.http('POST', `/api/pedidos/${listo}/asignar-chofer`, t.admin, { id_chofer: 'x' })).status, 400);
  assert.equal((await t.http('POST', `/api/pedidos/${listo}/asignar-chofer`, t.bodega, { id_chofer: t.idChofer })).status, 403);
  assert.equal(await estado(listo), 'EN_CAMION');
  assert.equal((await query(`SELECT count(*)::int n FROM despacho WHERE id_orden = $1`, [listo])).rows[0].n, 0);
});

test('T50: chofer inexistente responde 409 (lo rechaza el trigger)', async () => {
  const id = await nuevo({ estado: 'EN_CAMION' });
  assert.equal((await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: 999999 })).status, 409);
});
