import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

/**
 * Tope del cuerpo JSON / urlencoded. Era 20 MB, resto del incremento 1, cuando
 * la foto de evidencia viajaba en base64 dentro del JSON. Hoy va por multipart
 * (ver `LIMITE_FOTO_BYTES`) y ningun DTO pasa de unos KB.
 */
export const LIMITE_CUERPO = '1mb';

/**
 * Las subidas usan `memoryStorage()`: el archivo entero queda en la RAM del
 * proceso. Sin tope, uno de cualquier tamano se cargaba completo.
 *
 * Foto: 10 MB es tambien el maximo por imagen del plan gratuito de Cloudinary;
 * una foto de celular comun pesa entre 2 y 6 MB.
 */
export const LIMITE_FOTO_BYTES = 10 * 1024 * 1024;

/** KML: el de la red completa de Tomodat pesaba 740 KB (13-11-2026). */
export const LIMITE_KML_BYTES = 20 * 1024 * 1024;

/**
 * Parsers del cuerpo con su tope. Vive aca y no en `main.ts` para que las
 * pruebas e2e armen la app igual que produccion.
 */
export function configurarCuerpo(app: INestApplication) {
  app.use(json({ limit: LIMITE_CUERPO }));
  app.use(urlencoded({ extended: true, limit: LIMITE_CUERPO }));
}
