import { query } from './db.js';

// Bitácora inmutable (CU-07; el esquema bloquea UPDATE/DELETE/TRUNCATE).
// Sin `client`: escribe aparte y un fallo nunca tumba la petición.
// Con `client` (transacción abierta): el INSERT va en la misma transacción que la operación; si falla, se propaga
// para que la operación completa se revierta (la auditoría no puede quedar fuera ni a medias).
export async function auditar(req, { idUsuario = null, tabla, accion, antes = null, despues = null, geo = null }, client = null) {
  const sql = `INSERT INTO audit_log (id_usuario, tabla_afectada, accion, valores_anteriores, valores_nuevos, ip_origen, geolocalizacion)
               VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`;
  const params = [idUsuario, tabla, accion, antes, despues, ipDe(req), geo];
  if (client) return void (await client.query(sql, params));
  try {
    await query(sql, params);
  } catch (e) {
    console.error('[auditoria] no se pudo registrar:', e.message);
  }
}

export function ipDe(req) {
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}
