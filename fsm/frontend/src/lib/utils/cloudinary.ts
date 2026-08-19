/**
 * Construccion de URLs de entrega de Cloudinary con transformacion (M12 / RNF-09).
 *
 * Las evidencias las sube el tecnico desde el telefono y pesan tipicamente entre
 * 2 y 4 MB. Servir ese original para pintar una miniatura de 64 px sobre red
 * celular es el problema que corrige este modulo: pedimos a Cloudinary la
 * version ya redimensionada y recomprimida.
 *
 * El modelo `evidencia_foto` guarda unicamente la URL final (`secure_url`), no
 * el `public_id`. No hace falta: la transformacion es un segmento de la propia
 * URL de entrega, que el backend genera siempre con la forma canonica
 *
 *   https://res.cloudinary.com/<cloud>/image/upload/v<version>/<carpeta>/<public_id>.<ext>
 *
 * Insertamos justo despues de `/image/upload/` y dejamos el resto intacto.
 * Si la URL no tiene ese separador no es una URL de entrega de Cloudinary
 * -por ejemplo el data URI base64 que el backend devuelve cuando Cloudinary no
 * esta configurado- y se devuelve sin tocar.
 *
 * Los parametros viven aqui: cambiarlos en un solo lugar cambia todos los usos.
 */

const SEPARADOR_ENTREGA = '/image/upload/';

/** Formato y calidad negociados por Cloudinary segun el navegador que pide. */
const BASE = 'f_auto,q_auto';

export interface OpcionesImagen {
  /** Ancho solicitado en pixeles reales (no CSS). */
  ancho: number;
  /** Alto solicitado en pixeles reales. Si se omite, Cloudinary conserva la proporcion. */
  alto?: number;
  /** Modo de recorte. `fill` llena el cuadro recortando; `limit` solo reduce. */
  modo?: 'fill' | 'limit';
}

/**
 * Devuelve la URL de `origen` con la transformacion aplicada.
 * Ante cualquier URL que no sea de entrega de Cloudinary, devuelve `origen`.
 */
export function urlTransformada(origen: string, opciones: OpcionesImagen): string {
  if (!origen) return origen;

  const corte = origen.indexOf(SEPARADOR_ENTREGA);
  if (corte === -1) return origen;

  const partes = [BASE, `w_${opciones.ancho}`];
  if (opciones.alto !== undefined) partes.push(`h_${opciones.alto}`);
  partes.push(`c_${opciones.modo ?? 'fill'}`);

  const inicio = corte + SEPARADOR_ENTREGA.length;
  return `${origen.slice(0, inicio)}${partes.join(',')}/${origen.slice(inicio)}`;
}

/**
 * Miniatura cuadrada de evidencia del historial de fallas: el `<img>` mide
 * 64 px CSS, pedimos 128 para que se vea nitida en pantallas de densidad doble.
 */
export function urlMiniaturaEvidencia(origen: string): string {
  return urlTransformada(origen, { ancho: 128, alto: 128, modo: 'fill' });
}
