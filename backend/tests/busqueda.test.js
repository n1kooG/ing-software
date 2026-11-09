// HU06 / T27–T29: búsqueda predictiva por SKU o modelo en bodega.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './_aux.js';
import { pool } from '../src/db.js';
import { cerrarCache } from '../src/cache.js';

let t;
before(async () => { t = await iniciar(); });
after(async () => { t.server.close(); await cerrarCache(); await pool.end(); });

test('T27: Bodega busca por prefijo de SKU y por fragmento de modelo; trae stock y ubicación, sin costos', async () => {
  const r = await t.http('GET', '/api/inventario/buscar?q=th-45', t.bodega);
  assert.equal(r.status, 200);
  assert.ok(r.body.length >= 1);
  assert.equal(r.body[0].sku, 'TH-4500');
  for (const k of ['stock_fisico', 'stock_disponible', 'ubicacion_bodega', 'modelo']) assert.ok(k in r.body[0], k);
  assert.doesNotMatch(JSON.stringify(r.body), /costo|margen|valorizacion/i);
  const m = await t.http('GET', `/api/inventario/buscar?q=${encodeURIComponent(r.body[0].modelo.slice(1, 6))}`, t.bodega);
  assert.ok(m.body.some((x) => x.sku === 'TH-4500'));
});

test('T27: el SKU exacto va primero; menos de 2 letras no consulta; % y _ se buscan literalmente', async () => {
  assert.equal((await t.http('GET', '/api/inventario/buscar?q=T', t.bodega)).body.length, 0);
  assert.equal((await t.http('GET', '/api/inventario/buscar?q=%25%25', t.bodega)).body.length, 0);
  assert.equal((await t.http('GET', '/api/inventario/buscar?q=TH-4500', t.bodega)).body[0].sku, 'TH-4500');
});

test('T27: el chofer no puede buscar (403)', async () => {
  assert.equal((await t.http('GET', '/api/inventario/buscar?q=TH', t.chofer)).status, 403);
});

test('T29: respuesta < 2 s por consulta y con 30 consultas simultáneas', async () => {
  const una = Date.now();
  await t.http('GET', '/api/inventario/buscar?q=TH', t.bodega);
  assert.ok(Date.now() - una < 2000);
  const ini = Date.now();
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => t.http('GET', `/api/inventario/buscar?q=${['TH', 'TH-4', 'for', 'gcx'][i % 4]}`, t.bodega)));
  assert.ok(rs.every((r) => r.status === 200));
  assert.ok(Date.now() - ini < 2000, `30 consultas tardaron ${Date.now() - ini} ms`);
});
