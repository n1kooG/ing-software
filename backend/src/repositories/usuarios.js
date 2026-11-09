import { query } from '../db.js';

// Datos de login + verificación de clave (bcrypt vía pgcrypto) en una sola consulta.
// Con `bloquear` (dentro de una transacción) toma FOR UPDATE de la fila: los intentos concurrentes de una misma
// cuenta se serializan y cada uno ve el contador/bloqueo ya actualizado por el anterior.
export async function buscarParaLogin(email, password, db = { query }, bloquear = false) {
  const { rows } = await db.query(
    `SELECT u.id_usuario, u.nombre_completo, u.email, u.activo, u.intentos_fallidos, u.bloqueado_hasta,
            r.nombre_rol AS rol, r.permisos,
            (u.password_hash = crypt($2, u.password_hash)) AS clave_ok,
            (u.bloqueado_hasta IS NOT NULL AND u.bloqueado_hasta > now()) AS bloqueada
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
      WHERE lower(u.email) = lower($1)${bloquear ? ' FOR UPDATE OF u' : ''}`,
    [email, password],
  );
  return rows[0];
}

export async function simularHash(password) {
  await query(`SELECT crypt($1, gen_salt('bf', 12))`, [password]); // iguala tiempos de respuesta
}

export async function registrarFallo(idUsuario, maxIntentos, bloqueoMinutos, db = { query }) {
  const { rows: [f] } = await db.query(
    `UPDATE usuario
        SET intentos_fallidos = intentos_fallidos + 1,
            bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= $2
                                   THEN now() + make_interval(mins => $3) ELSE bloqueado_hasta END
      WHERE id_usuario = $1
      RETURNING intentos_fallidos, bloqueado_hasta`,
    [idUsuario, maxIntentos, bloqueoMinutos],
  );
  return f;
}

export const registrarAcceso = (idUsuario, db = { query }) =>
  db.query(
    `UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id_usuario = $1`,
    [idUsuario],
  );

// El rol y los permisos se leen de la BD en cada petición (M10).
export async function buscarActivoPorId(id) {
  const { rows } = await query(
    `SELECT u.id_usuario, u.nombre_completo, u.email, r.nombre_rol AS rol, r.permisos
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.id_usuario = $1 AND u.activo`,
    [id],
  );
  return rows[0];
}

// ---- Administración de usuarios (T47). Nunca se selecciona password_hash. ----
const COLS = `u.id_usuario, u.rut, u.nombre_completo, u.email, r.nombre_rol AS rol, u.activo,
              (r.permisos ? 'costos:leer') AS acceso_costos`;

export async function listarUsuarios(db = { query }) {
  const { rows } = await db.query(`SELECT ${COLS} FROM usuario u JOIN rol r ON r.id_rol = u.id_rol ORDER BY u.nombre_completo, u.id_usuario`);
  return rows;
}

export async function buscarUsuario(id, db = { query }, bloquear = false) {
  const { rows } = await db.query(
    `SELECT ${COLS}, r.permisos ? 'usuarios:administrar' AS es_admin
       FROM usuario u JOIN rol r ON r.id_rol = u.id_rol WHERE u.id_usuario = $1${bloquear ? ' FOR UPDATE OF u' : ''}`,
    [id],
  );
  return rows[0];
}

// Bloquea las filas de administradores activos: dos bajas/cambios concurrentes no pueden dejar el sistema sin ninguno.
export async function bloquearAdminsActivos(db) {
  const { rows } = await db.query(
    `SELECT u.id_usuario FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
      WHERE u.activo AND r.permisos ? 'usuarios:administrar' ORDER BY u.id_usuario FOR UPDATE OF u`,
  );
  return rows.length;
}

export const rutValido = async (rut) => (await query(`SELECT fn_rut_valido($1) AS ok`, [rut])).rows[0].ok;

export async function idRol(nombre, db = { query }) {
  const { rows } = await db.query(`SELECT id_rol FROM rol WHERE nombre_rol = $1`, [nombre]);
  return rows[0]?.id_rol;
}

export async function insertarUsuario({ rut, nombre, email, password, idRolNuevo }, db) {
  const { rows } = await db.query(
    `INSERT INTO usuario (rut, nombre_completo, email, password_hash, id_rol)
     VALUES ($1, $2, $3, crypt($4, gen_salt('bf', 12)), $5) RETURNING id_usuario`,
    [rut, nombre, email, password, idRolNuevo],
  );
  return rows[0].id_usuario;
}

export const actualizarRol = (id, idRolNuevo, db) => db.query(`UPDATE usuario SET id_rol = $2 WHERE id_usuario = $1`, [id, idRolNuevo]);
export const actualizarActivo = (id, activo, db) => db.query(`UPDATE usuario SET activo = $2 WHERE id_usuario = $1`, [id, activo]);
