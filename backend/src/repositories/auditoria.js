import { query } from '../db.js';

export async function listar(limite) {
  const { rows } = await query(
    `SELECT a.id_log, a.fecha_hora, u.nombre_completo AS usuario, r.nombre_rol AS rol,
            a.accion, a.tabla_afectada AS modulo, host(a.ip_origen) AS ip_origen, a.valores_nuevos AS detalle
       FROM audit_log a
       LEFT JOIN usuario u ON u.id_usuario = a.id_usuario
       LEFT JOIN rol r ON r.id_rol = u.id_rol
      ORDER BY a.fecha_hora DESC, a.id_log DESC LIMIT $1`,
    [limite],
  );
  return rows;
}
