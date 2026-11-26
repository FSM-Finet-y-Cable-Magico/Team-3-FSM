import { describe, expect, it } from '@jest/globals';
import { problemaDeEquipo, type UnidadInventario } from './validar-equipos.js';

/**
 * Validacion de la serie al cerrar (punto 2 de lo que pidio Javier, G1): que
 * el tecnico se entere en el domicilio, y no despues de que G1 procese el
 * cierre, de que la serie que escribio no se puede instalar o retirar.
 *
 * Las reglas salen de `ORIGENES_VALIDOS_G1`, la maquina de estados de G1:
 *   - instalar: el equipo existe, es de la empresa, esta "Asignado a técnico"
 *     y asignado A ESTE tecnico;
 *   - retirar: si el equipo existe, tiene que estar "Asignado a técnico" o
 *     "Instalado en cliente". Si NO existe se deja pasar: un equipo que ya
 *     estaba en la casa puede ser anterior al inventario o tener la etiqueta
 *     gastada, y bloquear dejaria al tecnico sin poder cerrar (decision del
 *     8-nov-2026). G1 registra la discrepancia.
 */
describe('problemaDeEquipo', () => {
  const ctx = { id_empresa: 1, id_tecnico: 5 };
  const unidad = (extra: Partial<UnidadInventario> = {}): UnidadInventario => ({
    numero_serie: 'ONT-1',
    estado: 'Asignado a técnico',
    id_empresa: 1,
    id_tecnico_asignado: 5,
    ...extra,
  });
  const instalar = {
    numero_serie: 'ONT-1',
    accion: 'INSTALADO_EN_CLIENTE' as const,
  };
  const retirar = {
    numero_serie: 'ONT-1',
    accion: 'RETIRADO_PARA_DIAGNOSTICO' as const,
  };

  describe('instalar', () => {
    it('acepta un equipo asignado a este tecnico', () => {
      expect(problemaDeEquipo(instalar, unidad(), ctx)).toBeNull();
    });

    it('rechaza una serie que no esta en el inventario', () => {
      expect(problemaDeEquipo(instalar, undefined, ctx)).toBe(
        'El equipo ONT-1 no existe en el inventario de la empresa',
      );
    });

    it('rechaza un equipo de otra empresa como si no existiera', () => {
      expect(problemaDeEquipo(instalar, unidad({ id_empresa: 2 }), ctx)).toBe(
        'El equipo ONT-1 no existe en el inventario de la empresa',
      );
    });

    it('rechaza un equipo que no esta asignado a un tecnico, y dice donde esta', () => {
      expect(
        problemaDeEquipo(
          instalar,
          unidad({ estado: 'En bodega', id_tecnico_asignado: null }),
          ctx,
        ),
      ).toBe('El equipo ONT-1 no se puede instalar: está "En bodega"');
    });

    it('rechaza un equipo asignado a otro tecnico', () => {
      expect(
        problemaDeEquipo(instalar, unidad({ id_tecnico_asignado: 6 }), ctx),
      ).toBe('El equipo ONT-1 no está asignado a usted');
    });

    it('sin tecnico registrado deja pasar: NULL es "no hay informacion", no "es de otro"', () => {
      // `id_tecnico_asignado` la llena G1. En la base propia y en desarrollo
      // queda NULL en todas las filas; rechazar ahi bloquearia toda
      // instalacion. Se rechaza solo lo que el dato contradice.
      expect(
        problemaDeEquipo(instalar, unidad({ id_tecnico_asignado: null }), ctx),
      ).toBeNull();
    });
  });

  describe('retirar', () => {
    it('acepta un equipo instalado en el cliente', () => {
      expect(
        problemaDeEquipo(
          retirar,
          unidad({ estado: 'Instalado en cliente', id_tecnico_asignado: null }),
          ctx,
        ),
      ).toBeNull();
    });

    it('acepta un equipo que el tecnico lleva y no llego a instalar', () => {
      expect(problemaDeEquipo(retirar, unidad(), ctx)).toBeNull();
    });

    it('deja pasar una serie que no esta en el inventario', () => {
      expect(problemaDeEquipo(retirar, undefined, ctx)).toBeNull();
    });

    it('rechaza un equipo que esta en un estado desde el que G1 no admite el retiro', () => {
      expect(
        problemaDeEquipo(
          retirar,
          unidad({ estado: 'En bodega', id_tecnico_asignado: null }),
          ctx,
        ),
      ).toBe('El equipo ONT-1 no se puede retirar: está "En bodega"');
    });

    it('un equipo de otra empresa cuenta como desconocido: no revela que existe', () => {
      // Distinguir "es de otra empresa" de "no existe" le permitiria a un
      // tecnico de FiNet sondear el inventario de Cable Magico serie a serie.
      expect(problemaDeEquipo(retirar, unidad({ id_empresa: 2 }), ctx)).toBeNull();
    });
  });
});
