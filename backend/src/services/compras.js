import * as repo from '../repositories/compras.js';
import * as inventario from '../repositories/inventario.js';
import { rutValido } from '../repositories/usuarios.js';
import { conTransaccion } from '../db.js';
import { auditar } from '../audit.js';
import { AppError } from '../errors.js';
import { almacenamientoActivo, subir } from '../storage.js';
import { formatearRut } from '../rut.js';

const bad = (msg, status = 400, codigo = 'VALIDACION') => new AppError(status, msg, codigo);
const txt = (v, campo, max) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) throw bad(`El campo ${campo} es obligatorio`);
  if (t.length > max) throw bad(`El campo ${campo} admite máximo ${max} caracteres`);
  return t;
};
const duplicada = (n, rut) => bad(`La factura ${n} del proveedor ${rut} ya fue registrada`, 409, 'FACTURA_DUPLICADA');
const IVA = 19n; // %

// Montos en centavos enteros (BigInt): sin errores de punto flotante. IVA redondeado al peso (mitad hacia arriba).
export function calcularMontos(items) {
  const netoCent = items.reduce((s, i) => s + BigInt(i.cantidad) * BigInt(Math.round(i.precio * 100)), 0n);
  const ivaPesos = (netoCent * IVA + 5000n) / 10000n;
  const neto = Number(netoCent) / 100;
  const iva = Number(ivaPesos);
  return { neto, iva, total: Number((netoCent + ivaPesos * 100n)) / 100 };
}

function validarItems(items) {
  if (!Array.isArray(items) || !items.length) throw bad('La factura debe incluir al menos un ítem');
  if (items.length > 200) throw bad('Demasiados ítems en una factura (máximo 200)');
  const vistos = new Set();
  return items.map((it, n) => {
    const sku = String(it?.sku ?? '').replace(/\s+/g, '').toUpperCase();
    if (!sku) throw bad(`Ítem ${n + 1}: el SKU es obligatorio`);
    if (vistos.has(sku)) throw bad(`Ítem ${n + 1}: el SKU ${sku} está repetido en la factura`);
    vistos.add(sku);
    if (!Number.isInteger(it.cantidad) || it.cantidad <= 0) throw bad(`Ítem ${n + 1} (${sku}): la cantidad debe ser un entero mayor a 0`);
    const p = it.precio_unitario_neto;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || Math.abs(p * 100 - Math.round(p * 100)) > 1e-6) {
      throw bad(`Ítem ${n + 1} (${sku}): el precio unitario neto debe ser un número ≥ 0 con hasta 2 decimales`);
    }
    return { sku, cantidad: it.cantidad, precio: p };
  });
}

// `pdf` = { buffer, mimetype } opcional. S3 y BD no comparten transacción: el PDF se sube ANTES de abrirla; si la transacción
// falla queda a lo sumo un objeto huérfano con clave determinista (se sobrescribe al reintentar), nunca una recepción sin respaldo.
export async function registrar(req, body = {}, pdf = null) {
  const rutProveedor = formatearRut(body.rut_proveedor);
  if (!rutProveedor || !(await rutValido(rutProveedor))) throw bad('RUT de proveedor inválido (formato 12.345.678-5 y dígito verificador correcto)');
  const nombreProveedor = txt(body.razon_social, 'razon_social', 120);
  const numeroFactura = txt(String(body.numero_factura ?? ''), 'numero_factura', 20);
  const formaPago = txt(body.forma_pago, 'forma_pago', 30);
  const fecha = String(body.fecha_emision ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha) {
    throw bad('fecha_emision debe tener formato AAAA-MM-DD y ser una fecha real');
  }
  if (fecha > new Date().toISOString().slice(0, 10)) throw bad('fecha_emision no puede ser futura');
  const items = validarItems(body.items);

  const existentes = await repo.skusExistentes(items.map((i) => i.sku));
  const faltan = items.filter((i) => !existentes.has(i.sku)).map((i) => i.sku);
  if (faltan.length) throw bad(`SKU inexistente o inactivo: ${faltan.join(', ')}`, 422, 'SKU_INEXISTENTE');

  const { neto, iva, total } = calcularMontos(items);
  const unidades = items.reduce((s, i) => s + i.cantidad, 0);

  // Antes de tocar S3: un duplicado no debe sobrescribir el PDF de la factura original.
  if ((await repo.recepcionesPorFactura(numeroFactura, rutProveedor)).length) throw duplicada(numeroFactura, rutProveedor);

  let clavePdf = null;
  if (pdf) {
    if (pdf.mimetype !== 'application/pdf' || pdf.buffer.subarray(0, 5).toString() !== '%PDF-') throw bad('El archivo adjunto debe ser un PDF');
    if (almacenamientoActivo()) {
      clavePdf = `facturas/${rutProveedor}_${numeroFactura}.pdf`.replace(/[^\w./-]/g, '_');
      await subir(clavePdf, pdf.buffer, 'application/pdf');
    } // shortcut: con almacenamiento desactivado el PDF se omite sin error; url_pdf_factura queda NULL.
  }

  try {
    const id = await conTransaccion(async (c) => {
      const idRecepcion = await repo.insertarRecepcion(c, {
        idUsuario: req.usuario.id_usuario, numeroFactura, rutProveedor, nombreProveedor, fechaEmision: fecha, formaPago, clavePdf, neto, iva, total,
      });
      await repo.insertarDetalle(c, idRecepcion, items);
      for (const it of [...items].sort((a, b) => (a.sku < b.sku ? -1 : 1))) { // orden fijo: evita interbloqueos entre recepciones simultáneas
        if (!(await inventario.incrementarFisico(it.sku, it.cantidad, c))) throw bad(`SKU sin registro de inventario: ${it.sku}`, 422, 'SKU_INEXISTENTE');
      }
      await auditar(req, {
        idUsuario: req.usuario.id_usuario, tabla: 'recepcion_compra', accion: 'RECEPCIÓN',
        despues: { id_recepcion: idRecepcion, factura: numeroFactura, rut_proveedor: rutProveedor, proveedor: nombreProveedor, unidades, monto_total: total },
      }, c);
      return idRecepcion;
    });
    return { id_recepcion: id, numero_factura: numeroFactura, rut_proveedor: rutProveedor, unidades, monto_neto: neto, monto_iva: iva, monto_total: total, url_pdf_factura: clavePdf };
  } catch (e) {
    if (e.code === '23505') throw duplicada(numeroFactura, rutProveedor);
    throw e;
  }
}

// T49 (CU-11): Bodega confirma la descarga del camión contra el N° de factura con el conteo de bultos por SKU.
// No cambia stock (ya sumó al registrar la factura); registra quién y cuándo, y marca discrepancias. Sin precios ni costos.
export async function confirmarDescarga(req, body = {}) {
  const numero = txt(String(body.numero_factura ?? ''), 'numero_factura', 20);
  const rut = body.rut_proveedor ? formatearRut(body.rut_proveedor) : null;
  if (body.rut_proveedor && !rut) throw bad('RUT de proveedor inválido');
  const bultos = body.bultos;
  if (!Array.isArray(bultos) || !bultos.length) throw bad('Indica el conteo de bultos por SKU');
  const contado = new Map();
  for (const [n, b] of bultos.entries()) {
    const sku = String(b?.sku ?? '').replace(/\s+/g, '').toUpperCase();
    if (!sku) throw bad(`Bulto ${n + 1}: el SKU es obligatorio`);
    if (!Number.isInteger(b.cantidad) || b.cantidad < 0) throw bad(`Bulto ${n + 1} (${sku}): la cantidad debe ser un entero ≥ 0`);
    contado.set(sku, (contado.get(sku) ?? 0) + b.cantidad);
  }
  const recs = await repo.recepcionesPorFactura(numero, rut);
  if (!recs.length) throw bad(`No hay una factura ${numero} registrada`, 404, 'NO_ENCONTRADO');
  if (recs.length > 1) throw bad(`La factura ${numero} existe para más de un proveedor: indica rut_proveedor`, 409, 'FACTURA_AMBIGUA');
  const rec = recs[0];

  return conTransaccion(async (c) => {
    const esperado = await repo.detalleEsperado(rec.id_recepcion, c);
    const skus = new Set([...esperado.map((e) => e.sku), ...contado.keys()]);
    const exp = new Map(esperado.map((e) => [e.sku, e.cantidad]));
    const discrepancias = [...skus].sort().map((sku) => ({ sku, esperado: exp.get(sku) ?? 0, contado: contado.get(sku) ?? 0 }))
      .filter((d) => d.esperado !== d.contado);
    const estado = discrepancias.length ? 'CON_DISCREPANCIA' : 'CONFORME';
    await repo.marcarEstado(c, rec.id_recepcion, estado);
    await auditar(req, {
      idUsuario: req.usuario.id_usuario, tabla: 'recepcion_compra', accion: 'DESCARGA_CONFIRMADA',
      despues: { id_recepcion: rec.id_recepcion, factura: numero, estado, bultos: Object.fromEntries(contado), discrepancias },
    }, c);
    return { id_recepcion: rec.id_recepcion, numero_factura: numero, estado_documento: estado, discrepancias };
  });
}
