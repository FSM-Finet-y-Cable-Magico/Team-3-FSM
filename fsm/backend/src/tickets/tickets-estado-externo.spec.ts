import { describe, expect, it } from '@jest/globals';
import {
  estadoCanonicoTicket,
  filtroEstadoTicket,
} from './tickets.constants.js';

/**
 * Tickets que otro grupo escribe DIRECTO en la tabla `ticket` de la base
 * global, con su propio vocabulario.
 *
 * En la base propia esto se arreglo una vez con la migracion
 * `20260930020000_normalizar_tickets_legado`. En la global no sirve: el FSM no
 * migra ahi (MIGRAR_AL_ARRANCAR=false) y G2 sigue escribiendo filas nuevas, por
 * ejemplo "Escalado" con codigo FIN-2026-000006 (visto el 09-11-2026). Por eso
 * la MISMA regla de esa migracion se aplica al leer, no una sola vez.
 */
describe('estadoCanonicoTicket', () => {
  const t = (
    estado: string,
    extra: { id_usuario_asignado?: number | null; tieneOt?: boolean } = {},
  ) =>
    estadoCanonicoTicket({
      estado,
      id_usuario_asignado: extra.id_usuario_asignado ?? null,
      tieneOt: extra.tieneOt ?? false,
    });

  it('el vocabulario propio pasa tal cual, sin importar la caja', () => {
    expect(t('ABIERTO')).toBe('ABIERTO');
    expect(t('Abierto')).toBe('ABIERTO');
    expect(t('en_progreso')).toBe('EN_PROGRESO');
    expect(t('DERIVADO_OT')).toBe('DERIVADO_OT');
    expect(t('Resuelto')).toBe('RESUELTO');
  });

  it('"Escalado" sin nadie asignado vuelve a la cola: ABIERTO', () => {
    expect(t('Escalado')).toBe('ABIERTO');
  });

  it('"Escalado" con alguien asignado lo está trabajando: EN_PROGRESO', () => {
    expect(t('Escalado', { id_usuario_asignado: 7 })).toBe('EN_PROGRESO');
  });

  it('"Escalado" con una OT ligada es DERIVADO_OT', () => {
    expect(t('ESCALADO', { id_usuario_asignado: 7, tieneOt: true })).toBe(
      'DERIVADO_OT',
    );
  });

  it('"Cerrado" es RESUELTO, el único terminal', () => {
    expect(t('Cerrado')).toBe('RESUELTO');
    expect(t('cerrado')).toBe('RESUELTO');
  });

  it('un estado que nadie definió no se inventa: null', () => {
    expect(t('Pendiente de respuesta')).toBeNull();
  });
});

describe('filtroEstadoTicket', () => {
  type Fila = {
    estado: string;
    id_usuario_asignado: number | null;
    orden_trabajo: object | null;
  };
  type Where = {
    OR?: Where[];
    estado?: { equals: string };
    id_usuario_asignado?: null | { not: null };
    orden_trabajo?: { is?: null; isNot?: null };
  };

  // Evalua el `where` como lo haria Postgres, solo con los operadores que usa
  // el filtro. Asi la prueba mira QUE filas salen, no la forma del objeto.
  const cumple = (w: Where, f: Fila): boolean => {
    if (w.OR) return w.OR.some((x) => cumple(x, f));
    if (
      w.estado &&
      f.estado.toUpperCase() !== String(w.estado.equals).toUpperCase()
    )
      return false;
    if ('id_usuario_asignado' in w) {
      const v = w.id_usuario_asignado;
      if (v === null && f.id_usuario_asignado !== null) return false;
      if (v && v.not === null && f.id_usuario_asignado === null) return false;
    }
    if (w.orden_trabajo?.is === null && f.orden_trabajo !== null) return false;
    if (w.orden_trabajo?.isNot === null && f.orden_trabajo === null)
      return false;
    return true;
  };

  const filas: Record<string, Fila> = {
    abierto: {
      estado: 'ABIERTO',
      id_usuario_asignado: null,
      orden_trabajo: null,
    },
    escaladoLibre: {
      estado: 'Escalado',
      id_usuario_asignado: null,
      orden_trabajo: null,
    },
    escaladoTomado: {
      estado: 'Escalado',
      id_usuario_asignado: 7,
      orden_trabajo: null,
    },
    escaladoConOt: {
      estado: 'Escalado',
      id_usuario_asignado: 7,
      orden_trabajo: { id_ot: 1 },
    },
    enProgreso: {
      estado: 'EN_PROGRESO',
      id_usuario_asignado: 7,
      orden_trabajo: null,
    },
    cerrado: {
      estado: 'Cerrado',
      id_usuario_asignado: null,
      orden_trabajo: null,
    },
    resuelto: {
      estado: 'RESUELTO',
      id_usuario_asignado: 7,
      orden_trabajo: null,
    },
  };
  const salen = (estado: string) =>
    Object.entries(filas)
      .filter(([, f]) => cumple(filtroEstadoTicket(estado), f))
      .map(([k]) => k);

  it('ABIERTO incluye el "Escalado" que nadie tomó', () => {
    expect(salen('ABIERTO')).toEqual(['abierto', 'escaladoLibre']);
  });

  it('EN_PROGRESO incluye el "Escalado" que ya tiene a alguien', () => {
    expect(salen('EN_PROGRESO')).toEqual(['escaladoTomado', 'enProgreso']);
  });

  it('DERIVADO_OT incluye el "Escalado" con OT', () => {
    expect(salen('DERIVADO_OT')).toEqual(['escaladoConOt']);
  });

  it('RESUELTO incluye "Cerrado"', () => {
    expect(salen('RESUELTO')).toEqual(['cerrado', 'resuelto']);
  });

  it('cada fila sale en exactamente un filtro', () => {
    const estados = ['ABIERTO', 'EN_PROGRESO', 'DERIVADO_OT', 'RESUELTO'];
    for (const f of Object.values(filas)) {
      expect(
        estados.filter((e) => cumple(filtroEstadoTicket(e), f)),
      ).toHaveLength(1);
    }
  });

  it('un estado fuera del vocabulario se busca literal, sin distinguir caja', () => {
    expect(cumple(filtroEstadoTicket('escalado'), filas.escaladoLibre)).toBe(
      true,
    );
  });
});
