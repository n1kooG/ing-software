// Bloqueo por intentos atómico bajo peticiones concurrentes (T02/T04, corrección de seguridad).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';

const PASS = 'Demo-Oregon-2026';
const EMAIL = 'bodega@tiendaoregon.cl';
let server, base;
const login = (password) => fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password }),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const reset = () => query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);

before(async () => { await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; await reset(); });
after(async () => { await reset(); server.close(); await cerrarCache(); await pool.end(); });

test('12 intentos fallidos concurrentes: el contador se detiene en 5 y la cuenta queda bloqueada', async () => {
  const rs = await Promise.all(Array.from({ length: 12 }, () => login('mala')));
  assert.ok(rs.every((r) => r.status === 401 && r.body.error === 'Usuario o contraseña incorrectos'));
  const { rows: [u] } = await query(`SELECT intentos_fallidos, bloqueado_hasta > now() AS bloqueada FROM usuario WHERE email = $1`, [EMAIL]);
  assert.equal(u.intentos_fallidos, 5);
  assert.equal(u.bloqueada, true);
});

test('con la cuenta bloqueada, un login correcto concurrente con fallos también es rechazado', async () => {
  const rs = await Promise.all([login(PASS), login('mala'), login(PASS)]);
  assert.ok(rs.every((r) => r.status === 401));
});

test('4 fallos + 1 correcto concurrentes: nunca se supera el límite sin bloqueo', async () => {
  await reset();
  await Promise.all([login('mala'), login('mala'), login('mala'), login('mala'), login(PASS)]);
  const { rows: [u] } = await query(`SELECT intentos_fallidos, bloqueado_hasta FROM usuario WHERE email = $1`, [EMAIL]);
  assert.ok(u.intentos_fallidos <= 4);
  assert.equal(u.bloqueado_hasta, null);
});
