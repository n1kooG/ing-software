import { Router } from 'express';
import multer from 'multer';
import { ah, AppError } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/despachos.js';

const router = Router();

// HU07: el Chofer ve su hoja de ruta (ruta:leer) y cierra entregas (entregas:registrar). El cierre admite JSON o multipart con `foto`.
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const conFoto = (req, res, next) => subida.single('foto')(req, res, (e) => {
  if (!e) return next();
  next(new AppError(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400, e.code === 'LIMIT_FILE_SIZE' ? 'La foto supera 5 MB' : 'Archivo inválido', 'ARCHIVO_INVALIDO'));
});

router.get('/mi-ruta', autenticar, requierePermiso('ruta:leer'), ah(async (req, res) => res.json(await svc.miRuta(req))));
router.patch('/:id(\\d+)', autenticar, requierePermiso('entregas:registrar'), conFoto, ah(async (req, res) => {
  res.json(await svc.cerrar(req, Number(req.params.id), req.body ?? {}, req.file ?? null));
}));

export default router;
