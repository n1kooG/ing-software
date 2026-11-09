import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/auditoria.js';

const router = Router();

// GET /api/auditoria?limite=50  (CU-07): Fecha, Usuario, Rol, Acción, Módulo, IP de origen.
router.get('/', autenticar, requierePermiso('auditoria:leer'), ah(async (req, res) => {
  res.json(await svc.listar(req.query.limite));
}));

export default router;
