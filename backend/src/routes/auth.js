import { Router } from 'express';
import { AppError, ah } from '../errors.js';
import { autenticar } from '../middleware/auth.js';
import * as svc from '../services/auth.js';

const router = Router();

// POST /api/auth/login  { email, password }
router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new AppError(400, 'Debes ingresar usuario y contraseña', 'SOLICITUD_INVALIDA');
  }
  res.json(await svc.login(req, email.trim(), password));
}));

router.get('/me', autenticar, (req, res) => {
  const { id_usuario, nombre_completo, email, rol, permisos } = req.usuario;
  res.json({ id: id_usuario, nombre: nombre_completo, email, rol, permisos });
});

export default router;
