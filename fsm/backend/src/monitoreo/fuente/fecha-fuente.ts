import { instanteDesdePared, ZONA_OPERACION } from '../../common/utils/dia-habil.util.js';

/**
 * "2026-11-13 10:28:24.756123": fecha y hora de pared, sin zona. SmartOLT manda
 * MICROSEGUNDOS (6 decimales): se aceptan los decimales que vengan y se recortan
 * a milisegundos. Con un tope de 3, las 883 fechas reales quedaban rechazadas.
 */
const PARED = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;
/** Termina en Z o en un offset (+00:00, -0300): la fecha ya dice su zona. */
const CON_ZONA = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

/**
 * Convierte una fecha de la fuente de monitoreo en un instante.
 *
 * SmartOLT (API y export CSV) manda las fechas como hora de pared de la zona de
 * la cuenta --Chile-- y SIN zona: "2026-11-13 10:28:24.756". `new Date()` las
 * lee en la zona del PROCESO, asi que el mismo dato daba instantes distintos
 * segun donde corriera el backend: en Railway (UTC) quedaba 3 h antes de lo
 * real. Medido el 13-11: el sondeo detectaba los cambios de estado 181-190 min
 * despues de la hora que decia SmartOLT, cuando tarda 1-10 min. Con eso el
 * umbral de desconexion (CU-52) no esperaba nada, porque toda caida parecia
 * tener ya 3 horas, y el historial de interrupciones mostraba las horas
 * corridas.
 *
 * Por eso la zona se fija aca y no se hereda del servidor. Si la fecha trae su
 * propia zona (Z u offset), se respeta.
 */
export function fechaDeFuente(v: string | null | undefined, zona: string = ZONA_OPERACION): Date | null {
  const s = v?.trim();
  if (!s) return null;

  if (CON_ZONA.test(s)) {
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d.getTime()) ? null : d;
  }

  const p = PARED.exec(s);
  if (!p) return null;
  const [y, mes, d, h, min, seg = '0', frac = '0'] = p.slice(1);
  const n = (x: string) => Number(x);
  if (n(mes) < 1 || n(mes) > 12 || n(d) < 1 || n(d) > 31 || n(h) > 23 || n(min) > 59 || n(seg) > 59) {
    return null;
  }
  // ".7" son 700 ms, no 7; ".756123" son 756 ms (se recorta, no se redondea).
  const ms = n(frac.slice(0, 3).padEnd(3, '0'));
  return instanteDesdePared(zona, n(y), n(mes), n(d), n(h), n(min), n(seg), ms);
}
