// Expiración por inactividad (T02). Última actividad por usuario: Redis (TTL = ventana) con mapa en memoria de respaldo
// si Redis no responde. Sin registro de actividad = sesión expirada (falla cerrado, p. ej. tras reiniciar el servidor sin Redis).
// shortcut: el mapa en memoria es por proceso y no se purga (una entrada por usuario); con varias instancias sin Redis cada una ve lo suyo.
import { config } from './config.js';
import { redisGet, redisSet } from './cache.js';

const memoria = new Map();
const clave = (id) => `sesion:${id}`;

export async function registrarActividad(idUsuario, ts = Date.now()) {
  memoria.set(idUsuario, ts);
  await redisSet(clave(idUsuario), String(ts), config.sessionIdleMinutes * 60);
}

export async function ultimaActividad(idUsuario) {
  const v = await redisGet(clave(idUsuario)); // undefined = Redis no disponible; null = clave inexistente
  if (v === undefined) return memoria.get(idUsuario) ?? null;
  return v === null ? null : Number(v);
}

export async function sesionInactiva(idUsuario) {
  const ts = await ultimaActividad(idUsuario);
  return ts === null || Date.now() - ts > config.sessionIdleMinutes * 60_000;
}
