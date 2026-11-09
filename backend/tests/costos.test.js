// T03: costos y márgenes jamás en respuestas a BODEGA/CHOFER.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { sinCostos } from '../src/middleware/costos.js';

const PASS = 'Demo-Oregon-2026';
const RUTAS = ['/api/inventario/buscar?q=TH', '/api/pedidos', '/api/productos', '/api/dashboard/kpis', '/api/auditoria', '/api/auth/me'];
let server, base;
const login = async (email) => (await (await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASS }),
})).json()).token;

before(async () => { await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`); });
after(async () => { server.close(); await cerrarCache(); await pool.end(); });

for (const email of ['bodega@tiendaoregon.cl', 'chofer@tiendaoregon.cl']) {
  test(`ninguna respuesta a ${email} contiene costos, márgenes ni valorización`, async () => {
    const token = await login(email);
    for (const ruta of RUTAS) {
      const r = await fetch(base + ruta, { headers: { Authorization: `Bearer ${token}` } });
      assert.doesNotMatch(await r.text(), /costo|margen|valorizacion/i, ruta);
    }
  });
}

test('sinCostos omite campos sensibles en objetos y listas anidadas', () => {
  const limpio = sinCostos([{ sku: 'A', costo_adquisicion_neto: 5, precios: { web: { precio: 9, margen: 40 } }, fecha: new Date(0) }]);
  assert.deepEqual(JSON.parse(JSON.stringify(limpio)), [{ sku: 'A', precios: { web: { precio: 9 } }, fecha: '1970-01-01T00:00:00.000Z' }]);
});

test('el Administrador sigue viendo costos y márgenes', async () => {
  const token = await login('admin@tiendaoregon.cl');
  const r = await fetch(`${base}/api/productos`, { headers: { Authorization: `Bearer ${token}` } });
  assert.match(await r.text(), /costo_adquisicion_neto/);
});
