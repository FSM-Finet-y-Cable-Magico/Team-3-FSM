/**
 * Devuelve la URL si se puede poner en un `href` sin riesgo; si no, null.
 *
 * Svelte escapa texto y atributos, pero no mira el esquema: un
 * `href="javascript:..."` se renderiza tal cual y se ejecuta al hacer clic, en
 * el origen de la Vista, que es donde vive la sesión. El Controlador ya rechaza
 * esas URLs al cerrar una OT (`FotoDto`), pero la Vista muestra lo que haya en
 * la base, y la base es compartida y guarda filas anteriores a esa validación.
 *
 * Solo `https:`. Tampoco hace falta `http:` en desarrollo: Cloudinary entrega
 * `secure_url` y, sin configurar, la subida responde 503 en vez de una URL.
 */
export function urlSegura(origen: string | null | undefined): string | null {
  if (!origen) return null;

  let url: URL;
  try { url = new URL(origen); } catch { return null; }

  return url.protocol === 'https:' ? url.href : null;
}
