// Infraestructura Excel (HU04): lectura de la planilla de ventas y plantilla base descargable.
import ExcelJS from 'exceljs';
import { AppError } from './errors.js';

export const COLUMNAS = ['RUT CLIENTE', 'NOMBRE CLIENTE', 'SKU', 'NOMBRE PRODUCTO', 'CANTIDAD', 'PRECIO', 'MARCA'];
export const MAX_FILAS = 20000; // protege memoria; el objetivo de PR-02 son 5.000 líneas
const invalido = (m) => new AppError(400, m, 'ARCHIVO_INVALIDO');
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

// Valor primitivo de una celda (texto enriquecido, fórmula, hipervínculo).
function valor(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
  }
  return v;
}

// Devuelve [{ fila, rut, nombre, sku, producto, cantidad, precio, marca }] con los valores tal como vienen (sin validar su contenido).
export async function leerPlanilla(buffer) {
  if (buffer.length < 4 || buffer.subarray(0, 2).toString() !== 'PK') throw invalido('El archivo no es un .xlsx válido');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw invalido('El archivo no es un .xlsx válido'); }
  const hoja = wb.worksheets[0];
  if (!hoja) throw invalido('El libro no tiene hojas');
  const idx = {};
  hoja.getRow(1).eachCell((cel, n) => { idx[norm(valor(cel.value))] ??= n; });
  const faltan = COLUMNAS.filter((c) => !idx[c]);
  if (faltan.length) throw invalido(`Faltan columnas en la fila 1: ${faltan.join(', ')}`);
  if (hoja.rowCount - 1 > MAX_FILAS) throw invalido(`La planilla supera ${MAX_FILAS} filas`);
  const filas = [];
  for (let n = 2; n <= hoja.rowCount; n++) {
    const r = hoja.getRow(n);
    const g = (c) => valor(r.getCell(idx[c]).value);
    const fila = { fila: n, rut: g('RUT CLIENTE'), nombre: g('NOMBRE CLIENTE'), sku: g('SKU'), producto: g('NOMBRE PRODUCTO'), cantidad: g('CANTIDAD'), precio: g('PRECIO'), marca: g('MARCA') };
    if (Object.entries(fila).some(([k, v]) => k !== 'fila' && v !== null && v !== undefined && String(v).trim() !== '')) filas.push(fila);
  }
  if (!filas.length) throw invalido('La planilla no tiene filas de datos');
  return filas;
}

export async function plantilla() {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Ventas');
  hoja.addRow(COLUMNAS).font = { bold: true };
  hoja.columns.forEach((c) => { c.width = 20; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
