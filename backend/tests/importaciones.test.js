// HU04 / T17–T22: importación masiva de ventas desde .xlsx.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { importar } from '../src/services/importaciones.js';

const PASS = 'Demo-Oregon-2026';
const SUF = Date.now().toString(36);
const PREFIJO = `s2t${SUF}`;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CAB = ['RUT CLIENTE', 'NOMBRE CLIENTE', 'SKU', 'NOMBRE PRODUCTO', 'CANTIDAD', 'PRECIO', 'MARCA'];

function rut(n) { // RUT válido determinista (módulo 11) para el cliente n
  const cuerpo = String(10_000_000 + n);
  let suma = 0, f = 2;
  for (const d of [...cuerpo].reverse()) { suma += Number(d) * f; f = f === 7 ? 2 : f + 1; }
  const r = 11 - (suma % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return `${cuerpo.slice(0, 2)}.${cuerpo.slice(2, 5)}.${cuerpo.slice(5)}-${dv}`;
}
const fila = (n, sku, cantidad, precio = 1000) => [rut(n), `Cliente S2T ${n}`, sku, `Producto ${sku}`, cantidad, precio, 'Marca'];
async function xlsx(filas, cabecera = CAB) {
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet('Ventas');
  h.addRow(cabecera); filas.forEach((f) => h.addRow(f));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

let server, base, admin, bodega, chofer, stock0, adminId, cont = 0;
const nombre = (x = '') => `${PREFIJO}_${++cont}${x}.xlsx`;
const http = (metodo, ruta, token, body) => fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const login = async (email) => (await http('POST', '/api/auth/login', null, { email, password: PASS })).body;
function subir(ruta, token, buffer, archivo, canal = 'Mayorista', tipo = XLSX) {
  const f = new FormData();
  if (buffer) f.set('archivo', new Blob([buffer], { type: tipo }), archivo);
  if (canal) f.set('canal', canal);
  return fetch(base + ruta, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f }).then(async (r) => ({ status: r.status, body: await r.json() }));
}
const stockDe = async (sku) => (await query(`SELECT stock_fisico::int s FROM inventario WHERE sku = $1`, [sku])).rows[0].s;
const fijar = (sku, s) => query(`UPDATE inventario SET stock_fisico = $2, stock_reservado = 0 WHERE sku = $1`, [sku, s]);
const ordenesDe = async () => (await query(`SELECT count(*)::int n FROM orden_venta o JOIN lote_importacion l USING (id_lote) WHERE l.nombre_archivo LIKE $1`, [`${PREFIJO}%`])).rows[0].n;
const lotes = async () => (await query(`SELECT count(*)::int n FROM lote_importacion WHERE nombre_archivo LIKE $1`, [`${PREFIJO}%`])).rows[0].n;

before(async () => {
  await iniciarCache();
  server = crearApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
  [admin, bodega, chofer] = [await login('admin@tiendaoregon.cl'), await login('bodega@tiendaoregon.cl'), await login('chofer@tiendaoregon.cl')];
  adminId = (await query(`SELECT id_usuario FROM usuario WHERE email = 'admin@tiendaoregon.cl'`)).rows[0].id_usuario;
  stock0 = (await query(`SELECT sku, stock_fisico, stock_reservado FROM inventario`)).rows;
});
after(async () => {
  await query(`DELETE FROM orden_venta WHERE id_lote IN (SELECT id_lote FROM lote_importacion WHERE nombre_archivo LIKE $1)`, [`${PREFIJO}%`]);
  await query(`DELETE FROM lote_importacion WHERE nombre_archivo LIKE $1`, [`${PREFIJO}%`]); // audit_log es inmutable y conserva el rastro
  for (const r of stock0) await query(`UPDATE inventario SET stock_fisico = $2, stock_reservado = $3 WHERE sku = $1`, [r.sku, r.stock_fisico, r.stock_reservado]);
  server.close(); await cerrarCache(); await pool.end();
});

test('plantilla base .xlsx descargable con las 7 columnas', async () => {
  const r = await fetch(base + '/api/pedidos/importaciones/plantilla', { headers: { Authorization: `Bearer ${admin.token}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
  assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), CAB);
});

test('ejemplo del documento: TH-4500 24 − 4 = 20, pedido PENDIENTE_PREPARACION, lote en S3 (omitido), auditoría IMPORTACIÓN', async () => {
  await fijar('TH-4500', 24);
  const a = nombre();
  const r = await subir('/api/pedidos/importaciones', admin.token, await xlsx([fila(1, 'TH-4500', 4, 22990)]), a);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.pedidos, 1); assert.equal(r.body.lineas, 1);
  assert.equal(await stockDe('TH-4500'), 20);
  const o = (await query(`SELECT o.estado_orden, o.canal_origen, o.codigo_externo, d.cantidad_vendida, d.precio_unitario::int p, l.url_archivo_s3, l.total_lineas
      FROM orden_venta o JOIN detalle_venta d USING (id_orden) JOIN lote_importacion l USING (id_lote) WHERE l.nombre_archivo = $1`, [a])).rows[0];
  assert.deepEqual([o.estado_orden, o.canal_origen, o.cantidad_vendida, o.p, o.total_lineas], ['PENDIENTE_PREPARACION', 'Mayorista', 4, 22990, 1]);
  assert.equal(o.url_archivo_s3, `lotes/${r.body.id_lote}/${a}`);
  const au = (await query(`SELECT * FROM audit_log WHERE accion = 'IMPORTACIÓN' AND (valores_nuevos->>'id_lote')::int = $1`, [r.body.id_lote])).rows;
  assert.equal(au.length, 1); assert.equal(au[0].id_usuario, adminId); assert.equal(au[0].valores_nuevos.unidades, 4);
});

test('mismo archivo y canal otra vez → 409 por UNIQUE(canal_origen, codigo_externo) y el stock no se rebaja dos veces', async () => {
  await fijar('TH-4500', 24);
  const a = nombre(), buf = await xlsx([fila(2, 'TH-4500', 4)]);
  assert.equal((await subir('/api/pedidos/importaciones', admin.token, buf, a)).status, 201);
  const r = await subir('/api/pedidos/importaciones', admin.token, buf, a);
  assert.equal(r.status, 409); assert.equal(r.body.codigo, 'PEDIDO_DUPLICADO');
  assert.equal(await stockDe('TH-4500'), 20);
  assert.equal((await subir('/api/pedidos/importaciones', admin.token, buf, a, 'Paris')).status, 201); // otro canal: orden distinta
});

test('UT-FORNO stock 3 y venta de 5 → 422 «fila 2: …»; no queda lote, orden ni rebaja; simular informa sin escribir', async () => {
  await fijar('UT-FORNO', 3); await fijar('TH-4500', 24);
  const l0 = await lotes(), a = nombre();
  const buf = await xlsx([fila(3, 'UT-FORNO', 5), fila(4, 'TH-4500', 1)]);
  const r = await subir('/api/pedidos/importaciones', admin.token, buf, a);
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.deepEqual(r.body.detalle.map((e) => e.texto), [r.body.detalle[0].texto]);
  assert.match(r.body.detalle[0].texto, /^fila 2: stock insuficiente para UT-FORNO/);
  assert.equal(await stockDe('UT-FORNO'), 3); assert.equal(await stockDe('TH-4500'), 24);
  assert.equal(await lotes(), l0);
  const s = await subir('/api/pedidos/importaciones/simular', admin.token, buf, a);
  assert.equal(s.status, 200); assert.equal(s.body.valido, false); assert.equal(s.body.errores[0].fila, 2);
  assert.equal(await lotes(), l0); assert.equal(await stockDe('TH-4500'), 24);
});

test('stock validado sobre el total acumulado por SKU y errores fila por fila (SKU, cantidad, obligatorios, RUT)', async () => {
  await fijar('UT-FORNO', 3);
  const buf = await xlsx([
    fila(5, 'UT-FORNO', 2), fila(6, 'UT-FORNO', 2), // la fila 3 cruza el stock (2+2 > 3)
    fila(7, 'NO-EXISTE-S2', 1), fila(8, 'TH-4500', 0), fila(9, 'TH-4500', 1.5),
    ['', 'Sin RUT', 'TH-4500', 'x', 1, 100, 'm'], [rut(10), '', 'TH-4500', 'x', 1, 100, 'm'], [rut(11), 'Sin SKU', '', 'x', 1, 100, 'm'],
    ['11.111.111-2', 'RUT malo', 'TH-4500', 'x', 1, 100, 'm'], [rut(12), 'Sin precio', 'TH-4500', 'x', 1, '', 'm'],
  ]);
  const r = await subir('/api/pedidos/importaciones/simular', admin.token, buf, nombre());
  assert.equal(r.status, 200); assert.equal(r.body.valido, false);
  const por = Object.fromEntries(r.body.errores.map((e) => [e.fila, e.motivo]));
  assert.match(por[3], /stock insuficiente para UT-FORNO.*acumulado en la planilla 4/);
  assert.equal(por[2], undefined);
  assert.match(por[4], /SKU inexistente/); assert.match(por[5], /CANTIDAD/); assert.match(por[6], /CANTIDAD/);
  assert.match(por[7], /RUT CLIENTE es obligatorio/); assert.match(por[8], /NOMBRE CLIENTE es obligatorio/); assert.match(por[9], /SKU es obligatorio/);
  assert.match(por[10], /dígito verificador/); assert.match(por[11], /PRECIO/);
  assert.equal(await stockDe('UT-FORNO'), 3);
});

test('archivo inválido: extensión, contenido, columnas faltantes, sin archivo ni canal; sin permiso 403 + ACCESO_DENEGADO', async () => {
  const l0 = await lotes();
  const e1 = await subir('/api/pedidos/importaciones', admin.token, Buffer.from('a,b'), nombre('.csv').replace('.xlsx', ''), 'Mayorista', 'text/csv');
  assert.equal(e1.status, 400);
  const e2 = await subir('/api/pedidos/importaciones', admin.token, Buffer.from('esto no es un excel'), nombre());
  assert.equal(e2.status, 400); assert.equal(e2.body.codigo, 'ARCHIVO_INVALIDO');
  const e3 = await subir('/api/pedidos/importaciones', admin.token, await xlsx([[rut(1), 'x', 'TH-4500', 1]], ['RUT CLIENTE', 'NOMBRE CLIENTE', 'SKU', 'CANTIDAD']), nombre());
  assert.equal(e3.status, 400); assert.match(e3.body.error, /NOMBRE PRODUCTO.*PRECIO.*MARCA/);
  const e4 = await subir('/api/pedidos/importaciones', admin.token, null, null);
  assert.equal(e4.status, 400);
  const e5 = await subir('/api/pedidos/importaciones', admin.token, await xlsx([fila(1, 'TH-4500', 1)]), nombre(), 'Canal Inventado');
  assert.equal(e5.status, 400);
  assert.equal(await lotes(), l0);

  const cuenta = async () => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'ACCESO_DENEGADO' AND valores_nuevos->>'ruta' LIKE '/api/pedidos/importaciones%'`)).rows[0].n;
  const antes = await cuenta();
  for (const t of [bodega.token, chofer.token]) {
    const r = await subir('/api/pedidos/importaciones', t, await xlsx([fila(1, 'TH-4500', 1)]), nombre());
    assert.equal(r.status, 403); assert.equal(r.body.codigo, 'ACCESO_DENEGADO');
  }
  assert.equal((await subir('/api/pedidos/importaciones/simular', bodega.token, await xlsx([]), nombre())).status, 403);
  assert.equal(await cuenta() - antes, 3);
});

test('ROLLBACK: si falla la auditoría (último paso) no queda lote, órdenes, detalle ni rebaja de stock', async () => {
  await fijar('TH-4500', 24); await fijar('UT-FORNO', 3);
  const l0 = await lotes(), o0 = await ordenesDe();
  const req = { ip: 'no-es-una-ip', usuario: { id_usuario: adminId } };
  await assert.rejects(importar(req, await xlsx([fila(20, 'TH-4500', 4), fila(21, 'UT-FORNO', 2)]), nombre(), 'Mayorista'), /inet|invalid/i);
  assert.equal(await lotes(), l0); assert.equal(await ordenesDe(), o0);
  assert.equal(await stockDe('TH-4500'), 24); assert.equal(await stockDe('UT-FORNO'), 3);
});

test('concurrencia: dos importaciones simultáneas sobre el mismo stock → una 201, la otra 409; stock nunca negativo', async () => {
  await fijar('UT-FORNO', 3);
  const l0 = await lotes();
  const bloqueo = await pool.connect(); // retiene la fila para que ambas pasen la validación y se encuentren en el UPDATE
  await bloqueo.query('BEGIN'); await bloqueo.query(`SELECT 1 FROM inventario WHERE sku = 'UT-FORNO' FOR UPDATE`);
  const lanzar = async (n) => subir('/api/pedidos/importaciones', admin.token, await xlsx([fila(30 + n, 'UT-FORNO', 2)]), nombre());
  const ps = [lanzar(1), lanzar(2)];
  await new Promise((r) => setTimeout(r, 500));
  await bloqueo.query('COMMIT'); bloqueo.release();
  const res = await Promise.all(ps);
  assert.deepEqual(res.map((r) => r.status).sort(), [201, 409], JSON.stringify(res.map((r) => r.body)));
  assert.equal(res.find((r) => r.status === 409).body.codigo, 'STOCK_CAMBIO');
  assert.equal(await stockDe('UT-FORNO'), 1);
  assert.equal(await lotes() - l0, 1);
});

test('planilla de más de 200 filas (PR-02: 5.000 líneas) se procesa sin errores; se mide el tiempo', async (t) => {
  const skus = ['TH-4500', 'UT-FORNO', 'GM-ELEGANCE', 'GM-KERATION', 'GM-COCONUT', 'GM-INNOVA', 'GM-566-29', 'GM-GCXMASTER'];
  for (const s of skus) await fijar(s, 100000);
  const chica = await xlsx(Array.from({ length: 250 }, (_, i) => fila(1000 + i, skus[i % 8], 1)));
  const rc = await subir('/api/pedidos/importaciones', admin.token, chica, nombre());
  assert.equal(rc.status, 201, JSON.stringify(rc.body).slice(0, 300)); assert.equal(rc.body.lineas, 250);

  const filas = Array.from({ length: 5000 }, (_, i) => fila(2000 + Math.floor(i / 8), skus[i % 8], 1 + (i % 3)));
  const buf = await xlsx(filas);
  const t0 = performance.now();
  const r = await subir('/api/pedidos/importaciones', admin.token, buf, nombre());
  const ms = Math.round(performance.now() - t0);
  t.diagnostic(`PR-02: 5.000 líneas, ${r.body.pedidos} pedidos, tiempo total (subida + validación + transacción) ${ms} ms`);
  console.log(`PR-02: 5.000 líneas importadas en ${ms} ms`);
  assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
  assert.equal(r.body.lineas, 5000); assert.equal(r.body.pedidos, 625);
  assert.ok(ms < 15000, `tardó ${ms} ms`);
  const esperado = filas.reduce((s, f) => s + f[4], 0);
  assert.equal(r.body.unidades, esperado);
  assert.equal(100000 * 8 - 250 - esperado, (await query(`SELECT sum(stock_fisico)::int s FROM inventario WHERE sku = ANY($1)`, [skus])).rows[0].s);
});
