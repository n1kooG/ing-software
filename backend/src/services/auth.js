import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import * as repo from '../repositories/usuarios.js';
import { auditar } from '../audit.js';
import { registrarActividad } from '../session.js';
import { conTransaccion } from '../db.js';

const MSG_GENERICO = 'Usuario o contraseña incorrectos'; // anti-enumeración (PU-08)
const credencialesInvalidas = () => new AppError(401, MSG_GENERICO, 'CREDENCIALES_INVALIDAS');

// Políticas: bcrypt vía pgcrypto (PU-06/07), mensaje único (PU-08), bloqueo tras N intentos (M11),
// el rol sale siempre de la BD; cualquier rol enviado por el cliente se ignora (CU-01, PI-07).
export async function login(req, email, password) {
  // Todo en una transacción con la fila bloqueada: la decisión de bloqueo por intentos es atómica y la
  // auditoría se confirma o revierte junto con el cambio de contador. Se devuelve el resultado (no se lanza
  // dentro) para que el contador de fallos se confirme.
  const r = await conTransaccion(async (c) => {
    const u = await repo.buscarParaLogin(email, password, c, true);
    if (!u) {
      await auditar(req, { tabla: 'usuario', accion: 'LOGIN_FALLIDO', despues: { email: email.toLowerCase() } }, c);
      return { fallo: true, simular: true };
    }
    const fallo = (accion, despues) => auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion, despues }, c).then(() => ({ fallo: true }));
    if (!u.activo) return fallo('LOGIN_FALLIDO', { motivo: 'cuenta inactiva' });
    if (u.bloqueada) return fallo('CUENTA_BLOQUEADA', { hasta: u.bloqueado_hasta });
    if (!u.clave_ok) {
      const f = await repo.registrarFallo(u.id_usuario, config.maxIntentos, config.bloqueoMinutos, c);
      return fallo('LOGIN_FALLIDO', { intentos: f.intentos_fallidos, bloqueado_hasta: f.bloqueado_hasta });
    }
    await repo.registrarAcceso(u.id_usuario, c);
    await auditar(req, { idUsuario: u.id_usuario, tabla: 'usuario', accion: 'LOGIN' }, c);
    return { u };
  });

  if (r.simular) await repo.simularHash(password);
  if (r.fallo) throw credencialesInvalidas();
  const { u } = r;
  const token = jwt.sign({ sub: u.id_usuario }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  await registrarActividad(u.id_usuario);
  return { token, usuario: { id: u.id_usuario, nombre: u.nombre_completo, email: u.email, rol: u.rol, permisos: u.permisos } };
}
