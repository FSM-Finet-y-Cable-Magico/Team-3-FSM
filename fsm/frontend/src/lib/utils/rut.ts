/**
 * Formateo del RUT para mostrarlo en pantalla.
 *
 * El §11 del Documento 0 fija el almacenamiento sin puntos ni guion y el
 * formateo solo en la interfaz. Desde que el backend guarda en forma canonica,
 * `cliente.rut` llega como "123456785" y hay que darle forma al mostrarlo; las
 * filas antiguas todavia llegan como "12345678-5", asi que esto normaliza las
 * dos y deja una sola grafia a la vista.
 */
export function formatearRut(rut: string | null | undefined): string {
  if (!rut) return '';
  const limpio = rut.replace(/[^0-9kK]/g, '');
  // Fuera de rango no es un RUT: se devuelve tal cual en vez de inventarle
  // puntos, para que un dato raro se vea raro y no disfrazado de valido.
  if (limpio.length < 2 || limpio.length > 9) return rut;

  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toUpperCase();

  let formateado = '';
  let contador = 0;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    formateado = cuerpo[i] + formateado;
    contador++;
    if (contador === 3 && i > 0) {
      formateado = '.' + formateado;
      contador = 0;
    }
  }
  return `${formateado}-${dv}`;
}
