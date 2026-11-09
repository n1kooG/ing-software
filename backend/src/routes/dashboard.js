import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/dashboard.js';

const router = Router();

// GET /api/dashboard/kpis  (CU-02, HU09)
router.get('/kpis', autenticar, requierePermiso('inventario:leer'), ah(async (_req, res) => {
  const { data, cache } = await svc.kpis();
  res.set('X-Cache', cache).json(data);
}));

export default router;
