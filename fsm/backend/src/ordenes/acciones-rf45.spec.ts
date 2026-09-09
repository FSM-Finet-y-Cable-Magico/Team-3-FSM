import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * RF-45: "la alerta permite reasignar la OT o marcarla como CRITICA
 * directamente desde el panel". Ninguna de las dos acciones existia.
 *
 * Reasignar no es asignar: `asignarTecnico` exige PENDIENTE porque es la
 * primera asignacion, y las OT del panel de detenidas ya tienen tecnico.
 */
describe('RF-45 · acciones del panel de OT detenidas', () => {
  let service: OrdenesService;
  const otFindFirst = jest.fn(async (_a: unknown) => null as any);
  const otUpdate = jest.fn(async (_a: unknown) => ({}) as any);
  const usuarioFindFirst = jest.fn(async (_a: unknown) => null as any);
  const historialCreate = jest.fn(async (_a: unknown) => ({}) as any);

  beforeEach(async () => {
    jest.clearAllMocks();
    const tx = {
      orden_trabajo: { update: otUpdate },
      historial_ot: { create: historialCreate },
    };
    const prisma = {
      orden_trabajo: { findFirst: otFindFirst, update: otUpdate },
      usuario: { findFirst: usuarioFindFirst },
      historial_ot: { create: historialCreate },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const mod = await Test.createTestingModule({
      providers: [
        OrdenesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ReparacionesRecurrentesService,
          useValue: { evaluar: jest.fn(async () => ({ activa: false, total_reparaciones_30_dias: 0, ots: [] })) },
        },
        {
          provide: SinReagendarService,
          useValue: { marcasDeEntrada: jest.fn(async () => new Map()), dias: () => 0 },
        },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: {} },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar: async () => {} } },
      ],
    }).compile();
    service = mod.get(OrdenesService);
  });

  describe('reasignar', () => {
    it('no toca el estado: reasignar no es una transicion', async () => {
      // Una EN_CURSO reasignada sigue EN_CURSO. Cambia quien la tiene, no en
      // que punto del flujo esta.
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, id_tecnico: 4, estado: 'EN_CURSO' });
      usuarioFindFirst.mockResolvedValue({ id_usuario: 8, nombre_completo: 'Ana Soto' });

      await service.reasignarTecnico(1, { id_tecnico: 8 }, 3, 1).catch(() => {});

      const data = (otUpdate.mock.calls[0][0] as any).data;
      expect(data).toEqual({ id_tecnico: 8 });
      expect(data.estado).toBeUndefined();
    });

    it('deja el cambio en el historial, que es lo que reinicia el reloj de 24 h', async () => {
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, id_tecnico: 4, estado: 'ASIGNADA' });
      usuarioFindFirst.mockResolvedValue({ id_usuario: 8, nombre_completo: 'Ana Soto' });

      await service.reasignarTecnico(1, { id_tecnico: 8 }, 3, 1).catch(() => {});

      expect((historialCreate.mock.calls[0][0] as any).data).toMatchObject({
        id_ot: 1,
        id_usuario: 3,
        observaciones: 'Reasignada a Ana Soto',
      });
    });

    it('rechaza los estados que el panel no muestra', async () => {
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, id_tecnico: 4, estado: 'COMPLETADA' });

      await expect(service.reasignarTecnico(1, { id_tecnico: 8 }, 3, 1)).rejects.toThrow(
        /ASIGNADA o EN_CURSO/,
      );
      expect(otUpdate).not.toHaveBeenCalled();
    });

    it('no acepta reasignar al mismo tecnico que ya la tiene', async () => {
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, id_tecnico: 8, estado: 'ASIGNADA' });

      await expect(service.reasignarTecnico(1, { id_tecnico: 8 }, 3, 1)).rejects.toThrow(
        /ya está asignada/,
      );
    });

    it('no acepta un tecnico de otra empresa', async () => {
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, id_tecnico: 4, estado: 'ASIGNADA' });
      usuarioFindFirst.mockResolvedValue(null);

      await expect(service.reasignarTecnico(1, { id_tecnico: 8 }, 3, 1)).rejects.toThrow(
        /Técnico no encontrado/,
      );
      expect((usuarioFindFirst.mock.calls[0][0] as any).where.id_empresa).toBe(1);
    });
  });

  describe('cambiar prioridad', () => {
    it('marca la OT como CRITICA y lo deja registrado', async () => {
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, estado: 'ASIGNADA', prioridad: 'MEDIA' });

      await service.cambiarPrioridad(1, { prioridad: 'CRITICA' }, 3, 1);

      expect((otUpdate.mock.calls[0][0] as any).data).toEqual({ prioridad: 'CRITICA' });
      expect((historialCreate.mock.calls[0][0] as any).data.observaciones).toBe(
        'Prioridad MEDIA → CRITICA',
      );
    });

    it('no escribe nada si la prioridad ya era esa', async () => {
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, estado: 'ASIGNADA', prioridad: 'CRITICA' });

      await service.cambiarPrioridad(1, { prioridad: 'CRITICA' }, 3, 1);

      expect(otUpdate).not.toHaveBeenCalled();
    });

    it('no deja cambiar la prioridad de una OT ya cerrada', async () => {
      otFindFirst.mockResolvedValue({ id_ot: 1, id_empresa: 1, estado: 'COMPLETADA', prioridad: 'ALTA' });

      await expect(service.cambiarPrioridad(1, { prioridad: 'CRITICA' }, 3, 1)).rejects.toThrow(
        /OT cerrada/,
      );
    });

    it('no alcanza OT de otra empresa', async () => {
      otFindFirst.mockResolvedValue(null);

      await expect(service.cambiarPrioridad(1, { prioridad: 'CRITICA' }, 3, 99)).rejects.toThrow(
        /no encontrada/i,
      );
      expect((otFindFirst.mock.calls[0][0] as any).where.id_empresa).toBe(99);
    });
  });
});
