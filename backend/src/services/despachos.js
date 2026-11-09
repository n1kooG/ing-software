import * as repo from '../repositories/despachos.js';
import * as pedidos from '../repositories/pedidos.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { almacenamientoActivo, subir } from '../storage.js';

const bad = (msg, status = 400, codigo = 'VALIDACION') => new AppError(status, msg, codigo);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const JPG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

export const miRuta = (req) => repo.miRuta(req.usuario.id_usuario);

// Coordenadas opcionales (PI-04): ambas o ninguna; se guardan como «lat,lon» con 6 decimales, formato que exige el CHECK de audit_log.
function geo(lat, lon) {
  if ((lat ?? '') === '' && (lon ?? '') === '') return null;
  const [la, lo] = [Number(lat), Number(lon)];
  if (lat === '' || lon === '' || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) throw bad('latitud y longitud deben ser coordenadas válidas');
  return `${la.toFixed(6)},${lo.toFixed(6)}`;
}

// `foto` = { buffer, mimetype } opcional. Como en compras, S3 y la BD no comparten transacción: la foto se sube antes de abrirla
// (clave determinista, se sobrescribe al reintentar); si la transacción falla a lo sumo queda un objeto huérfano.
export async function cerrar(req, id, body = {}, foto = null) {
  const estado = body.estado;
  if (!['ENTREGADO', 'RECHAZADO'].includes(estado)) throw bad('estado debe ser ENTREGADO o RECHAZADO');
  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
  if (estado === 'RECHAZADO' && !motivo) throw bad('El rechazo exige una causal (motivo)', 400, 'CAUSAL_OBLIGATORIA');
  if (motivo.length > 300) throw bad('El motivo admite máximo 300 caracteres');
  const coords = geo(body.latitud, body.longitud);
  if (foto) {
    const ok = foto.buffer.length > 4 && (foto.mimetype === 'image/jpeg' ? JPG : foto.mimetype === 'image/png' ? PNG : null)?.every((b, i) => foto.buffer[i] === b);
    if (!ok) throw bad('La evidencia debe ser una imagen JPG o PNG');
  }

  const d = await conTransaccion((c) => repo.bloquear(c, id));
  if (!d || d.id_usuario_chofer !== req.usuario.id_usuario) throw new AppError(404, 'Despacho no encontrado', 'NO_ENCONTRADO'); // no se revela el de otro chofer
  if (d.estado_entrega !== 'PENDIENTE') throw bad('La entrega ya fue cerrada', 409, 'YA_CERRADO');

  let clave = null;
  if (foto && almacenamientoActivo()) {
    clave = `evidencias/${id}.${EXT[foto.mimetype]}`;
    await subir(clave, foto.buffer, foto.mimetype);
  } // shortcut: con almacenamiento desactivado la foto se descarta sin error y url_evidencia_s3 queda NULL.

  return conTransaccion(async (c) => {
    const actual = await repo.bloquear(c, id);
    if (actual.estado_entrega !== 'PENDIENTE') throw bad('La entrega ya fue cerrada', 409, 'YA_CERRADO');
    await repo.cerrar(c, id, estado, motivo || null, clave);
    try {
      await pedidos.fijarEstado(c, actual.id_orden, estado); // trg_orden_transicion: solo desde EN_RUTA
    } catch (e) {
      if (e.code === '23514') throw bad(e.message, 409, 'TRANSICION_INVALIDA');
      throw e;
    }
    await auditar(req, {
      idUsuario: req.usuario.id_usuario, tabla: 'despacho', accion: 'ENTREGA', geo: coords,
      antes: { id_despacho: id, estado_entrega: 'PENDIENTE' },
      despues: { id_despacho: id, id_orden: actual.id_orden, estado_entrega: estado, motivo_rechazo: motivo || null, evidencia: clave },
    }, c);
    return { id_despacho: id, id_orden: actual.id_orden, estado_entrega: estado, evidencia: !!clave };
  });
}
