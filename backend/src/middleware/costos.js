// T03: red de seguridad. Si el rol no tiene `costos:leer` (BODEGA, CHOFER) se omiten de CUALQUIER respuesta JSON
// los campos de costo, margen y valorización, aunque un servicio nuevo los incluyera por descuido.
const SENSIBLE = /costo|margen|valorizacion/i;

export function sinCostos(valor) {
  if (Array.isArray(valor)) return valor.map(sinCostos);
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(Object.entries(valor).filter(([k]) => !SENSIBLE.test(k)).map(([k, v]) => [k, sinCostos(v)]));
  }
  return valor;
}

export function filtrarCostos(req, res) {
  if (req.usuario.permisos.includes('costos:leer')) return;
  const json = res.json.bind(res);
  res.json = (cuerpo) => json(sinCostos(cuerpo));
}
