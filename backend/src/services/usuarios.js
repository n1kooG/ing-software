import { AppError } from '../errors.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import * as repo from '../repositories/usuarios.js';

const invalido = (m) => new AppError(400, m, 'SOLICITUD_INVALIDA');
const noExiste = () => new AppError(404, 'Usuario no encontrado', 'NO_ENCONTRADO');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const pub = ({ id_usuario, rut, nombre_completo, email, rol, activo, acceso_costos }) => ({ id_usuario, rut, nombre_completo, email, rol, activo, acceso_costos });
const estado = ({ rol, activo }) => ({ rol, activo }); // lo auditado: nunca claves

export const listar = () => repo.listarUsuarios();

export async function crear(req, { rut, nombre_completo, email, rol, password }) {
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');
  rut = txt(rut); nombre_completo = txt(nombre_completo); email = txt(email); rol = txt(rol);
  if (!rut || !nombre_completo || !email || !rol || typeof password !== 'string') throw invalido('Faltan datos: rut, nombre_completo, email, rol y password son obligatorios');
  if (nombre_completo.length > 120 || email.length > 120) throw invalido('Nombre o correo demasiado largo (máximo 120 caracteres)');
  if (!EMAIL.test(email)) throw invalido('Correo electrónico inválido');
  if (!(await repo.rutValido(rut))) throw invalido('RUT inválido (formato 12.345.678-5 y dígito verificador correcto)');
  if (password.length < 8 || password.length > 72) throw invalido('La contraseña inicial debe tener entre 8 y 72 caracteres');

  return conTransaccion(async (c) => {
    const idRolNuevo = await repo.idRol(rol, c);
    if (!idRolNuevo) throw invalido('Rol inexistente');
    let id;
    try {
      id = await repo.insertarUsuario({ rut, nombre: nombre_completo, email, password, idRolNuevo }, c);
    } catch (e) {
      if (e.code === '23505') throw new AppError(409, e.constraint?.includes('email') ? 'Ya existe un usuario con ese correo' : 'Ya existe un usuario con ese RUT', 'DUPLICADO');
      throw e;
    }
    const u = await repo.buscarUsuario(id, c);
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'usuario', accion: 'USUARIO_CREADO', despues: { id_usuario: id, rut, nombre_completo, email: email.toLowerCase(), ...estado(u) } }, c);
    return pub(u);
  });
}

// Bloquea administradores activos y el usuario objetivo; aplica `cambio` y audita en la misma transacción.
async function modificar(req, id, accion, validar, aplicar) {
  if (!Number.isInteger(id) || id < 1) throw noExiste();
  return conTransaccion(async (c) => {
    const admins = await repo.bloquearAdminsActivos(c);
    const antes = await repo.buscarUsuario(id, c, true);
    if (!antes) throw noExiste();
    const nuevo = await validar(antes, admins, c);
    if (!nuevo) return pub(antes); // sin cambios: no se audita
    await aplicar(nuevo, c);
    const despues = await repo.buscarUsuario(id, c);
    await auditar(req, { idUsuario: req.usuario.id_usuario, tabla: 'usuario', accion, antes: { id_usuario: id, ...estado(antes) }, despues: { id_usuario: id, ...estado(despues) } }, c);
    return pub(despues);
  });
}

const ULTIMO = () => new AppError(409, 'No se puede dejar el sistema sin administradores activos', 'ULTIMO_ADMINISTRADOR');

export const cambiarRol = (req, id, rol) =>
  modificar(req, id, 'ROL_CAMBIADO',
    async (u, admins, c) => {
      if (typeof rol !== 'string' || !rol.trim()) throw invalido('Debes indicar el rol');
      const nuevo = await repo.idRol(rol.trim(), c);
      if (!nuevo) throw invalido('Rol inexistente');
      if (rol.trim() === u.rol) return null;
      // Si el usuario hoy es administrador activo y el nuevo rol no administra, no puede ser el último.
      const { rows: [{ admin }] } = await c.query(`SELECT permisos ? 'usuarios:administrar' AS admin FROM rol WHERE id_rol = $1`, [nuevo]);
      if (u.activo && u.es_admin && !admin && admins <= 1) throw ULTIMO();
      return nuevo;
    },
    (nuevo, c) => repo.actualizarRol(id, nuevo, c));

export const darDeBaja = (req, id) =>
  modificar(req, id, 'USUARIO_BAJA',
    (u, admins) => {
      if (u.id_usuario === req.usuario.id_usuario) throw new AppError(409, 'No puedes darte de baja a ti mismo', 'AUTO_BAJA');
      if (!u.activo) return null;
      if (u.es_admin && admins <= 1) throw ULTIMO();
      return true;
    },
    (_n, c) => repo.actualizarActivo(id, false, c));

export const reactivar = (req, id) =>
  modificar(req, id, 'USUARIO_REACTIVADO', (u) => (u.activo ? null : true), (_n, c) => repo.actualizarActivo(id, true, c));
