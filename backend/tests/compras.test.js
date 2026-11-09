// HU03 / T13–T16 y T49: recepción de mercadería contra factura y confirmación de descarga.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { calcularMontos, registrar } from '../src/services/compras.js';

const PASS = 'Demo-Oregon-2026';
const SUF = Date.now().toString(36).toUpperCase();
const RUT = '78.806.090-4'; // GAMA CHILE S.A. (RUT válido; la factura de prueba lleva prefijo S2T- para no chocar con la 54691 de la semilla)
const GAMA = [['GM-ELEGANCE', 1, 19406], ['GM-KERATION', 1, 26465], ['GM-COCONUT', 2, 15876], ['GM-INNOVA', 2, 14700], ['GM-566-29', 2, 20582], ['GM-GCXMASTER', 1, 17641]];
const items = (lista = GAMA) => lista.map(([sku, cantidad, p]) => ({ sku, cantidad, precio_unitario_neto: p }));
const cabecera = (n, extra = {}) => ({ rut_proveedor: RUT, razon_social: 'GAMA CHILE S.A.', numero_factura: `S2T-${SUF}-${n}`, fecha_emision: '2026-09-22', forma_pago: 'Contado', items: items(), ...extra });

let server, base, admin, bodega, chofer, stock0;
const http = (metodo, ruta, token, body) => fetch(base + ruta, {
  method: metodo, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const login = async (email) => (await http('POST', '/api/auth/login', null, { email, password: PASS })).body;
const stock = async () => Object.fromEntries((await query(`SELECT sku, stock_fisico::int s FROM inventario WHERE sku LIKE 'GM-%'`)).rows.map((r) => [r.sku, r.s]));
const nRec = async () => (await query(`SELECT count(*)::int n FROM recepcion_compra WHERE numero_factura LIKE 'S2T-${SUF}-%'`)).rows[0].n;
const nAudit = async (accion, patron) => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = $1 AND valores_nuevos->>'factura' LIKE $2`, [accion, patron])).rows[0].n;

before(async () => {
  await iniciarCache();
  server = crearApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
  [admin, bodega, chofer] = [await login('admin@tiendaoregon.cl'), await login('bodega@tiendaoregon.cl'), await login('chofer@tiendaoregon.cl')];
  stock0 = await stock();
});
after(async () => {
  await query(`DELETE FROM recepcion_compra WHERE numero_factura LIKE 'S2T-${SUF}-%'`); // el detalle cae en cascada; audit_log es inmutable y queda
  for (const [sku, s] of Object.entries(stock0)) await query(`UPDATE inventario SET stock_fisico = $2 WHERE sku = $1`, [sku, s]);
  server.close(); await cerrarCache(); await pool.end();
});

test('montos: IVA 19 % sin errores de redondeo (factura 54691)', () => {
  const m = calcularMontos(GAMA.map(([sku, cantidad, precio]) => ({ sku, cantidad, precio })));
  assert.deepEqual(m, { neto: 165828, iva: 31507, total: 197335 });
  assert.deepEqual(calcularMontos([{ cantidad: 3, precio: 0.1 }]), { neto: 0.3, iva: 0, total: 0.3 }); // 0,1 × 3 en flotante da 0,30000000000000004
  assert.deepEqual(calcularMontos([{ cantidad: 1, precio: 1000 }]), { neto: 1000, iva: 190, total: 1190 });
});

test('factura estilo 54691: crea recepción y detalle, suma 9 unidades a GAMA y audita RECEPCIÓN', async () => {
  const r = await http('POST', '/api/compras/recepciones', admin.token, cabecera('A'));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.unidades, 9);
  assert.deepEqual([r.body.monto_neto, r.body.monto_iva, r.body.monto_total], [165828, 31507, 197335]);
  const s = await stock();
  for (const [sku, cant] of GAMA) assert.equal(s[sku] - stock0[sku], cant, sku);
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(total(s) - total(stock0), 9);
  const a = (await query(`SELECT * FROM audit_log WHERE accion = 'RECEPCIÓN' AND valores_nuevos->>'factura' = $1`, [`S2T-${SUF}-A`])).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].valores_nuevos.unidades, 9);
  assert.equal(Number(a[0].valores_nuevos.monto_total), 197335);
  assert.equal(a[0].valores_nuevos.rut_proveedor, RUT);
  const d = (await query(`SELECT count(*)::int n, sum(cantidad_recibida)::int u FROM detalle_recepcion d JOIN recepcion_compra r USING (id_recepcion) WHERE r.numero_factura = $1`, [`S2T-${SUF}-A`])).rows[0];
  assert.deepEqual(d, { n: 6, u: 9 });
});

test('409 si la factura del proveedor ya existe (también la 54691 de la semilla) y no toca el stock', async () => {
  const antes = await stock();
  assert.equal((await http('POST', '/api/compras/recepciones', admin.token, cabecera('A'))).status, 409);
  const r = await http('POST', '/api/compras/recepciones', admin.token, cabecera('x', { numero_factura: '54691' }));
  assert.equal(r.status, 409);
  assert.equal(r.body.codigo, 'FACTURA_DUPLICADA');
  assert.deepEqual(await stock(), antes);
});

test('validaciones: SKU inexistente 422, cantidad inválida / RUT inválido / fecha 400; no se escribe nada', async () => {
  const antes = await stock(), n0 = await nRec();
  const r1 = await http('POST', '/api/compras/recepciones', admin.token, cabecera('B', { items: items([...GAMA, ['NO-EXISTE-S2', 1, 100]]) }));
  assert.equal(r1.status, 422); assert.match(r1.body.error, /NO-EXISTE-S2/);
  for (const [extra, patron] of [
    [{ items: items([['GM-COCONUT', 0, 100]]) }, /cantidad/], [{ items: items([['GM-COCONUT', 1.5, 100]]) }, /cantidad/],
    [{ items: items([['GM-COCONUT', 1, -5]]) }, /precio/], [{ items: [] }, /ítem/],
    [{ rut_proveedor: '78.806.090-5' }, /RUT/], [{ fecha_emision: '2026-02-31' }, /fecha/], [{ razon_social: '' }, /razon_social/],
  ]) {
    const r = await http('POST', '/api/compras/recepciones', admin.token, cabecera('C', extra));
    assert.equal(r.status, 400, JSON.stringify(extra)); assert.match(r.body.error, patron);
  }
  assert.equal(await nRec(), n0);
  assert.deepEqual(await stock(), antes);
});

test('ROLLBACK: si falla la auditoría a mitad de la transacción no queda recepción, detalle, stock ni auditoría', async () => {
  const antes = await stock(), n0 = await nRec();
  const req = { ip: 'no-es-una-ip', usuario: { id_usuario: (await query(`SELECT id_usuario FROM usuario WHERE email = 'admin@tiendaoregon.cl'`)).rows[0].id_usuario } };
  await assert.rejects(registrar(req, cabecera('R')), /inet|invalid/i); // el INSERT de audit_log es lo último de la transacción
  assert.equal(await nRec(), n0);
  assert.equal((await query(`SELECT count(*)::int n FROM detalle_recepcion d JOIN recepcion_compra r USING (id_recepcion) WHERE r.numero_factura = $1`, [`S2T-${SUF}-R`])).rows[0].n, 0);
  assert.deepEqual(await stock(), antes);
  assert.equal(await nAudit('RECEPCIÓN', `S2T-${SUF}-R`), 0);
  // la factura no quedó "quemada": se puede registrar de verdad
  assert.equal((await http('POST', '/api/compras/recepciones', admin.token, cabecera('R', { items: items([['GM-COCONUT', 1, 100]]) }))).status, 201);
});

test('PDF: con almacenamiento desactivado se omite sin error; archivo no PDF se rechaza', async () => {
  const form = (nombre, contenido, tipo) => {
    const f = new FormData();
    f.set('datos', JSON.stringify(cabecera(nombre, { items: items([['GM-COCONUT', 1, 100]]) })));
    f.set('pdf', new Blob([contenido], { type: tipo }), 'f.pdf');
    return f;
  };
  const post = (f) => fetch(base + '/api/compras/recepciones', { method: 'POST', headers: { Authorization: `Bearer ${admin.token}` }, body: f }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const ok = await post(form('P', '%PDF-1.4 prueba', 'application/pdf'));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.url_pdf_factura, null);
  const mal = await post(form('P2', 'no soy pdf', 'text/plain'));
  assert.equal(mal.status, 400);
});

test('403 + ACCESO_DENEGADO auditado para BODEGA y CHOFER en recepciones, y para ADMIN en confirmar descarga', async () => {
  const cuenta = async () => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'ACCESO_DENEGADO' AND valores_nuevos->>'ruta' LIKE '/api/compras%'`)).rows[0].n;
  const antes = await cuenta(), n0 = await nRec();
  for (const t of [bodega.token, chofer.token]) {
    const r = await http('POST', '/api/compras/recepciones', t, cabecera('D'));
    assert.equal(r.status, 403); assert.equal(r.body.codigo, 'ACCESO_DENEGADO');
  }
  assert.equal((await http('POST', '/api/compras/descargas', admin.token, { numero_factura: '54691', bultos: [] })).status, 403);
  assert.equal((await http('POST', '/api/compras/recepciones', null, cabecera('D'))).status, 401);
  assert.equal(await cuenta() - antes, 3);
  assert.equal(await nRec(), n0);
});

test('T49: BODEGA confirma la descarga con conteo por SKU; conforme y con discrepancia; sin costos ni precios', async () => {
  const conforme = await http('POST', '/api/compras/descargas', bodega.token, { numero_factura: `S2T-${SUF}-A`, bultos: GAMA.map(([sku, cantidad]) => ({ sku, cantidad })) });
  assert.equal(conforme.status, 200, JSON.stringify(conforme.body));
  assert.equal(conforme.body.estado_documento, 'CONFORME');
  assert.deepEqual(conforme.body.discrepancias, []);
  assert.doesNotMatch(JSON.stringify(conforme.body), /precio|costo|monto|margen/i);

  const dif = await http('POST', '/api/compras/descargas', bodega.token, { numero_factura: `S2T-${SUF}-A`, bultos: [{ sku: 'GM-COCONUT', cantidad: 1 }, { sku: 'GM-INNOVA', cantidad: 2 }] });
  assert.equal(dif.body.estado_documento, 'CON_DISCREPANCIA');
  assert.deepEqual(dif.body.discrepancias.find((d) => d.sku === 'GM-COCONUT'), { sku: 'GM-COCONUT', esperado: 2, contado: 1 });
  assert.equal((await query(`SELECT estado_documento FROM recepcion_compra WHERE numero_factura = $1`, [`S2T-${SUF}-A`])).rows[0].estado_documento, 'CON_DISCREPANCIA');

  const a = (await query(`SELECT u.email, a.fecha_hora FROM audit_log a JOIN usuario u USING (id_usuario) WHERE a.accion = 'DESCARGA_CONFIRMADA' AND a.valores_nuevos->>'factura' = $1`, [`S2T-${SUF}-A`])).rows;
  assert.equal(a.length, 2);
  assert.equal(a[0].email, 'bodega@tiendaoregon.cl');
  assert.equal((await http('POST', '/api/compras/descargas', bodega.token, { numero_factura: 'NO-EXISTE', bultos: [{ sku: 'GM-COCONUT', cantidad: 1 }] })).status, 404);
  assert.equal((await http('POST', '/api/compras/descargas', bodega.token, { numero_factura: '54691', bultos: [] })).status, 400);
  assert.equal((await stock())['GM-COCONUT'] - stock0['GM-COCONUT'], 4, 'confirmar descarga no mueve stock'); // A (2) + R (1) + P (1)
});
