import { createHash, privateDecrypt, constants } from 'node:crypto';

/**
 * RSA-OAEP con SHA-256, lo acordado con G2 (su documento del 30-09, §3.1).
 *
 * La llave privada vive en `WIFI_LLAVE_PRIVADA_PEM` y no se versiona. Sin ella
 * el endpoint responde 503: es preferible a aceptar solicitudes que despues no
 * vamos a poder descifrar, que le dejaria al cliente la impresion de que su
 * cambio de clave quedo encolado cuando en realidad se perdio.
 */
export const RELLENO_OAEP = {
  padding: constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: 'sha256',
} as const;

/** Huella del contenido, para distinguir un reintento de un cambio. */
export function huellaSolicitud(campos: {
  ciphertext: string;
  id_ticket: string;
  id_contrato: number;
  id_empresa: number;
}): string {
  // Orden fijo y separador que no aparece en los valores: dos payloads
  // distintos no pueden producir la misma huella por concatenacion.
  const canon = [
    campos.ciphertext,
    campos.id_ticket,
    String(campos.id_contrato),
    String(campos.id_empresa),
  ].join('\u0000');
  return createHash('sha256').update(canon, 'utf8').digest('hex');
}

/**
 * Descifra el ciphertext de G2. Devuelve `null` si no se puede descifrar.
 *
 * Se usa en dos momentos y por dos razones distintas: al recibir, para validar
 * que lo que llego es descifrable y rechazarlo en el acto si no lo es --el
 * claro se descarta ahi mismo--, y cuando el tecnico abre la solicitud, que es
 * la unica vez que el claro sale de esta funcion.
 */
export function descifrarClave(
  ciphertextBase64: string,
  pemPrivada: string,
): string | null {
  try {
    const bytes = Buffer.from(ciphertextBase64, 'base64');
    if (bytes.length === 0) return null;
    const claro = privateDecrypt({ key: pemPrivada, ...RELLENO_OAEP }, bytes);
    const texto = claro.toString('utf8');
    // Una clave WiFi vacia no es una clave: si el descifrado da vacio, algo
    // salio mal aunque el padding haya calzado.
    return texto.length > 0 ? texto : null;
  } catch {
    // A proposito no se propaga el detalle: el motivo exacto por el que un
    // descifrado RSA falla es informacion util para quien este probando claves.
    return null;
  }
}
