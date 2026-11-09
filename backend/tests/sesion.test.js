// T02: expiración por inactividad (SESSION_IDLE_MINUTES, por defecto 15) y JWT solo con `sub`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';
import { registrarActividad, ultimaActividad } from '../src/session.js';

const PASS = 'Demo-Oregon-2026';
const MIN = 60_000;
let server, base;
const api = (ruta, token) => fetch(base + ruta, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: await r.json() }));
async function login() {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@tiendaoregon.cl', password: PASS }) });
  const { token } = await r.json();
  return { token, sub: JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub };
}

before(async () => { await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`); });
after(async () => { server.close(); await cerrarCache(); await pool.end(); });

test('el JWT lleva solo sub (más iat/exp)', async () => {
  const { token } = await login();
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'sub']);
});

test('token inactivo más allá de SESSION_IDLE_MINUTES → 401 SESION_EXPIRADA (y no renueva)', async () => {
  const { token, sub } = await login();
  assert.equal((await api('/api/auth/me', token)).status, 200);
  await registrarActividad(sub, Date.now() - 16 * MIN);
  const r = await api('/api/auth/me', token);
  assert.equal(r.status, 401);
  assert.equal(r.body.codigo, 'SESION_EXPIRADA');
  assert.equal((await api('/api/auth/me', token)).status, 401); // sigue expirada
});

test('una petición válida renueva la actividad', async () => {
  const { token, sub } = await login();
  await registrarActividad(sub, Date.now() - 10 * MIN);
  assert.equal((await api('/api/auth/me', token)).status, 200);
  assert.ok(Date.now() - (await ultimaActividad(sub)) < MIN);
});

test('sin Redis se usa el mapa en memoria de respaldo', async () => {
  const { token, sub } = await login();
  await cerrarCache(); // client = null → redisGet devuelve undefined
  assert.equal((await api('/api/auth/me', token)).status, 200);
  await registrarActividad(sub, Date.now() - 16 * MIN);
  assert.equal((await api('/api/auth/me', token)).body.codigo, 'SESION_EXPIRADA');
});
