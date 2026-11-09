// T46: auditoría en la misma transacción e inmutabilidad; 403 + ACCESO_DENEGADO.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query, conTransaccion } from '../src/db.js';
import { auditar } from '../src/audit.js';

const PASS = 'Demo-Oregon-2026';
const req = { ip: '127.0.0.1' };
let server, base;
before(async () => { await iniciarCache(); server = crearApp().listen(0); base = `http://localhost:${server.address().port}`; });
after(async () => { server.close(); await cerrarCache(); await pool.end(); });

const cuenta = async (accion) => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = $1`, [accion])).rows[0].n;

test('auditar con client: ROLLBACK de la operación no deja registro', async () => {
  const accion = `PRUEBA_RB_${Date.now()}`;
  await assert.rejects(() => conTransaccion(async (c) => {
    await auditar(req, { tabla: 'prueba', accion }, c);
    throw new Error('falla la operación');
  }), /falla la operación/);
  assert.equal(await cuenta(accion), 0);
});

test('auditar con client: COMMIT deja el registro', async () => {
  const accion = `PRUEBA_OK_${Date.now()}`;
  await conTransaccion((c) => auditar(req, { tabla: 'prueba', accion, despues: { x: 1 } }, c));
  assert.equal(await cuenta(accion), 1);
});

test('auditar con client propaga el error (no lo traga) para revertir la operación', async () => {
  await assert.rejects(() => conTransaccion((c) => auditar(req, { tabla: 'prueba', accion: 'X', geo: 'no-valida' }, c)));
});

test('audit_log es inmutable: UPDATE y DELETE fallan', async () => {
  await auditar(req, { tabla: 'prueba', accion: 'PRUEBA_INMUTABLE' });
  await assert.rejects(() => query(`UPDATE audit_log SET accion = 'X' WHERE accion = 'PRUEBA_INMUTABLE'`), /inmutable/);
  await assert.rejects(() => query(`DELETE FROM audit_log WHERE accion = 'PRUEBA_INMUTABLE'`), /inmutable/);
});

test('acceso denegado: 403 con código ACCESO_DENEGADO y queda en la bitácora', async () => {
  const antes = await cuenta('ACCESO_DENEGADO');
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'chofer@tiendaoregon.cl', password: PASS }) });
  const { token } = await l.json();
  const r = await fetch(`${base}/api/auditoria`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).codigo, 'ACCESO_DENEGADO');
  assert.equal(await cuenta('ACCESO_DENEGADO'), antes + 1);
});

test('limite de /api/auditoria se acota a 1..200 y tolera basura', async () => {
  const l = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@tiendaoregon.cl', password: PASS }) });
  const { token } = await l.json();
  const n = async (q) => (await (await fetch(`${base}/api/auditoria?limite=${q}`, { headers: { Authorization: `Bearer ${token}` } })).json()).length;
  assert.equal(await n(-5), 1);
  assert.equal(await n(0), 50); // 0 → valor por defecto
  assert.equal(await n('abc'), 50);
  assert.ok((await n(100000)) <= 200);
});
