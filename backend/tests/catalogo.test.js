// T08 (creación/edición de productos) y T12 (integración: producto → precios por canal → margen).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';

const PASS = 'Demo-Oregon-2026';
const SKUS = ['ZZ-T08', 'ZZ-T12', 'ZZ-T12B'];
let server, base, admin, bodega, chofer, desde; // audit_log es inmutable: se miran solo las filas de esta ejecución
const login = async (email) => (await (await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASS }),
})).json()).token;
const api = async (ruta, { metodo = 'GET', token, cuerpo } = {}) => {
  const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: cuerpo && JSON.stringify(cuerpo) });
  return { status: r.status, texto: null, json: await r.json().catch(() => null), headers: r.headers };
};
const limpiar = async () => {
  await query(`DELETE FROM lista_precio WHERE sku = ANY($1)`, [SKUS]);
  await query(`DELETE FROM inventario WHERE sku = ANY($1)`, [SKUS]);
  await query(`DELETE FROM producto WHERE sku = ANY($1)`, [SKUS]);
};
const nuevo = (extra = {}) => ({ sku: 'zz-t08', modelo: 'M1', nombre: 'Producto de prueba', marca: 'Marca', costo_adquisicion_neto: 1000, ...extra });

before(async () => {
  await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`;
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
  desde = (await query(`SELECT COALESCE(max(id_log), 0) AS m FROM audit_log`)).rows[0].m;
  await limpiar();
  [admin, bodega, chofer] = await Promise.all(['admin', 'bodega', 'chofer'].map((n) => login(`${n}@tiendaoregon.cl`)));
});
after(async () => { await limpiar(); server.close(); await cerrarCache(); await pool.end(); });

test('T08 crea producto: SKU en mayúsculas, persistido, inventario con stock 0 y auditoría', async () => {
  const r = await api('/api/productos', { metodo: 'POST', token: admin, cuerpo: nuevo({ sku: ' zz-t08 ' }) });
  assert.equal(r.status, 201);
  assert.equal(r.json.sku, 'ZZ-T08');
  assert.equal(r.json.stock_fisico, 0);
  const { rows } = await query(`SELECT stock_fisico, stock_reservado FROM inventario WHERE sku = 'ZZ-T08'`);
  assert.deepEqual(rows, [{ stock_fisico: 0, stock_reservado: 0 }]);
  const a = await query(`SELECT count(*)::int n FROM audit_log WHERE tabla_afectada = 'producto' AND id_log > ${desde} AND accion = 'CREAR' AND valores_nuevos->>'sku' = 'ZZ-T08'`);
  assert.equal(a.rows[0].n, 1);
});

test('T08 SKU duplicado → 409 con mensaje en español (también con otra capitalización)', async () => {
  const r = await api('/api/productos', { metodo: 'POST', token: admin, cuerpo: nuevo({ sku: 'Zz-T08' }) });
  assert.equal(r.status, 409);
  assert.equal(r.json.codigo, 'SKU_DUPLICADO');
  assert.match(r.json.error, /Ya existe un producto con el SKU ZZ-T08/);
});

test('T08 validaciones de campos y tipos → 400 y nada se persiste', async () => {
  for (const mala of [{ modelo: '' }, { nombre: undefined }, { marca: 5 }, { costo_adquisicion_neto: '1000' }, { costo_adquisicion_neto: -1 }, { stock_minimo: 1.5 }, { sku: '' }]) {
    const r = await api('/api/productos', { metodo: 'POST', token: admin, cuerpo: nuevo({ sku: 'ZZ-T12', ...mala }) });
    assert.equal(r.status, 400, JSON.stringify(mala));
  }
  assert.equal((await query(`SELECT 1 FROM producto WHERE sku = 'ZZ-T12'`)).rowCount, 0);
});

test('T08 editar persiste cambios, el SKU es inmutable y se audita (incluida la inactivación)', async () => {
  let r = await api('/api/productos/zz-t08', { metodo: 'PUT', token: admin, cuerpo: { nombre: 'Nombre nuevo', stock_minimo: 7 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.nombre, 'Nombre nuevo');
  assert.equal((await query(`SELECT stock_minimo FROM producto WHERE sku = 'ZZ-T08'`)).rows[0].stock_minimo, 7);

  r = await api('/api/productos/ZZ-T08', { metodo: 'PUT', token: admin, cuerpo: { sku: 'OTRO-SKU' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /SKU no se puede modificar/);
  assert.equal((await query(`SELECT 1 FROM producto WHERE sku = 'OTRO-SKU'`)).rowCount, 0);

  r = await api('/api/productos/ZZ-T08', { metodo: 'PUT', token: admin, cuerpo: { estado: 'INACTIVO' } });
  assert.equal(r.json.estado, 'INACTIVO');
  r = await api('/api/productos/ZZ-T08', { metodo: 'PUT', token: admin, cuerpo: { estado: 'ACTIVO' } });
  assert.equal(r.json.estado, 'ACTIVO');
  const acc = await query(`SELECT accion FROM audit_log WHERE id_log > ${desde} AND tabla_afectada = 'producto' AND valores_nuevos->>'sku' = 'ZZ-T08' ORDER BY id_log`);
  assert.deepEqual(acc.rows.map((x) => x.accion), ['CREAR', 'EDITAR', 'INACTIVAR', 'REACTIVAR']);
  assert.equal((await api('/api/productos/NOEXISTE', { metodo: 'PUT', token: admin, cuerpo: { nombre: 'x' } })).status, 404);
});

test('T08 listado: búsqueda, paginación y ubicación/stock', async () => {
  const r = await api('/api/productos?q=nombre%20nuevo&limite=1', { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 1);
  assert.equal(r.json[0].sku, 'ZZ-T08');
  assert.equal(r.headers.get('x-total-count'), '1');
  assert.ok('ubicacion_bodega' in r.json[0] && 'stock_fisico' in r.json[0] && 'precios' in r.json[0]);
  const todos = await api('/api/productos?limite=1&pagina=2', { token: admin });
  assert.equal(todos.json.length, 1);
  assert.notEqual(Number(todos.headers.get('x-total-count')), 1);
});

test('T12 flujo: crear → precios por canal → cambiar precio; margen y canal correctos', async () => {
  const c = await api('/api/productos', { metodo: 'POST', token: admin, cuerpo: nuevo({ sku: 'ZZ-T12', costo_adquisicion_neto: 14990 }) });
  assert.equal(c.status, 201);
  let r = await api('/api/productos/ZZ-T12/precios/WEB', { metodo: 'PUT', token: admin, cuerpo: { precio: 22990 } });
  assert.equal(r.status, 200);
  assert.equal(Number(r.json.margen), 34.8);
  r = await api('/api/productos/ZZ-T12/precios/MAYORISTA', { metodo: 'PUT', token: admin, cuerpo: { precio: 18500 } });
  assert.equal(Number(r.json.margen), 18.97);

  r = await api('/api/productos/ZZ-T12/precios/WEB', { metodo: 'PUT', token: admin, cuerpo: { precio: 24990 } });
  assert.equal(r.json.canal, 'WEB');
  assert.equal(Number(r.json.margen), 40.02);
  const p = (await api('/api/productos/ZZ-T12', { token: admin })).json;
  assert.equal(Number(p.precios.WEB.precio), 24990);
  assert.equal(Number(p.precios.WEB.margen), 40.02);
  assert.equal(Number(p.precios.MAYORISTA.precio), 18500);   // el otro canal no se tocó
  assert.equal(Number(p.precios.MAYORISTA.margen), 18.97);
  assert.equal(Number(p.costo_adquisicion_neto), 14990);       // el costo no cambió
  assert.equal((await query(`SELECT count(*)::int n FROM lista_precio WHERE sku = 'ZZ-T12'`)).rows[0].n, 2);

  const a = await query(`SELECT valores_anteriores, valores_nuevos FROM audit_log WHERE id_log > ${desde} AND accion = 'CAMBIAR_PRECIO' AND valores_nuevos->>'sku' = 'ZZ-T12' AND valores_nuevos->>'canal' = 'WEB' ORDER BY id_log DESC LIMIT 1`);
  assert.equal(Number(a.rows[0].valores_anteriores.precio_venta_neto), 22990);
  assert.equal(Number(a.rows[0].valores_nuevos.precio_venta_neto), 24990);
});

test('T12 precio ≤ costo, canal inválido y campos prohibidos se rechazan sin cambiar nada', async () => {
  for (const precio of [14990, 100]) {
    const r = await api('/api/productos/ZZ-T12/precios/WEB', { metodo: 'PUT', token: admin, cuerpo: { precio } });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /mayor al costo/);
  }
  assert.equal((await api('/api/productos/ZZ-T12/precios/TIENDA', { metodo: 'PUT', token: admin, cuerpo: { precio: 30000 } })).status, 400);
  for (const extra of [{ margen: 99 }, { costo_adquisicion_neto: 1 }]) {
    assert.equal((await api('/api/productos/ZZ-T12/precios/WEB', { metodo: 'PUT', token: admin, cuerpo: { precio: 30000, ...extra } })).status, 400);
  }
  assert.equal((await api('/api/productos/NOEXISTE/precios/WEB', { metodo: 'PUT', token: admin, cuerpo: { precio: 30000 } })).status, 404);
  const { rows } = await query(`SELECT precio_venta_neto::int p, (SELECT costo_adquisicion_neto::int FROM producto WHERE sku='ZZ-T12') c FROM lista_precio WHERE sku='ZZ-T12' AND canal_venta='WEB'`);
  assert.deepEqual(rows, [{ p: 24990, c: 14990 }]);
});

test('T12 al subir el costo se recalculan los márgenes y no se permite superar un precio vigente', async () => {
  let r = await api('/api/productos/ZZ-T12', { metodo: 'PUT', token: admin, cuerpo: { costo_adquisicion_neto: 16000 } });
  assert.equal(r.status, 200);
  assert.equal(Number(r.json.precios.MAYORISTA.margen), 13.51); // (18500-16000)/18500
  r = await api('/api/productos/ZZ-T12', { metodo: 'PUT', token: admin, cuerpo: { costo_adquisicion_neto: 20000 } });
  assert.equal(r.status, 400); // costo ≥ precio vigente: rechazado y revertido
  assert.equal(Number((await api('/api/productos/ZZ-T12', { token: admin })).json.costo_adquisicion_neto), 16000);
});

test('BODEGA y CHOFER: 403 en escritura y jamás ven costo ni margen', async () => {
  for (const token of [bodega, chofer]) {
    for (const [metodo, ruta, cuerpo] of [
      ['POST', '/api/productos', nuevo({ sku: 'ZZ-T12B' })],
      ['PUT', '/api/productos/ZZ-T12', { nombre: 'x' }],
      ['PUT', '/api/productos/ZZ-T12/precios/WEB', { precio: 99999 }],
    ]) assert.equal((await api(ruta, { metodo, token, cuerpo })).status, 403, `${metodo} ${ruta}`);
    for (const ruta of ['/api/productos', '/api/productos/ZZ-T12']) {
      assert.doesNotMatch(JSON.stringify((await api(ruta, { token })).json), /costo|margen/i);
    }
  }
  assert.equal((await query(`SELECT 1 FROM producto WHERE sku = 'ZZ-T12B'`)).rowCount, 0);
});
