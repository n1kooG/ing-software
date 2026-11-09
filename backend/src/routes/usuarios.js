import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/usuarios.js';

const router = Router();
router.use(autenticar, requierePermiso('usuarios:administrar'));

const id = (req) => Number(req.params.id);

router.get('/', ah(async (_req, res) => res.json(await svc.listar())));
router.post('/', ah(async (req, res) => res.status(201).json(await svc.crear(req, req.body ?? {}))));
router.patch('/:id/rol', ah(async (req, res) => res.json(await svc.cambiarRol(req, id(req), req.body?.rol))));
router.post('/:id/baja', ah(async (req, res) => res.json(await svc.darDeBaja(req, id(req)))));
router.post('/:id/reactivar', ah(async (req, res) => res.json(await svc.reactivar(req, id(req)))));
export default router;
