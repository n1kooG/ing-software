import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import authRouter from './routes/auth.js';
import productosRouter from './routes/productos.js';
import inventarioRouter from './routes/inventario.js';
import dashboardRouter from './routes/dashboard.js';
import comprasRouter from './routes/compras.js';
import pedidosRouter from './routes/pedidos.js';
import despachosRouter from './routes/despachos.js';
import auditoriaRouter from './routes/auditoria.js';
import usuariosRouter from './routes/usuarios.js';
import healthRouter from './routes/health.js';
import { manejadorErrores, noEncontrado } from './middleware/errores.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/productos', productosRouter);
  app.use('/api/inventario', inventarioRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/compras', comprasRouter);
  app.use('/api/pedidos', pedidosRouter);
  app.use('/api/despachos', despachosRouter);
  app.use('/api/auditoria', auditoriaRouter);
  app.use('/api/usuarios', usuariosRouter);

  app.use('/api', noEncontrado);
  app.use(manejadorErrores);
  return app;
}
