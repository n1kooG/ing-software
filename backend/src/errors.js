// Error de dominio con estado HTTP y código estable para el frontend.
export class AppError extends Error {
  constructor(status, mensaje, codigo = null) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

// Express 4 no captura promesas rechazadas en handlers async: este wrapper las lleva al manejador central.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
