import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { OrdenesController } from './ordenes.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT, type MomentoFanOut } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * CU-56 / RF-51: modalidad de resolucion. PRESENCIAL exige fotos de
 * evidencia; REMOTA no, porque no hubo visita. La modalidad queda en el
 * historial de la OT y alimenta el indicador de resolucion remota.
 *
 * Dos actores, como dice el CU: el tecnico elige la modalidad al cerrar, y el
 * jefe tecnico puede resolver a distancia una OT sin que nadie vaya.
 */
describe('modalidad de resolucion (CU-56)', () => {
  const tecnico = { userId: 7, id_empresa: 1, rol: 'TECNICO' };
  const jefe = { userId: 3, id_empresa: 1, rol: 'JEFE_TECNICO' };
  let fila: Record<string, any>;
  const notificar = jest.fn(async (_p: unknown) => {});
  const historial = jest.fn(async (_a: any) => ({}));
  const auditar = jest.fn(async (_a: any) => ({}));
  const ticketUpdateMany = jest.fn(async (_a: any) => ({ count: 1 }));
  const tx = {
    evidencia_foto: { createMany: jest.fn(async () => ({})) },
    uso_material_ot: { createMany: jest.fn(async () => ({})) },
    llamada_cortes: { create: jest.fn(async () => ({})) },
    orden_trabajo: { update: jest.fn(async (a: any) => Object.assign(fila, a.data)) },
    historial_ot: { create: historial },
    log_auditoria: { create: auditar },
    ticket: { updateMany: ticketUpdateMany },
  };
  const prisma = {
    orden_trabajo: {
      findFirst: jest.fn(async (a: any) => (a.include ? { ...fila, materiales: [], fotos: [], historial: [] } : { ...fila })),
      findUnique: jest.fn(async () => ({
        ...fila,
        fecha_creacion: new Date('2026-09-29T12:00:00Z'),
        cliente: null, direccion: null, categoria_falla: null, materiales: [], fotos: [], llamada: null, solicitud_integracion: null,
      })),
    },
    tipo_equipo: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const construir = async (momento: MomentoFanOut = 'CIERRE') => {
    const mod = await Test.createTestingModule({
      providers: [
        OrdenesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReparacionesRecurrentesService, useValue: { evaluar: jest.fn() } },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: { emitirActualizacion: jest.fn() } },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar } },
        { provide: MOMENTO_FAN_OUT, useValue: momento },
      ],
    }).compile();
    return mod.get(OrdenesService);
  };
  const esperar = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    jest.clearAllMocks();
    fila = { id_ot: 40, id_empresa: 1, id_tecnico: 7, estado: 'EN_CURSO', tipo_ot: 'INSTALACION', id_ticket: null };
  });

  const cierre = (extra: Record<string, unknown> = {}) => ({
    fotos: [] as any[], materiales: [], potencia_optica_dbm: -21, resultado_llamada: 'CONFORME', ...extra,
  });

  describe('el tecnico cierra', () => {
    it('PRESENCIAL sin fotos no se puede cerrar', async () => {
      const service = await construir();
      await expect(service.cerrarOT(40, cierre(), tecnico)).rejects.toThrow('al menos una foto');
      expect(tx.orden_trabajo.update).not.toHaveBeenCalled();
    });

    it('REMOTA no exige fotos y la modalidad queda en el historial', async () => {
      const service = await construir();
      await service.cerrarOT(40, cierre({ resuelto_remotamente: true }), tecnico);
      expect(historial.mock.calls[0][0].data).toMatchObject({ observaciones: 'Modalidad de resolución: REMOTA' });
    });

    it('PRESENCIAL con fotos tambien la deja en el historial', async () => {
      const service = await construir();
      const foto = { url_cloudinary: 'https://res.cloudinary.com/x/y.jpg', formato: 'jpg', tamano_kb: 10 };
      await service.cerrarOT(40, cierre({ fotos: [foto] }), tecnico);
      expect(historial.mock.calls[0][0].data).toMatchObject({ observaciones: 'Modalidad de resolución: PRESENCIAL' });
    });
  });

  describe('el jefe tecnico resuelve a distancia', () => {
    it('la OT queda COMPLETADA y remota, sin fotos ni visita, y se avisa a G1 y G8', async () => {
      fila.estado = 'ASIGNADA';
      const service = await construir('APROBACION');
      await service.resolverRemoto(40, { observaciones: 'Se reconfiguró la ONT desde SmartOLT' }, jefe);

      expect(fila).toMatchObject({ estado: 'COMPLETADA', resuelto_remotamente: true });
      expect(fila.fecha_completada).toBeInstanceOf(Date);
      expect(historial.mock.calls[0][0].data).toMatchObject({
        id_usuario: 3,
        estado_anterior: 'ASIGNADA',
        estado_nuevo: 'COMPLETADA',
        observaciones: 'Modalidad de resolución: REMOTA. Se reconfiguró la ONT desde SmartOLT',
      });
      expect(auditar).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'RESOLVER_REMOTO_OT' }) });
      // Queda completada sin paso de aprobacion: la resolvio quien aprueba.
      await esperar();
      expect(notificar).toHaveBeenCalledTimes(1);
    });

    it('si venia de un ticket, lo resuelve como remoto', async () => {
      fila.id_ticket = 9;
      const service = await construir();
      await service.resolverRemoto(40, { observaciones: 'Se reconfiguró la ONT desde SmartOLT' }, jefe);
      expect(ticketUpdateMany).toHaveBeenCalledWith({
        where: { id_ticket: 9, estado: 'DERIVADO_OT' },
        data: { estado: 'RESUELTO', fecha_cierre: expect.any(Date), resuelto_remotamente: true },
      });
    });

    it('exige decir que se hizo', async () => {
      const service = await construir();
      await expect(service.resolverRemoto(40, { observaciones: '  ' }, jefe)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each(['COMPLETADA', 'CANCELADA', 'PENDIENTE_APROBACION'])('una OT %s no se resuelve a distancia', async (estado) => {
      fila.estado = estado;
      const service = await construir();
      await expect(service.resolverRemoto(40, { observaciones: 'Se reconfiguró la ONT' }, jefe)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('es de ADMIN y JEFE_TECNICO', () => {
      expect(Reflect.getMetadata('roles', OrdenesController.prototype.resolverRemoto)).toEqual(['ADMIN', 'JEFE_TECNICO']);
    });
  });
});
