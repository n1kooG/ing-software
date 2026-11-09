import { Router } from 'express';
import multer from 'multer';
import { ah, AppError } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/compras.js';

const router = Router();
router.use(autenticar);
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const conPdf = (req, res, next) => subida.single('pdf')(req, res, (e) => next(e && new AppError(400, e.code === 'LIMIT_FILE_SIZE' ? 'El PDF supera 5 MB' : 'Archivo inválido', 'VALIDACION')));

// Acepta JSON, o multipart con el PDF en `pdf` y el resto en el campo `datos` (JSON).
function cuerpo(req) {
  if (!req.is('multipart/form-data')) return req.body ?? {};
  try { return JSON.parse(req.body?.datos ?? '{}'); } catch { throw new AppError(400, 'El campo datos no es JSON válido', 'VALIDACION'); }
}

// HU03 / T13–T15: factura + detalle + stock + auditoría en una sola transacción (solo ADMINISTRADOR).
router.post('/recepciones', requierePermiso('compras:recepcionar'), conPdf, ah(async (req, res) => {
  res.status(201).json(await svc.registrar(req, cuerpo(req), req.file ?? null));
}));

// T49 / CU-11: BODEGA confirma la descarga del camión (respuesta sin precios).
router.post('/descargas', requierePermiso('compras:confirmar_descarga'), ah(async (req, res) => {
  res.json(await svc.confirmarDescarga(req, req.body ?? {}));
}));

export default router;
