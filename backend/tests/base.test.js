// T45: manejador de errores central, health y almacenamiento desactivable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool } from '../src/db.js';
import { AppError, ah } from '../src/errors.js';
import { manejadorErrores } from '../src/middleware/errores.js';
import { subir } from '../src/storage.js';

let server, base;
before(async () => {
  await iniciarCache();
  server = crearApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await cerrarCache(); await pool.end(); });

test('/api/health informa BD, Redis y almacenamiento', async () => {
  const r = await fetch(`${base}/api/health`);
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.bd, 'ok');
  assert.ok(['ok', 'caido', 'desactivado'].includes(b.redis));
  assert.equal(b.almacenamiento, 'desactivado');
});

test('una promesa rechazada en un handler async llega al manejador central con JSON uniforme (no tumba el proceso)', async () => {
  const app = express();
  app.get('/boom', ah(async () => { throw new Error('secreto interno'); }));
  app.get('/app', ah(async () => { throw new AppError(409, 'Conflicto', 'CONFLICTO'); }));
  app.use(manejadorErrores);
  const s = app.listen(0);
  const url = `http://localhost:${s.address().port}`;
  const a = await fetch(`${url}/boom`);
  assert.equal(a.status, 500);
  assert.deepEqual(await a.json(), { error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' });
  const b = await fetch(`${url}/app`);
  assert.equal(b.status, 409);
  assert.deepEqual(await b.json(), { error: 'Conflicto', codigo: 'CONFLICTO' });
  s.close();
});

test('JSON malformado → 400 uniforme; ruta inexistente → 404 uniforme', async () => {
  const a = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{x' });
  assert.equal(a.status, 400);
  assert.equal((await a.json()).codigo, 'SOLICITUD_INVALIDA');
  const b = await fetch(`${base}/api/nada`);
  assert.equal(b.status, 404);
  assert.equal((await b.json()).codigo, 'NO_ENCONTRADO');
});

test('con STORAGE_ENABLED=false el módulo S3 no sube nada', async () => {
  await assert.rejects(() => subir('x', Buffer.from('x')), /desactivado/);
});
