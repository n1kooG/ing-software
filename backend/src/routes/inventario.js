import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/inventario.js';

const router = Router();

// GET /api/inventario/buscar?q=...  (HU06, CU-09). Respuesta SIN costos ni márgenes: sirve a Bodega.
router.get('/buscar', autenticar, requierePermiso('inventario:consultar', 'inventario:leer'), ah(async (req, res) => {
  res.json(await svc.buscar(String(req.query.q ?? '').trim()));
}));

export default router;
