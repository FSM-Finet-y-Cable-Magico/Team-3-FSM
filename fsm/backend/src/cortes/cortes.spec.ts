import { describe, expect, it } from '@jest/globals';
import { ACCION_CORTE, ACCION_REACTIVACION, clasificarContrato, diaEnZona, esActivo, esSuspendido } from './cortes.js';

const SUSP = new Date('2026-11-13T00:00:00.000Z'); // DATE de Prisma: medianoche UTC
const corte = (iso: string) => ({ accion: ACCION_CORTE, fecha_hora: new Date(iso) });
const reactivacion = (iso: string) => ({ accion: ACCION_REACTIVACION, fecha_hora: new Date(iso) });

describe('estado del contrato', () => {
  it('reconoce suspendido y activo sin importar mayusculas ni espacios', () => {
    expect(esSuspendido('Suspendido')).toBe(true);
    expect(esSuspendido('  SUSPENDIDO ')).toBe(true);
    expect(esSuspendido('Activo')).toBe(false);
    expect(esActivo('activo')).toBe(true);
    expect(esActivo(' ACTIVO ')).toBe(true);
    expect(esActivo('Pendiente')).toBe(false);
    expect(esActivo(null)).toBe(false);
  });
});

describe('clasificarContrato', () => {
  it('suspendido sin registro: por cortar', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, null)).toBe('POR_CORTAR');
  });

  it('suspendido con un corte registrado ese mismo dia o despues: al dia', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, corte('2026-11-13T15:00:00Z'))).toBe('AL_DIA');
  });

  it('suspendido otra vez despues de un corte viejo: por cortar', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, corte('2026-10-01T15:00:00Z'))).toBe('POR_CORTAR');
  });

  it('un corte a las 23:30 de Chile del dia anterior sigue siendo anterior, aunque en UTC ya sea el dia 13', () => {
    // 2026-11-12 23:30 en Santiago (UTC-3) = 2026-11-13 02:30 UTC.
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, corte('2026-11-13T02:30:00Z'))).toBe('POR_CORTAR');
    expect(diaEnZona(new Date('2026-11-13T02:30:00Z'))).toBe('2026-11-12');
  });

  it('un corte de noche cuenta aunque G8 haya fechado la suspension en UTC (ya el dia siguiente)', () => {
    // 2026-11-13 22:30 en Santiago = 2026-11-14 01:30 UTC; G8 guardo fecha_suspension = 2026-11-14.
    const deNoche = { ...corte('2026-11-14T01:30:00Z'), fecha_suspension: '2026-11-14' };
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: new Date('2026-11-14T00:00:00Z') }, deNoche)).toBe('AL_DIA');
  });

  it('suspendido cuyo ultimo registro es una reactivacion: por cortar', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: SUSP }, reactivacion('2026-11-14T10:00:00Z'))).toBe('POR_CORTAR');
  });

  it('sin fecha de suspension, el ultimo corte cuenta como vigente', () => {
    expect(clasificarContrato({ estado: 'Suspendido', fecha_suspension: null }, corte('2026-01-01T10:00:00Z'))).toBe('AL_DIA');
  });

  it('activo con un corte como ultimo registro: por reactivar', () => {
    expect(clasificarContrato({ estado: 'Activo', fecha_suspension: null }, corte('2026-11-13T15:00:00Z'))).toBe('POR_REACTIVAR');
  });

  it('activo ya reactivado, o que nunca se corto: al dia', () => {
    expect(clasificarContrato({ estado: 'activo', fecha_suspension: null }, reactivacion('2026-11-14T10:00:00Z'))).toBe('AL_DIA');
    expect(clasificarContrato({ estado: 'ACTIVO', fecha_suspension: null }, null)).toBe('AL_DIA');
  });

  it('otro estado (baja, pendiente) con un corte: al dia, no se reactiva', () => {
    expect(clasificarContrato({ estado: 'Baja', fecha_suspension: null }, corte('2026-11-13T15:00:00Z'))).toBe('AL_DIA');
    expect(clasificarContrato({ estado: 'Pendiente', fecha_suspension: null }, corte('2026-11-13T15:00:00Z'))).toBe('AL_DIA');
  });
});
