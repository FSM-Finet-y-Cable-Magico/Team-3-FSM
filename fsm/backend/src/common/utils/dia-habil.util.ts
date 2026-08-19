/**
 * Rango del dia habil de FiNet, en la zona horaria de la operacion.
 *
 * CU-11 habla del "dia actual" del tecnico. Ese dia es el de la empresa, no el
 * del dispositivo: un tecnico que cruza a Argentina o que tiene mal el reloj no
 * deberia ver otra jornada. Por eso la zona se fija aca y no viaja desde la
 * Vista.
 *
 * El offset NO puede ser un -4 fijo: Chile cambia a UTC-3 con el horario de
 * verano (septiembre a abril). Se deriva de `Intl.DateTimeFormat`, que usa la
 * base de datos de zonas horarias de ICU y por lo tanto sigue las reglas
 * vigentes sin que haya que mantenerlas a mano.
 */

export const ZONA_OPERACION = 'America/Santiago';

/**
 * Minutos que hay que sumarle a un instante UTC para obtener la hora de pared
 * en `zona`. Para Santiago en invierno da -240; en verano, -180.
 */
function offsetMinutos(zona: string, instante: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);

  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);

  // Algunas versiones de ICU devuelven la hora 24 en vez de 0 para medianoche.
  const comoUTC = Date.UTC(
    v('year'),
    v('month') - 1,
    v('day'),
    v('hour') % 24,
    v('minute'),
    v('second'),
  );

  // Se truncan los milisegundos del instante: `formatToParts` no los expone y
  // sin truncar el offset saldria con un resto que no es parte del huso.
  return (comoUTC - Math.floor(instante.getTime() / 1000) * 1000) / 60000;
}

/**
 * Instante UTC que corresponde a la medianoche de pared de `zona`.
 *
 * Se hace en dos pasadas a proposito: el offset se mide primero sobre una
 * aproximacion y despues sobre el instante ya corregido, porque en los dos dias
 * del año en que cambia el horario de verano ambos no coinciden y una sola
 * pasada deja el resultado corrido una hora.
 *
 * Caso borde del salto de primavera: en Chile el cambio es a las 24:00, asi que
 * la medianoche del domingo siguiente NO EXISTE —el reloj salta de 23:59:59 a
 * 01:00:00—. Ahi la segunda pasada devuelve un instante que cae dentro del
 * hueco y no reproduce la hora pedida. Se detecta comprobando que el candidato
 * efectivamente vuelva a dar la misma hora de pared; si no, se conserva el
 * primer intento, que es el instante inmediatamente posterior al salto y el
 * unico que sirve como frontera del dia.
 */
function instanteDesdePared(zona: string, y: number, m: number, d: number): Date {
  const pared = Date.UTC(y, m - 1, d);

  const offAprox = offsetMinutos(zona, new Date(pared));
  const primerIntento = new Date(pared - offAprox * 60000);

  const offReal = offsetMinutos(zona, primerIntento);
  if (offReal === offAprox) return primerIntento;

  const segundoIntento = new Date(pared - offReal * 60000);
  return offsetMinutos(zona, segundoIntento) === offReal ? segundoIntento : primerIntento;
}

/**
 * Rango `[inicio, fin)` del dia de `ahora` en `zona`, como instantes UTC listos
 * para comparar contra una columna de fecha.
 *
 * Es semiabierto por el extremo derecho a proposito: una OT completada a las
 * 23:59:59.999 entra, y la de las 00:00:00.000 del dia siguiente no, sin que
 * haya que restar un milisegundo a mano.
 */
export function rangoDiaOperacion(
  ahora: Date = new Date(),
  zona: string = ZONA_OPERACION,
): { desde: Date; hasta: Date } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ahora);

  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const y = v('year');
  const m = v('month');
  const d = v('day');

  const desde = instanteDesdePared(zona, y, m, d);
  // Se avanza el dia sobre la fecha de pared, no sumando 24 h al instante: en el
  // cambio de horario el dia local dura 23 o 25 horas.
  const siguiente = new Date(Date.UTC(y, m - 1, d + 1));
  const hasta = instanteDesdePared(
    zona,
    siguiente.getUTCFullYear(),
    siguiente.getUTCMonth() + 1,
    siguiente.getUTCDate(),
  );

  return { desde, hasta };
}
