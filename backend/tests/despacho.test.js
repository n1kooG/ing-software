// HU07 / T30–T34: hoja de ruta del chofer, cierre Entregado/Rechazado, evidencia, geolocalización y flujo completo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, crearPedido, limpiar } from './_aux.js';
import { pool, query } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

const M = `s3d${Date.now().toString(36)}`;
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
let t, cont = 0, idOtro;
const nuevo = (o) => crearPedido(`${M}${++cont}`, o);
const enRuta = async () => { // pedido asignado al chofer de pruebas; devuelve { id, idDespacho }
  const id = await nuevo({ estado: 'EN_CAMION' });
  await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer });
  return { id, idDespacho: (await query(`SELECT id_despacho FROM despacho WHERE id_orden = $1`, [id])).rows[0].id_despacho };
};
const estado = async (id) => (await query(`SELECT estado_orden FROM orden_venta WHERE id_orden = $1`, [id])).rows[0].estado_orden;
const despacho = async (id) => (await query(`SELECT * FROM despacho WHERE id_despacho = $1`, [id])).rows[0];
const logs = async (idDespacho) => (await query(`SELECT * FROM audit_log WHERE accion = 'ENTREGA' AND (valores_nuevos->>'id_despacho')::int = $1`, [idDespacho])).rows;
const foto = (nombre = 'f.jpg', buf = JPG, tipo = 'image/jpeg') => (campos) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, String(v));
  f.set('foto', new Blob([buf], { type: tipo }), nombre);
  return f;
};

before(async () => {
  t = await iniciar();
  // segundo chofer solo como dueño de un despacho (nunca inicia sesión, así se puede borrar al final)
  const { rows: [u] } = await query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol) SELECT '44.444.444-4', 'Chofer Ajeno S3', $1, password_hash, id_rol FROM usuario WHERE email = 'chofer@tiendaoregon.cl' RETURNING id_usuario`, [`${M}@ajeno.cl`]);
  idOtro = u.id_usuario;
});
after(async () => {
  await limpiar(M);
  await query(`DELETE FROM usuario WHERE id_usuario = $1`, [idOtro]);
  t.server.close(); await cerrarCache(); await pool.end();
});

test('T31: el chofer ve su hoja de ruta con dirección y contacto, sin costos; Bodega y Administrador no (403)', async () => {
  const { id } = await enRuta();
  const r = await t.http('GET', '/api/despachos/mi-ruta', t.chofer);
  assert.equal(r.status, 200);
  const p = r.body.find((x) => x.id_orden === id);
  assert.equal(p.direccion_despacho, 'Providencia 1251');
  assert.equal(p.telefono_contacto, '+56911112222');
  assert.equal(p.estado_entrega, 'PENDIENTE');
  assert.equal(p.bultos, 1);
  assert.doesNotMatch(JSON.stringify(r.body), /costo|margen|precio/i);
  for (const tok of [t.bodega, t.admin]) assert.equal((await t.http('GET', '/api/despachos/mi-ruta', tok)).status, 403);
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta', null)).status, 401);
});

test('T32/T33: Entregado cierra despacho y pedido, y registra hora, usuario y geolocalización en audit_log', async () => {
  const { id, idDespacho } = await enRuta();
  const r = await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, { estado: 'ENTREGADO', latitud: -33.4263, longitud: -70.6155 });
  assert.equal(r.status, 200);
  assert.equal(await estado(id), 'ENTREGADO');
  const d = await despacho(idDespacho);
  assert.equal(d.estado_entrega, 'ENTREGADO');
  assert.ok(d.fecha_cierre);
  const [log] = await logs(idDespacho);
  assert.equal(log.id_usuario, t.idChofer);
  assert.equal(log.geolocalizacion, '-33.426300,-70.615500');
  assert.ok(log.fecha_hora);
  assert.equal(log.valores_nuevos.estado_entrega, 'ENTREGADO');
  // cerrada: no se puede cerrar de nuevo
  assert.equal((await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'x' })).status, 409);
  // sigue visible como cerrada hoy, tras las pendientes
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body.find((x) => x.id_orden === id).estado_entrega, 'ENTREGADO');
});

test('T32: Rechazado exige causal (400, sin cambios) y con causal queda auditado el motivo', async () => {
  const { id, idDespacho } = await enRuta();
  for (const mal of [{ estado: 'RECHAZADO' }, { estado: 'RECHAZADO', motivo: '   ' }, { estado: 'OTRO' }]) {
    assert.equal((await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, mal)).status, 400);
  }
  assert.equal(await estado(id), 'EN_RUTA');
  assert.equal((await despacho(idDespacho)).estado_entrega, 'PENDIENTE');
  assert.equal((await logs(idDespacho)).length, 0);
  const r = await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, { estado: 'RECHAZADO', motivo: 'Cliente ausente' });
  assert.equal(r.status, 200);
  assert.equal(await estado(id), 'RECHAZADO');
  assert.equal((await despacho(idDespacho)).motivo_rechazo, 'Cliente ausente');
  assert.equal((await logs(idDespacho))[0].valores_nuevos.motivo_rechazo, 'Cliente ausente');
});

test('T32: foto de evidencia (multipart); con S3 desactivado no se guarda ni falla, y se validan tipo y firma', async () => {
  const { idDespacho } = await enRuta();
  const conFoto = foto();
  const mala = await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, foto('x.jpg', Buffer.from('no soy imagen'))({ estado: 'RECHAZADO', motivo: 'Dañado' }));
  assert.equal(mala.status, 400);
  const pdf = await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, foto('x.pdf', JPG, 'application/pdf')({ estado: 'RECHAZADO', motivo: 'Dañado' }));
  assert.equal(pdf.status, 400);
  assert.equal((await despacho(idDespacho)).estado_entrega, 'PENDIENTE');
  const r = await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, conFoto({ estado: 'RECHAZADO', motivo: 'Dañado', latitud: -33.45, longitud: -70.66 }));
  assert.equal(r.status, 200);
  assert.equal(r.body.evidencia, process.env.STORAGE_ENABLED === 'true');
  assert.equal((await logs(idDespacho))[0].geolocalizacion, '-33.450000,-70.660000');
});

test('T33: coordenadas inválidas se rechazan; son opcionales', async () => {
  const { idDespacho } = await enRuta();
  for (const g of [{ latitud: 99, longitud: 1 }, { latitud: 'abc', longitud: 1 }, { latitud: -33.4 }]) {
    assert.equal((await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, { estado: 'ENTREGADO', ...g })).status, 400);
  }
  assert.equal((await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, { estado: 'ENTREGADO' })).status, 200);
  assert.equal((await logs(idDespacho))[0].geolocalizacion, null);
});

test('T32: RBAC y pertenencia — Bodega/Administrador 403; el despacho de otro chofer es 404', async () => {
  const { id, idDespacho } = await enRuta();
  for (const tok of [t.bodega, t.admin]) assert.equal((await t.http('PATCH', `/api/despachos/${idDespacho}`, tok, { estado: 'ENTREGADO' })).status, 403);
  await query(`UPDATE despacho SET id_usuario_chofer = $2 WHERE id_despacho = $1`, [idDespacho, idOtro]);
  assert.equal((await t.http('PATCH', `/api/despachos/${idDespacho}`, t.chofer, { estado: 'ENTREGADO' })).status, 404);
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body.some((x) => x.id_orden === id), false);
  assert.equal((await t.http('PATCH', '/api/despachos/999999999', t.chofer, { estado: 'ENTREGADO' })).status, 404);
  assert.equal(await estado(id), 'EN_RUTA');
});

test('T34: flujo completo — importado/pendiente -> Bodega prepara -> Admin asigna -> Chofer ve y entrega', async () => {
  const id = await nuevo({ lineas: [['TH-4500', 1], ['UT-FORNO', 1]] });
  for (const e of ['ARMADO', 'ETIQUETADO', 'EN_CAMION']) assert.equal((await t.http('PATCH', `/api/pedidos/${id}/estado`, t.bodega, { estado: e })).status, 200);
  assert.equal((await t.http('GET', `/api/pedidos/${id}/etiqueta`, t.bodega)).status, 200);
  // antes de asignar el chofer no ve nada
  assert.equal((await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body.some((x) => x.id_orden === id), false);
  assert.equal((await t.http('POST', `/api/pedidos/${id}/asignar-chofer`, t.admin, { id_chofer: t.idChofer })).status, 200);
  const ruta = (await t.http('GET', '/api/despachos/mi-ruta', t.chofer)).body.find((x) => x.id_orden === id);
  assert.equal(ruta.bultos, 2);
  assert.equal((await t.http('PATCH', `/api/despachos/${ruta.id_despacho}`, t.chofer, { estado: 'ENTREGADO', latitud: -33.4263, longitud: -70.6155 })).status, 200);
  assert.equal(await estado(id), 'ENTREGADO');
  // recorrido completo en la bitácora, en orden
  const acciones = (await query(`SELECT accion FROM audit_log WHERE (valores_nuevos->>'id_orden')::int = $1 AND accion IN ('CAMBIO_ESTADO','ETIQUETA','ASIGNACION_CHOFER','ENTREGA') ORDER BY id_log`, [id])).rows.map((r) => r.accion);
  assert.deepEqual(acciones, ['CAMBIO_ESTADO', 'CAMBIO_ESTADO', 'CAMBIO_ESTADO', 'ETIQUETA', 'ASIGNACION_CHOFER', 'ENTREGA']);
  // ni Bodega ni el chofer reciben costos en ninguna respuesta del flujo
  for (const [tok, ruta2] of [[t.bodega, `/api/pedidos/${id}`], [t.chofer, '/api/despachos/mi-ruta']]) {
    assert.doesNotMatch(JSON.stringify((await t.http('GET', ruta2, tok)).body), /costo|margen|valorizacion/i);
  }
});
