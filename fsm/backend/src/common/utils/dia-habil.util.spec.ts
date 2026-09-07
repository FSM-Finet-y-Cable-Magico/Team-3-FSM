import { describe, expect, it } from '@jest/globals';
import { rangoDiaOperacion } from './dia-habil.util.js';

// El dashboard y la vista de terreno comparan estos instantes contra
// fecha_completada, que es un timestamp sin zona guardado en UTC. Si la frontera
// se calcula como hora de pared, la jornada queda corrida 3 o 4 horas y una OT
// cerrada a las 21:30 cae fuera del dia.
describe('rangoDiaOperacion', () => {
  it('arranca en la medianoche de Santiago, no en la de UTC', () => {
    // En horario de verano Chile esta en UTC-3: la medianoche local son las
    // 03:00 UTC del mismo dia.
    const { desde, hasta } = rangoDiaOperacion(new Date('2026-01-15T18:00:00Z'));

    expect(desde.toISOString()).toBe('2026-01-15T03:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-01-16T03:00:00.000Z');
  });

  it('sigue el cambio de horario en vez de asumir un offset fijo', () => {
    // En invierno Chile esta en UTC-4, asi que la frontera se corre una hora.
    const { desde } = rangoDiaOperacion(new Date('2026-06-15T18:00:00Z'));

    expect(desde.toISOString()).toBe('2026-06-15T04:00:00.000Z');
  });

  it('cubre una OT cerrada a las 21:30 hora chilena', () => {
    const ahora = new Date('2026-01-15T18:00:00Z');
    const { desde, hasta } = rangoDiaOperacion(ahora);
    // 21:30 del 15 en Santiago (UTC-3) son las 00:30 UTC del 16.
    const cierreTardio = new Date('2026-01-16T00:30:00.000Z');

    expect(cierreTardio >= desde && cierreTardio < hasta).toBe(true);
  });

  it('encadena con el dia siguiente sin hueco ni solape', () => {
    const { hasta } = rangoDiaOperacion(new Date('2026-01-15T18:00:00Z'));
    const siguiente = rangoDiaOperacion(new Date('2026-01-16T18:00:00Z'));

    // El rango es semiabierto: el `hasta` de un dia es exactamente el `desde`
    // del otro, asi que ninguna OT queda sin contar ni contada dos veces.
    expect(hasta.toISOString()).toBe(siguiente.desde.toISOString());
  });
});
