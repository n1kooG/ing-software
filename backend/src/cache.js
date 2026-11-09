// Caché Redis (PR-04). Si Redis no está disponible el sistema sigue funcionando sin caché.
import { createClient } from 'redis';
import { config } from './config.js';

let client = null;

export async function iniciarCache() {
  if (!config.redisUrl) return;
  try {
    client = createClient({ url: config.redisUrl, socket: { reconnectStrategy: false } });
    client.on('error', () => {});
    await client.connect();
  } catch {
    client = null;
    console.warn('[cache] Redis no disponible: el sistema funcionará sin caché');
  }
}

export async function cerrarCache() {
  if (client) await client.quit().catch(() => {});
  client = null;
}

// 'ok' | 'caido' | 'desactivado'
export async function estadoCache() {
  if (!client) return config.redisUrl ? 'caido' : 'desactivado';
  try { await client.ping(); return 'ok'; } catch { return 'caido'; }
}

// Lectura/escritura cruda; devuelven undefined/false si Redis no responde para que el llamador use su respaldo.
export async function redisGet(clave) {
  if (!client) return undefined;
  try { return await client.get(clave); } catch { return undefined; }
}
export async function redisSet(clave, valor, ttlSegundos) {
  if (!client) return false;
  try { await client.set(clave, valor, { EX: ttlSegundos }); return true; } catch { return false; }
}

export async function conCache(clave, ttlSegundos, calcular) {
  const hit = await redisGet(clave);
  if (hit) return { data: JSON.parse(hit), cache: 'HIT' };
  const data = await calcular();
  const ok = await redisSet(clave, JSON.stringify(data), ttlSegundos);
  return { data, cache: ok ? 'MISS' : 'OFF' };
}
