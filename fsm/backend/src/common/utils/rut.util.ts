export function validarRut(rut: string): boolean {
  const limpio = rut.replace(/[^0-9kK]/g, '');
  if (limpio.length < 2 || limpio.length > 9) return false;

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toLowerCase();

  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  const resto = 11 - (suma % 11);
  const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'k' : String(resto);

  return dv === dvEsperado;
}

/** Deja el RUT en digitos y digito verificador: sin puntos, guion ni espacios. */
export function limpiarRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

/**
 * Las grafias con que un mismo RUT puede estar guardado en `cliente.rut`.
 *
 * Esa columna es compartida con los otros grupos y cada uno la escribe a su
 * manera: en produccion hay mitad "12345678-5" y mitad "123456785", y la K
 * queda con la mayuscula que se tecleo al dar de alta. Comparar por igualdad
 * exacta encuentra solo una de las dos mitades, asi que las consultas comparan
 * contra todas las grafias posibles.
 *
 * A proposito no se normaliza el dato guardado: G2 (portal de clientes) y G8
 * (CRM) leen y escriben esa misma columna, y cambiarles la grafia por debajo
 * les romperia sus propias busquedas. La normalizacion va en la consulta.
 */
export function variantesRut(rut: string): string[] {
  const limpio = limpiarRut(rut);
  if (limpio.length < 2) return [];

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);

  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const grafias = [`${cuerpo}${dv}`, `${cuerpo}-${dv}`, `${conPuntos}-${dv}`];

  // La K va en las dos cajas porque `in` de Prisma no admite `mode:
  // 'insensitive'`; enumerarlas es lo que hace que funcione el 1 de cada 11
  // RUT que termina en K.
  if (dv === 'K') return grafias.flatMap((g) => [g, g.slice(0, -1) + 'k']);
  return grafias;
}

/**
 * Filtro de Prisma para buscar por RUT tolerando las dos grafias guardadas.
 *
 * Con un RUT completo compara contra todas las grafias. Con uno parcial busca
 * el fragmento tal cual, que es lo correcto: el cuerpo va sin puntuacion en
 * ambas grafias, asi que "1234567" encuentra igual a "12345678-5" que a
 * "123456785".
 *
 * Devuelve `undefined` cuando la entrada no tiene ningun digito, porque
 * entonces no es un RUT y no hay nada que filtrar. Importa en las busquedas
 * que comparten el termino con el nombre: sin esa salida, buscar "Ana" dejaria
 * `contains: ''`, que en Postgres calza con TODAS las filas, y buscar "Karla"
 * dejaria `contains: 'K'`, que calza con todo RUT terminado en K.
 */
export function filtroRut(
  entrada: string,
): { in: string[] } | { contains: string; mode: 'insensitive' } | undefined {
  const limpio = limpiarRut(entrada);
  if (!/\d/.test(limpio)) return undefined;
  if (limpio.length >= 8 && validarRut(limpio)) return { in: variantesRut(limpio) };
  return { contains: limpio, mode: 'insensitive' };
}

/**
 * El RUT en la grafia que fijan los contratos entre grupos: sin puntos, con
 * guion y la K en mayuscula (`12345678-5`).
 *
 * Hace falta porque las dos grafias no son intercambiables entre capas. El §11
 * del Documento 0 manda guardar sin guion y el §3 del acuerdo con G8 manda
 * enviarlo CON guion, asi que lo que sale por la API no puede ser el valor
 * crudo de la columna: desde que el alta guarda canonico, eso serian dos
 * formatos distintos segun cuando se creo el cliente.
 *
 * Devuelve el valor tal cual si no se puede interpretar, para que un dato raro
 * viaje visible en vez de disfrazado.
 */
export function rutParaApi(rut: string | null | undefined): string | null {
  if (!rut) return null;
  const limpio = limpiarRut(rut);
  if (limpio.length < 2 || limpio.length > 9) return rut;
  return `${limpio.slice(0, -1)}-${limpio.slice(-1)}`;
}
