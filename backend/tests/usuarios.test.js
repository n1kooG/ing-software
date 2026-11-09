// T47 / T04: administración de usuarios (solo ADMINISTRADOR con usuarios:administrar).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from '../src/app.js';
import { iniciarCache, cerrarCache } from '../src/cache.js';
import { pool, query } from '../src/db.js';

const PASS = 'Demo-Oregon-2026';
const CLAVE_INICIAL = 'Clave-Inicial-9';
const SUF = Date.now().toString(36);
// RUT válido aleatorio (módulo 11): evita choques con restos de corridas anteriores.
function rutAleatorio() {
  const cuerpo = String(10_000_000 + Math.floor(Math.random() * 80_000_000));
  let suma = 0, f = 2;
  for (const d of [...cuerpo].reverse()) { suma += Number(d) * f; f = f === 7 ? 2 : f + 1; }
  const r = 11 - (suma % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return `${cuerpo.slice(0, 2)}.${cuerpo.slice(2, 5)}.${cuerpo.slice(5)}-${dv}`;
}
const RUT = rutAleatorio();
const RUT2 = rutAleatorio();
let server, base, admin, bodega, chofer;
const creados = [];

const http = (metodo, ruta, token, body) => fetch(base + ruta, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  body: body && JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
const login = async (email, password = PASS) => (await http('POST', '/api/auth/login', null, { email, password }));
const idDe = async (email) => (await query(`SELECT id_usuario FROM usuario WHERE email = $1`, [email])).rows[0].id_usuario;
const nuevo = async (extra = {}) => {
  const r = await http('POST', '/api/usuarios', admin.token, { rut: RUT, nombre_completo: 'Prueba Usuarios', email: `prueba.${SUF}@tiendaoregon.cl`, rol: 'BODEGA', password: CLAVE_INICIAL, ...extra });
  if (r.status === 201) creados.push(r.body.id_usuario);
  return r;
};
const auditorias = async (accion, id) => (await query(
  `SELECT * FROM audit_log WHERE accion = $1 AND (valores_nuevos->>'id_usuario')::int = $2 ORDER BY id_log`, [accion, id])).rows;

before(async () => {
  await iniciarCache();
  server = crearApp().listen(0);
  base = `http://localhost:${server.address().port}`;
  await query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL`);
  admin = (await login('admin@tiendaoregon.cl')).body;
  bodega = (await login('bodega@tiendaoregon.cl')).body;
  chofer = (await login('chofer@tiendaoregon.cl')).body;
  admin.id = await idDe('admin@tiendaoregon.cl');
});
after(async () => {
  // Los usuarios creados nunca inician sesión (audit_log los referenciaría y no se podrían borrar); la auditoría guarda al administrador.
  if (creados.length) await query(`DELETE FROM usuario WHERE id_usuario = ANY($1)`, [creados]);
  await query(`UPDATE usuario u SET id_rol = r.id_rol FROM rol r WHERE r.nombre_rol = 'ADMINISTRADOR' AND u.email = 'admin@tiendaoregon.cl'`);
  await query(`UPDATE usuario SET activo = true WHERE email IN ('bodega@tiendaoregon.cl','chofer@tiendaoregon.cl','admin@tiendaoregon.cl')`);
  server.close(); await cerrarCache(); await pool.end();
});

test('BODEGA y CHOFER reciben 403 en todas las rutas y queda ACCESO_DENEGADO', async () => {
  const cuenta = async () => (await query(`SELECT count(*)::int n FROM audit_log WHERE accion = 'ACCESO_DENEGADO' AND valores_nuevos->>'ruta' LIKE '/api/usuarios%'`)).rows[0].n;
  const antes = await cuenta();
  for (const t of [bodega.token, chofer.token]) {
    for (const [m, ruta, b] of [['GET', '/api/usuarios'], ['POST', '/api/usuarios', {}], ['PATCH', '/api/usuarios/1/rol', { rol: 'BODEGA' }], ['POST', '/api/usuarios/1/baja'], ['POST', '/api/usuarios/1/reactivar']]) {
      const r = await http(m, ruta, t, b);
      assert.equal(r.status, 403, `${m} ${ruta}`);
      assert.equal(r.body.codigo, 'ACCESO_DENEGADO');
    }
  }
  assert.equal(await cuenta(), antes + 10);
  assert.equal((await http('GET', '/api/usuarios')).status, 401);
});

test('listar: nombre, correo, rol, acceso a costos y estado; sin hash de clave', async () => {
  const r = await http('GET', '/api/usuarios', admin.token);
  assert.equal(r.status, 200);
  const por = Object.fromEntries(r.body.map((u) => [u.email, u]));
  assert.equal(por['admin@tiendaoregon.cl'].acceso_costos, true);
  assert.equal(por['bodega@tiendaoregon.cl'].acceso_costos, false);
  assert.equal(por['bodega@tiendaoregon.cl'].activo, true);
  assert.ok(!JSON.stringify(r.body).includes('password'));
});

test('crear: hash bcrypt costo 12, clave nunca devuelta ni auditada, y auditoría', async () => {
  const r = await nuevo();
  assert.equal(r.status, 201);
  assert.equal(r.body.rol, 'BODEGA');
  assert.ok(!JSON.stringify(r.body).includes(CLAVE_INICIAL) && !('password_hash' in r.body));
  const { rows: [u] } = await query(`SELECT password_hash FROM usuario WHERE id_usuario = $1`, [r.body.id_usuario]);
  assert.match(u.password_hash, /^\$2[abxy]\$12\$/);
  assert.notEqual(u.password_hash, CLAVE_INICIAL);
  const [a] = await auditorias('USUARIO_CREADO', r.body.id_usuario);
  assert.equal(a.id_usuario, admin.id);
  assert.equal(a.valores_nuevos.rol, 'BODEGA');
  assert.ok(!JSON.stringify(a).includes(CLAVE_INICIAL) && !JSON.stringify(a).includes('$2'));
  const { rows: [v] } = await query(`SELECT password_hash = crypt($2, password_hash) AS ok FROM usuario WHERE id_usuario = $1`, [r.body.id_usuario, CLAVE_INICIAL]);
  assert.ok(v.ok);
});

test('crear: correo o RUT duplicado (409) e inválidos (400)', async () => {
  const dupEmail = await nuevo({ rut: RUT2, email: `PRUEBA.${SUF}@TiendaOregon.cl` }); // distinto caso
  assert.equal(dupEmail.status, 409);
  assert.match(dupEmail.body.error, /correo/);
  const dupRut = await nuevo({ email: `otro.${SUF}@tiendaoregon.cl` });
  assert.equal(dupRut.status, 409);
  assert.match(dupRut.body.error, /RUT/);
  for (const [extra, texto] of [
    [{ rut: '12.345.678-9' }, /RUT/], [{ rut: 'abc' }, /RUT/], [{ email: 'sin-arroba' }, /Correo/], [{ rol: 'DIOS' }, /Rol/],
    [{ password: 'corta' }, /contraseña/], [{ nombre_completo: '  ' }, /Faltan/], [{ password: 12345678 }, /Faltan/],
  ]) {
    const r = await nuevo({ rut: RUT2, email: `x.${SUF}@tiendaoregon.cl`, ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.body.codigo, 'SOLICITUD_INVALIDA');
    assert.match(r.body.error, texto);
  }
});

test('cambiar rol, baja y reactivación quedan auditados con valores antes y después', async () => {
  const id = creados[0];
  const rol = await http('PATCH', `/api/usuarios/${id}/rol`, admin.token, { rol: 'CHOFER' });
  assert.equal(rol.status, 200);
  assert.equal(rol.body.rol, 'CHOFER');
  const [ar] = await auditorias('ROL_CAMBIADO', id);
  assert.equal(ar.valores_anteriores.rol, 'BODEGA');
  assert.equal(ar.valores_nuevos.rol, 'CHOFER');

  assert.equal((await http('PATCH', `/api/usuarios/${id}/rol`, admin.token, { rol: 'NADA' })).status, 400);
  assert.equal((await http('PATCH', '/api/usuarios/99999999/rol', admin.token, { rol: 'BODEGA' })).status, 404);
  assert.equal((await http('POST', '/api/usuarios/abc/baja', admin.token)).status, 404);

  const baja = await http('POST', `/api/usuarios/${id}/baja`, admin.token);
  assert.equal(baja.body.activo, false);
  const [ab] = await auditorias('USUARIO_BAJA', id);
  assert.equal(ab.valores_anteriores.activo, true);
  assert.equal(ab.valores_nuevos.activo, false);

  const re = await http('POST', `/api/usuarios/${id}/reactivar`, admin.token);
  assert.equal(re.body.activo, true);
  assert.equal((await auditorias('USUARIO_REACTIVADO', id)).length, 1);
});

test('la baja invalida de inmediato el token vigente y el login', async () => {
  const id = await idDe('chofer@tiendaoregon.cl');
  const sesion = (await login('chofer@tiendaoregon.cl')).body;
  assert.equal((await http('GET', '/api/auth/me', sesion.token)).status, 200);
  assert.equal((await http('POST', `/api/usuarios/${id}/baja`, admin.token)).status, 200);
  try {
    assert.equal((await http('GET', '/api/auth/me', sesion.token)).status, 401);
    assert.equal((await login('chofer@tiendaoregon.cl')).status, 401);
  } finally {
    await http('POST', `/api/usuarios/${id}/reactivar`, admin.token);
  }
  assert.equal((await login('chofer@tiendaoregon.cl')).status, 200);
});

test('no se puede dar de baja a sí mismo ni dejar el sistema sin administradores', async () => {
  const self = await http('POST', `/api/usuarios/${admin.id}/baja`, admin.token);
  assert.equal(self.status, 409);
  assert.equal(self.body.codigo, 'AUTO_BAJA');
  // Un único administrador activo: bajar o degradar a ese último es imposible, también si otro lo intentara.
  const solo = await http('PATCH', `/api/usuarios/${admin.id}/rol`, admin.token, { rol: 'BODEGA' });
  assert.equal(solo.status, 409);
  assert.equal(solo.body.codigo, 'ULTIMO_ADMINISTRADOR');

  // Con un segundo administrador (bodega promovido y restaurado al final): el primero puede darse de baja por él, y el segundo ya es el último.
  const id2 = await idDe('bodega@tiendaoregon.cl');
  await http('PATCH', `/api/usuarios/${id2}/rol`, admin.token, { rol: 'ADMINISTRADOR' });
  const t2 = (await login('bodega@tiendaoregon.cl')).body.token;
  try {
    assert.equal((await http('POST', `/api/usuarios/${admin.id}/baja`, t2)).status, 200);
    assert.equal((await http('POST', `/api/usuarios/${id2}/baja`, t2)).status, 409); // sí mismo
    assert.equal((await http('PATCH', `/api/usuarios/${id2}/rol`, t2, { rol: 'CHOFER' })).status, 409); // último admin
  } finally {
    await query(`UPDATE usuario SET activo = true WHERE id_usuario = $1`, [admin.id]);
    await query(`UPDATE usuario SET id_rol = (SELECT id_rol FROM rol WHERE nombre_rol = 'BODEGA') WHERE id_usuario = $1`, [id2]);
  }
  assert.equal((await http('GET', '/api/usuarios', admin.token)).status, 200);
});
