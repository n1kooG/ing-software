import { Router } from 'express';
import { ah } from '../errors.js';
import { query } from '../db.js';
import { estadoCache } from '../cache.js';
import { estadoAlmacenamiento } from '../storage.js';

const router = Router();

// Solo la BD es imprescindible; Redis y almacenamiento degradan sin tumbar el servicio.
router.get('/', ah(async (_req, res) => {
  const bd = await query('SELECT 1').then(() => 'ok', () => 'caido');
  const redis = await estadoCache();
  res.status(bd === 'ok' ? 200 : 503).json({ ok: bd === 'ok', bd, redis, almacenamiento: estadoAlmacenamiento() });
}));

export default router;
