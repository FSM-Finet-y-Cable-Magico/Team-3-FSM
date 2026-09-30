import { describe, expect, it } from '@jest/globals';
import {
  analizarInterrupciones,
  MINUTOS_INTERRUPCION_CORTA,
  MINUTOS_INTERRUPCION_LARGA,
} from './interrupciones.js';

/**
 * CU-14 / RF-12: historial de microdesconexiones de una ONT.
 *
 * `historial_conexion_ont` guarda cada CAMBIO de estado, no las interrupciones:
 * una caida es un paso de ONLINE a OFFLINE, LOS o POWER_FAIL, y termina cuando
 * la ONT vuelve a ONLINE. Aca se emparejan esos cambios y se calculan los
 * indicadores de patron que pide el CU.
 */
const t = (iso: string) => new Date(iso);
const desde = t('2026-09-01T00:00:00Z');
const hasta = t('2026-10-01T00:00:00Z');
const ev = (evento: string, iso: string) => ({ evento, timestamp: t(iso) });

describe('analizarInterrupciones', () => {
  it('sin cambios de estado no hay interrupciones', () => {
    const r = analizarInterrupciones({ previo: 'ONLINE', eventos: [], desde, hasta });
    expect(r.interrupciones).toEqual([]);
    expect(r.indicadores).toEqual({
      total: 0,
      cortas: 0,
      largas: 0,
      minutos_totales: 0,
      dias_con_varias_cortas: [],
      horario_recurrente: [],
    });
  });

  it('empareja la caida con la vuelta a ONLINE y calcula la duracion', () => {
    const r = analizarInterrupciones({
      previo: 'ONLINE',
      eventos: [ev('LOS', '2026-09-10T13:00:00Z'), ev('ONLINE', '2026-09-10T13:05:00Z')],
      desde,
      hasta,
    });
    expect(r.interrupciones).toEqual([
      {
        desde: t('2026-09-10T13:00:00Z'),
        hasta: t('2026-09-10T13:05:00Z'),
        estado: 'LOS',
        minutos: 5,
        en_curso: false,
        empezo_antes: false,
        indicio: expect.stringContaining('señal óptica'),
      },
    ]);
    expect(r.indicadores).toMatchObject({ total: 1, cortas: 1, largas: 0, minutos_totales: 5 });
  });

  it('una caida que ya venia de antes empieza en el inicio del periodo', () => {
    const r = analizarInterrupciones({
      previo: 'POWER_FAIL',
      eventos: [ev('ONLINE', '2026-09-01T00:20:00Z')],
      desde,
      hasta,
    });
    expect(r.interrupciones[0]).toMatchObject({ desde, minutos: 20, empezo_antes: true, estado: 'POWER_FAIL' });
    expect(r.interrupciones[0].indicio).toContain('energía');
  });

  it('una caida que sigue abierta se mide hasta el final del periodo', () => {
    const r = analizarInterrupciones({
      previo: 'ONLINE',
      eventos: [ev('OFFLINE', '2026-09-30T23:00:00Z')],
      desde,
      hasta,
    });
    expect(r.interrupciones[0]).toMatchObject({ hasta: null, en_curso: true, minutos: 60 });
  });

  it('cambiar de un estado caido a otro no parte la interrupcion', () => {
    const r = analizarInterrupciones({
      previo: 'ONLINE',
      eventos: [
        ev('LOS', '2026-09-10T13:00:00Z'),
        ev('POWER_FAIL', '2026-09-10T13:10:00Z'),
        ev('ONLINE', '2026-09-10T13:30:00Z'),
      ],
      desde,
      hasta,
    });
    expect(r.interrupciones).toHaveLength(1);
    expect(r.interrupciones[0].minutos).toBe(30);
  });

  it('DESCONOCIDO no es una caida: es no tener lectura', () => {
    const r = analizarInterrupciones({
      previo: 'ONLINE',
      eventos: [ev('DESCONOCIDO', '2026-09-10T13:00:00Z'), ev('ONLINE', '2026-09-10T15:00:00Z')],
      desde,
      hasta,
    });
    expect(r.interrupciones).toEqual([]);
  });

  it(`cuenta como larga la que pasa de ${MINUTOS_INTERRUPCION_LARGA} minutos`, () => {
    const r = analizarInterrupciones({
      previo: 'ONLINE',
      eventos: [ev('LOS', '2026-09-10T10:00:00Z'), ev('ONLINE', '2026-09-10T14:30:00Z')],
      desde,
      hasta,
    });
    expect(r.indicadores).toMatchObject({ largas: 1, cortas: 0 });
  });

  it(`marca los dias con varias cortas (hasta ${MINUTOS_INTERRUPCION_CORTA} min), en hora de Chile`, () => {
    // 01:00Z del 11 es todavia el 10 en Santiago (UTC-3).
    const r = analizarInterrupciones({
      previo: 'ONLINE',
      eventos: [
        ev('LOS', '2026-09-10T13:00:00Z'), ev('ONLINE', '2026-09-10T13:02:00Z'),
        ev('LOS', '2026-09-10T18:00:00Z'), ev('ONLINE', '2026-09-10T18:03:00Z'),
        ev('LOS', '2026-09-11T01:00:00Z'), ev('ONLINE', '2026-09-11T01:04:00Z'),
      ],
      desde,
      hasta,
    });
    expect(r.indicadores.dias_con_varias_cortas).toEqual([{ dia: '2026-09-10', cortas: 3 }]);
  });

  it('detecta cortes diarios a una hora similar', () => {
    // 06:10Z = 03:10 en Santiago, tres dias distintos.
    const eventos = ['10', '11', '13'].flatMap((d) => [
      ev('POWER_FAIL', `2026-09-${d}T06:10:00Z`),
      ev('ONLINE', `2026-09-${d}T06:20:00Z`),
    ]);
    const r = analizarInterrupciones({ previo: 'ONLINE', eventos, desde, hasta });
    expect(r.indicadores.horario_recurrente).toEqual([{ hora: 3, dias: 3 }]);
  });
});
