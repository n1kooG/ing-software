import { config } from '../config.js';
import { conCache } from '../cache.js';
import * as repo from '../repositories/dashboard.js';

// Caché Redis de 30 s para cumplir PR-04 (< 400 ms).
export async function kpis() {
  return conCache('kpis:dashboard', config.kpiTtl, async () => ({ ...(await repo.kpis()), generado: new Date().toISOString() }));
}
