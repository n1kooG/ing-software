import * as repo from '../repositories/auditoria.js';

export const listar = (limiteCrudo) => repo.listar(Math.max(1, Math.min(Math.trunc(Number(limiteCrudo)) || 50, 200)));
