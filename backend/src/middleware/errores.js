import { AppError } from '../errors.js';

export const noEncontrado = (_req, res) => res.status(404).json({ error: 'Ruta no encontrada', codigo: 'NO_ENCONTRADO' });

// Formato uniforme { error, codigo }. Nada interno se filtra al cliente (OWASP A02/A10).
// eslint-disable-next-line no-unused-vars
export function manejadorErrores(err, _req, res, _next) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message, codigo: err.codigo, ...(err.detalle && { detalle: err.detalle }) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido', codigo: 'SOLICITUD_INVALIDA' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Cuerpo demasiado grande', codigo: 'SOLICITUD_INVALIDA' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor', codigo: 'ERROR_INTERNO' });
}
