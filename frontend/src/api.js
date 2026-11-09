// Cliente HTTP mínimo. El token vive en sessionStorage (se borra al cerrar la pestaña).
const KEY = 'sgi_token';
export const token = {
  get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set: (t) => { try { sessionStorage.setItem(KEY, t); } catch { /* sin almacenamiento */ } },
  clear: () => { try { sessionStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } },
};

export class ApiError extends Error {
  constructor(status, message, codigo, detalle) { super(message); this.status = status; this.codigo = codigo; this.detalle = detalle; }
}

// Cualquier 401 fuera del login avisa a la sesión para que cierre y redirija.
let alNoAutorizado = () => {};
export const alPerderSesion = (fn) => { alNoAutorizado = fn; };

export async function api(ruta, { metodo = 'GET', cuerpo, publica = false, blob = false } = {}) {
  const t = token.get();
  let res;
  try {
    res = await fetch(`/api${ruta}`, {
      method: metodo,
      // FormData: el navegador fija el Content-Type multipart con su boundary.
      headers: { ...(!(cuerpo instanceof FormData) && { 'Content-Type': 'application/json' }), ...(t && { Authorization: `Bearer ${t}` }) },
      body: !cuerpo ? undefined : cuerpo instanceof FormData ? cuerpo : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.', 'SIN_RED');
  }
  const data = await (res.ok && blob ? res.blob() : res.json().catch(() => null));
  if (!res.ok) {
    if (res.status === 401 && !publica) alNoAutorizado(data?.codigo);
    const msg = data?.error ?? (res.status === 403 ? 'No tienes permiso para esta operación' : 'Error de comunicación con el servidor');
    throw new ApiError(res.status, msg, data?.codigo, data?.detalle);
  }
  return { data, total: Number(res.headers.get('X-Total-Count') ?? 0) };
}

export const mensajeError = (e) => (e instanceof ApiError ? e.message : 'Ocurrió un error inesperado');
