// Pruebas de integración de las políticas de seguridad del informe. Requieren la BD con datos de ejemplo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';

const PASS = 'Demo-Oregon-2026';
let server, base;

const api = async (ruta, { metodo = 'GET', token, cuerpo } = {}) => {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: cuerpo && JSON.stringify(cuerpo),
  });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};
const login = async (email) => (await api('/api/auth/login', { metodo: 'POST', cuerpo: { email, password: PASS } })).body?.token;

before(async () => {
  await iniciarCache();
  server = crearApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
});
after(async () => {
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
  server.close();
  await cerrarCache();
  await pool.end();
});

test('login correcto devuelve token y rol real', async () => {
  const r = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: 'admin@tiendaoregon.cl', password: PASS } });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.rol, 'ADMINISTRADOR');
  assert.ok(r.body.token);
});

test('usuario inexistente y clave errónea devuelven el mismo mensaje (anti-enumeración)', async () => {
  const a = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: 'nadie@x.cl', password: 'x' } });
  const b = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: 'admin@tiendaoregon.cl', password: 'mala' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error, b.body.error);
});

test('rol enviado por el cliente se ignora: el rol sale de la BD', async () => {
  const r = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: 'bodega@tiendaoregon.cl', password: PASS, rol: 'ADMINISTRADOR' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario.rol, 'BODEGA');
});

test('sin token → 401', async () => {
  assert.equal((await api('/api/productos')).status, 401);
});

test('Bodega no ve costos ni precios; solo inventario sin costos', async () => {
  const token = await login('bodega@tiendaoregon.cl');
  assert.equal((await api('/api/productos', { token })).status, 403); // sin catalogo:leer
  const r = await api('/api/inventario/buscar?q=TH', { token });
  assert.equal(r.status, 200);
  assert.ok(r.body.length > 0);
  assert.ok(!JSON.stringify(r.body).includes('costo'));
  assert.ok(!JSON.stringify(r.body).includes('margen'));
});

test('Chofer: default deny en dashboard, auditoría e inventario', async () => {
  const token = await login('chofer@tiendaoregon.cl');
  for (const ruta of ['/api/dashboard/kpis', '/api/auditoria', '/api/inventario/buscar?q=TH', '/api/productos']) {
    assert.equal((await api(ruta, { token })).status, 403, ruta);
  }
});

test('Administrador ve costos, KPIs y auditoría; el acceso denegado queda auditado', async () => {
  const admin = await login('admin@tiendaoregon.cl');
  const prods = await api('/api/productos', { token: admin });
  assert.equal(prods.status, 200);
  assert.ok('costo_adquisicion_neto' in prods.body[0]);
  const kpi = await api('/api/dashboard/kpis', { token: admin });
  assert.equal(kpi.status, 200);
  assert.ok(kpi.body.valorizacion_inventario > 0);

  const chofer = await login('chofer@tiendaoregon.cl');
  await api('/api/auditoria', { token: chofer });
  const log = await api('/api/auditoria?limite=10', { token: admin });
  assert.ok(log.body.some((l) => l.accion === 'ACCESO_DENEGADO' && l.rol === 'CHOFER'));
});

test('bloqueo de cuenta tras 5 intentos fallidos (incluso con la clave correcta)', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: 'chofer@tiendaoregon.cl', password: 'incorrecta' } });
    assert.equal(r.status, 401);
  }
  const r = await api('/api/auth/login', { metodo: 'POST', cuerpo: { email: 'chofer@tiendaoregon.cl', password: PASS } });
  assert.equal(r.status, 401);
});
