import { describe, expect, it } from '@jest/globals';
import { esActivo, FILTRO_ESTADO_ACTIVO } from './estado-activo.util.js';

describe('esActivo', () => {
  it('acepta ACTIVO como lo guarda el FSM y Activo como lo guarda la base global', () => {
    expect(esActivo('ACTIVO')).toBe(true);
    expect(esActivo('Activo')).toBe(true);
    expect(esActivo(' activo ')).toBe(true);
  });

  it('rechaza cualquier otro estado y la ausencia de estado', () => {
    for (const estado of [
      'SUSPENDIDO',
      'Suspendido',
      'BAJA',
      'INACTIVO',
      '',
      null,
      undefined,
    ]) {
      expect(esActivo(estado)).toBe(false);
    }
  });
});

describe('FILTRO_ESTADO_ACTIVO', () => {
  it('compara contra ACTIVO sin distinguir mayusculas, para que Postgres encuentre las dos grafias', () => {
    expect(FILTRO_ESTADO_ACTIVO).toEqual({
      equals: 'ACTIVO',
      mode: 'insensitive',
    });
  });
});
