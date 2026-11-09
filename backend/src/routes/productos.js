import { Router } from 'express';
import { ah } from '../errors.js';
import { autenticar, requierePermiso } from '../middleware/auth.js';
import * as svc from '../services/productos.js';

const router = Router();

// GET /api/productos?q=&pagina=&limite=  (HU01, HU02, CU-03). Cuerpo = arreglo; el total va en X-Total-Count.
router.get('/', autenticar, requierePermiso('catalogo:leer'), ah(async (req, res) => {
  const { filas, total } = await svc.listar(req.usuario.permisos, req.query);
  res.set('X-Total-Count', String(total)).json(filas);
}));

router.get('/:sku', autenticar, requierePermiso('catalogo:leer'), ah(async (req, res) => {
  res.json(await svc.obtener(req.usuario.permisos, req.params.sku));
}));

router.post('/', autenticar, requierePermiso('catalogo:escribir'), ah(async (req, res) => {
  res.status(201).json(await svc.crear(req, req.body));
}));

// Edita datos y estado (ACTIVO/INACTIVO); el SKU es inmutable.
router.put('/:sku', autenticar, requierePermiso('catalogo:escribir'), ah(async (req, res) => {
  res.json(await svc.editar(req, req.params.sku, req.body));
}));

// Solo precio por canal: el margen lo calcula la BD (HU02).
router.put('/:sku/precios/:canal', autenticar, requierePermiso('precios:escribir'), ah(async (req, res) => {
  res.json(await svc.fijarPrecio(req, req.params.sku, req.params.canal, req.body));
}));

export default router;
