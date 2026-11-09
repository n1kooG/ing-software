// Almacenamiento S3 (T45): listo pero sin uso funcional. Con STORAGE_ENABLED=false no se crea cliente ni se llama a AWS.
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

let s3 = null;
const cliente = () => (s3 ??= new S3Client({ region: config.s3Region })); // credenciales: cadena estándar de AWS

export const almacenamientoActivo = () => config.storageEnabled && !!config.s3Bucket;

function exigirActivo() {
  if (!almacenamientoActivo()) throw new Error('Almacenamiento desactivado (STORAGE_ENABLED / S3_BUCKET)');
}

export async function subir(clave, cuerpo, contentType = 'application/octet-stream') {
  exigirActivo();
  await cliente().send(new PutObjectCommand({ Bucket: config.s3Bucket, Key: clave, Body: cuerpo, ContentType: contentType }));
  return clave;
}

export async function urlFirmada(clave, segundos = 300) {
  exigirActivo();
  return getSignedUrl(cliente(), new GetObjectCommand({ Bucket: config.s3Bucket, Key: clave }), { expiresIn: segundos });
}

// 'ok' | 'desactivado' (no hace llamadas a AWS: solo informa configuración)
export const estadoAlmacenamiento = () => (almacenamientoActivo() ? 'ok' : 'desactivado');
