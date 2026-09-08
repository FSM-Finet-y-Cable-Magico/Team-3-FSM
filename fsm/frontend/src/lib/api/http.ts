import { authStore } from '$lib/stores/auth.store';

/**
 * Envoltorio unico para hablar con el Controlador.
 *
 * Existe por dos motivos. El primero es que los ocho clientes de API tenian
 * cada uno su propia copia de la misma funcion, seis de ellas identicas hasta
 * en el texto del error.
 *
 * El segundo importa mas: ninguna trataba el 401. El token dura ocho horas, asi
 * que vencerse en medio de la jornada no es un caso raro sino algo que pasa
 * todos los dias. Cuando pasaba, cada pantalla mostraba "Error en la solicitud"
 * y el usuario quedaba mirando una vista vacia sin entender por que, porque la
 * unica verificacion de vencimiento --`authStore.checkAuth()`-- corre al montar
 * la aplicacion y no despues.
 */

/** Un 401 significa que la sesion ya no vale: se cierra y se vuelve al login. */
function sesionVencida(): never {
  authStore.logout();
  throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
}

/**
 * @param mensajePorDefecto Lo que se muestra si el Controlador no explica el
 *   error. Cada cliente pasa el suyo porque "no se pudo generar el archivo"
 *   ayuda mas que "error en la solicitud" cuando lo que fallo fue una descarga.
 */
export async function pedirJson<T>(
  token: string,
  url: string,
  init?: RequestInit,
  mensajePorDefecto = 'Error en la solicitud',
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

  if (res.status === 401) sesionVencida();

  if (res.status >= 400) {
    // El cuerpo puede no ser JSON (un 502 del proxy, por ejemplo), y en ese
    // caso no hay que romper con un error de parseo encima del error real.
    const data = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(data.message || mensajePorDefecto);
  }

  return res.json() as Promise<T>;
}

/**
 * Igual que `pedirJson` pero devuelve la respuesta cruda, para lo que no es
 * JSON: subir una foto o descargar un reporte.
 */
export async function pedirCrudo(
  token: string,
  url: string,
  init?: RequestInit,
  mensajePorDefecto = 'Error en la solicitud',
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });

  if (res.status === 401) sesionVencida();

  if (res.status >= 400) {
    // Aunque se haya pedido un archivo, el error viene en JSON.
    const data = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(data.message || mensajePorDefecto);
  }

  return res;
}
