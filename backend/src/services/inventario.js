import * as repo from '../repositories/inventario.js';

// Los comodines de LIKE se escapan: «%» o «_» escritos por el operario se buscan literalmente.
export const buscar = (q) => (q.length < 2 ? [] : repo.buscar(q.slice(0, 40).replace(/[\\%_]/g, '\\$&')));
