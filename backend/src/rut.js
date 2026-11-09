// Normaliza un RUT a 12.345.678-5; devuelve null si no tiene forma de RUT. El dígito verificador lo valida fn_rut_valido en la BD.
export function formatearRut(valor) {
  const limpio = String(valor ?? '').replace(/[.\s-]/g, '').toUpperCase();
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return null;
  const cuerpo = limpio.slice(0, -1);
  return `${cuerpo.replace(/\B(?=(\d{3})+$)/g, '.')}-${limpio.slice(-1)}`;
}
