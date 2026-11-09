import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { buscarActivoPorId } from '../repositories/usuarios.js';
import { sesionInactiva, registrarActividad } from '../session.js';
import { auditar } from '../audit.js';
import { ah } from '../errors.js';
import { filtrarCostos } from './costos.js';

// 1) Valida firma y vencimiento del JWT (solo lleva `sub`) y la inactividad en CADA petición; renueva la actividad.
// 2) El rol y los permisos se leen de la base de datos (no del token): si el Administrador cambia
//    un rol o desactiva una cuenta, el efecto es inmediato (M10).
export const autenticar = ah(async (req, res, next) => {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado', codigo: 'NO_AUTENTICADO' });
  let sub;
  try {
    ({ sub } = jwt.verify(token, config.jwtSecret));
  } catch (e) {
    const expirado = e.name === 'TokenExpiredError';
    return res.status(401).json({ error: expirado ? 'Sesión expirada' : 'Sesión inválida', codigo: expirado ? 'SESION_EXPIRADA' : 'SESION_INVALIDA' });
  }
  // Inactividad: un token vigente pero sin actividad reciente se rechaza y NO renueva la actividad.
  if (await sesionInactiva(sub)) {
    return res.status(401).json({ error: 'Sesión expirada por inactividad', codigo: 'SESION_EXPIRADA' });
  }
  const usuario = await buscarActivoPorId(sub);
  if (!usuario) return res.status(401).json({ error: 'Sesión inválida', codigo: 'SESION_INVALIDA' });
  await registrarActividad(sub);
  req.usuario = usuario;
  filtrarCostos(req, res);
  next();
});

// Denegación por defecto (M3): basta con tener AL MENOS uno de los permisos indicados.
export const requierePermiso = (...permisos) => ah(async (req, res, next) => {
  if (permisos.some((p) => req.usuario.permisos.includes(p))) return next();
  await auditar(req, {
    idUsuario: req.usuario.id_usuario,
    tabla: 'api',
    accion: 'ACCESO_DENEGADO',
    despues: { ruta: req.originalUrl, metodo: req.method, requiere: permisos },
  });
  res.status(403).json({ error: 'No tienes permiso para esta operación', codigo: 'ACCESO_DENEGADO' });
});

export const tiene = (req, permiso) => req.usuario.permisos.includes(permiso);
