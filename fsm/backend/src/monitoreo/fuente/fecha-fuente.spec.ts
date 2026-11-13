import { afterEach, describe, expect, it } from '@jest/globals';
import { fechaDeFuente } from './fecha-fuente.js';

/**
 * SmartOLT manda las fechas como hora de pared de Chile y sin zona
 * ("2026-11-13 10:28:24.756"). Leerlas en la zona del servidor las corria 3 h
 * en Railway (UTC): medido el 13-11, los cambios de estado se detectaban
 * 181-190 min despues de la hora que decia SmartOLT, cuando el sondeo tarda
 * 1-10 min. Con eso el umbral de desconexion (CU-52) no esperaba nada: toda
 * caida parecia tener ya 3 horas.
 */
describe('fechaDeFuente', () => {
  const tzOriginal = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tzOriginal;
  });

  it('lee la hora de pared de Santiago en verano (UTC-3)', () => {
    expect(fechaDeFuente('2026-11-13 10:28:24.756')).toEqual(new Date('2026-11-13T13:28:24.756Z'));
  });

  it('y en invierno (UTC-4)', () => {
    expect(fechaDeFuente('2026-07-15 10:00:00')).toEqual(new Date('2026-07-15T14:00:00.000Z'));
  });

  it('acepta la T entre fecha y hora, y la hora sin segundos', () => {
    expect(fechaDeFuente('2026-11-13T10:28')).toEqual(new Date('2026-11-13T13:28:00.000Z'));
  });

  it('respeta una zona explicita tal cual', () => {
    expect(fechaDeFuente('2026-11-13T10:00:00Z')).toEqual(new Date('2026-11-13T10:00:00.000Z'));
    expect(fechaDeFuente('2026-11-13 10:00:00+00:00')).toEqual(new Date('2026-11-13T10:00:00.000Z'));
    expect(fechaDeFuente('2026-11-13T10:00:00-05:00')).toEqual(new Date('2026-11-13T15:00:00.000Z'));
  });

  it('la zona se puede configurar', () => {
    expect(fechaDeFuente('2026-11-13 10:00:00', 'UTC')).toEqual(new Date('2026-11-13T10:00:00.000Z'));
  });

  it('da lo mismo en un servidor en UTC que en uno en Chile', () => {
    process.env.TZ = 'UTC';
    const enUtc = fechaDeFuente('2026-11-13 10:28:24');
    process.env.TZ = 'America/Santiago';
    const enChile = fechaDeFuente('2026-11-13 10:28:24');
    expect(enUtc).toEqual(enChile);
    expect(enUtc).toEqual(new Date('2026-11-13T13:28:24.000Z'));
  });

  it('lo que no es fecha queda en null', () => {
    for (const v of [undefined, null, '', '   ', 'no es fecha', '2026-13-45 99:99:99']) {
      expect(fechaDeFuente(v)).toBeNull();
    }
  });
});
