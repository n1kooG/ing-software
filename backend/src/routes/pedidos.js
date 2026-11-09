import { Router } from 'express';
import { ah, AppError } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/pedidos.js';
import * as imp from '../services/importaciones.js';
import { plantilla } from '../excel.js';
import multer from 'multer';

const router = Router();

// GET /api/pedidos?estado=PENDIENTE_PREPARACION  (CU-06 supervisión / HU05 lista de picking)
router.get('/', autenticar, requierePermiso('pedidos:leer', 'pedidos:preparar'), ah(async (req, res) => {
  res.json(await svc.listar(req, { estado: req.query.estado && String(req.query.estado), canal: req.query.canal }));
}));

// HU04 / CU-05: importación masiva de ventas desde .xlsx (permiso pedidos:importar). Campos multipart: `archivo` (.xlsx) y `canal`.
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, f, cb) => (/\.xlsx$/i.test(f.originalname) ? cb(null, true) : cb(new AppError(400, 'Solo se aceptan archivos .xlsx', 'ARCHIVO_INVALIDO'))),
});
const conArchivo = (req, res, next) => subida.single('archivo')(req, res, (e) => {
  if (!e) return req.file ? next() : next(new AppError(400, 'Falta el archivo .xlsx (campo archivo)', 'ARCHIVO_INVALIDO'));
  next(e instanceof AppError ? e : new AppError(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400, e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 10 MB' : 'Archivo inválido', 'ARCHIVO_INVALIDO'));
});
const importar = requierePermiso('pedidos:importar');

router.get('/importaciones/plantilla', autenticar, importar, ah(async (_req, res) => {
  res.set('Content-Disposition', 'attachment; filename="plantilla_ventas.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await plantilla());
}));
router.post('/importaciones/simular', autenticar, importar, conArchivo, ah(async (req, res) => {
  res.json(await imp.simular(req.file.buffer, req.file.originalname, req.body?.canal));
}));
router.post('/importaciones', autenticar, importar, conArchivo, ah(async (req, res) => {
  res.status(201).json(await imp.importar(req, req.file.buffer, req.file.originalname, req.body?.canal));
}));

// HU05 / CU-10 (Bodega) y CU-06 (Administrador). `:id` numérico para no chocar con /importaciones/*.
const id = (req) => Number(req.params.id);
const ver = requierePermiso('pedidos:leer', 'pedidos:preparar');
const preparar = requierePermiso('pedidos:preparar');
router.get('/:id(\\d+)', autenticar, ver, ah(async (req, res) => res.json(await svc.detalle(req, id(req)))));
router.patch('/:id(\\d+)/estado', autenticar, preparar, ah(async (req, res) => res.json(await svc.cambiarEstado(req, id(req), req.body?.estado))));
router.post('/:id(\\d+)/comentarios', autenticar, preparar, ah(async (req, res) => res.status(201).json(await svc.comentar(req, id(req), req.body ?? {}))));
router.get('/:id(\\d+)/etiqueta', autenticar, preparar, ah(async (req, res) => {
  const { pdf, nombre } = await svc.etiqueta(req, id(req));
  res.set('Content-Disposition', `attachment; filename="${nombre.replace(/[^\w.-]/g, '_')}"`).type('application/pdf').send(pdf);
}));
router.post('/:id(\\d+)/asignar-chofer', autenticar, requierePermiso('pedidos:asignar_chofer'), ah(async (req, res) => res.json(await svc.asignarChofer(req, id(req), req.body?.id_chofer))));

export default router;
