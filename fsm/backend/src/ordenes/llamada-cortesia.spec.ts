import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { OrdenesController } from './ordenes.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * CU-31 / RF-27: llamada de cortesia post-OT. El jefe tecnico llama al
 * cliente despues de completada la OT y registra el resultado:
 *  - CONFORME cierra el ciclo;
 *  - NO_CONFORME genera una OT de REPARACION con prioridad ALTA para el mismo
 *    cliente y reactiva el ticket original, si lo habia;
 *  - SIN_RESPUESTA agenda otro intento a las 2 horas; al tercero queda
 *    "Conformidad no confirmada por falta de contacto".
 */
describe('llamada de cortesia (CU-31)', () => {
  const jefe = { userId: 3, id_empresa: 1, rol: 'JEFE_TECNICO' };
  let ot: Record<string, any>;
  let intentosPrevios: number;
  const upsert = jest.fn(async (_a: any) => ({}));
  const crearOt = jest.fn(async (a: any) => ({ id_ot: 777, ...a.data }));
  const otUpdate = jest.fn(async (_a: any) => ({}));
  const historial = jest.fn(async (_a: any) => ({}));
  const auditar = jest.fn(async (_a: any) => ({}));
  const ticketUpdate = jest.fn(async (_a: any) => ({}));
  const findMany = jest.fn(async (_a: any): Promise<any[]> => []);
  let service: OrdenesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    intentosPrevios = 0;
    ot = {
      id_ot: 40, id_empresa: 1, id_cliente: 10, id_direccion: 55, id_ticket: null, estado: 'COMPLETADA',
      tipo_ot: 'INSTALACION', llamada: null,
    };
    const mod = await Test.createTestingModule({
      providers: [
        OrdenesService,
        {
          provide: PrismaService,
          useValue: {
            orden_trabajo: {
              findFirst: jest.fn(async (a: any) => (a.where.id_ot === 40 && a.where.id_empresa === ot.id_empresa ? ot : null)),
              findMany,
            },
            log_auditoria: { count: jest.fn(async () => intentosPrevios) },
            $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
              fn({
                llamada_cortes: { upsert },
                orden_trabajo: { create: crearOt, update: otUpdate },
                historial_ot: { create: historial },
                log_auditoria: { create: auditar },
                ticket: { update: ticketUpdate },
              }),
            ),
          },
        },
        { provide: ReparacionesRecurrentesService, useValue: {} },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: { emitirActualizacion: jest.fn() } },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar: jest.fn() } },
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
      ],
    }).compile();
    service = mod.get(OrdenesService);
  });

  it('CONFORME registra la llamada y cierra el ciclo', async () => {
    const r = await service.registrarLlamadaCortesia(40, { resultado: 'CONFORME' }, jefe);

    expect(upsert).toHaveBeenCalledWith({
      where: { id_ot: 40 },
      create: { id_ot: 40, resultado: 'CONFORME', observaciones: null, fecha_llamada: expect.any(Date) },
      update: { resultado: 'CONFORME', observaciones: null, fecha_llamada: expect.any(Date) },
    });
    expect(crearOt).not.toHaveBeenCalled();
    expect(r).toMatchObject({ resultado: 'CONFORME', id_ot_reparacion: null });
    expect(auditar).toHaveBeenCalledWith({
      data: expect.objectContaining({ accion: 'LLAMADA_CORTESIA', id_entidad_afectada: 40, valor_nuevo: expect.objectContaining({ resultado: 'CONFORME' }) }),
    });
  });

  it('NO_CONFORME genera una reparacion ALTA para el mismo cliente, con el reclamo', async () => {
    const r = await service.registrarLlamadaCortesia(
      40,
      { resultado: 'NO_CONFORME', observaciones: 'Se corta el internet cada tarde' },
      jefe,
    );

    expect(crearOt.mock.calls[0][0].data).toMatchObject({
      id_empresa: 1,
      id_cliente: 10,
      id_direccion: 55,
      tipo_ot: 'REPARACION',
      prioridad: 'ALTA',
      estado: 'PENDIENTE',
      observaciones: 'Reclamo en la llamada de cortesía de la OT #40: Se corta el internet cada tarde',
    });
    expect(r).toMatchObject({ resultado: 'NO_CONFORME', id_ot_reparacion: 777 });
  });

  it('NO_CONFORME exige describir el problema', async () => {
    await expect(service.registrarLlamadaCortesia(40, { resultado: 'NO_CONFORME' }, jefe)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('NO_CONFORME reactiva el ticket original y lo pasa a la reparacion nueva', async () => {
    ot.id_ticket = 9;
    await service.registrarLlamadaCortesia(40, { resultado: 'NO_CONFORME', observaciones: 'Sigue lento' }, jefe);

    // id_ticket es UNIQUE en la OT: se suelta de la original antes de la nueva.
    expect(otUpdate).toHaveBeenCalledWith({ where: { id_ot: 40 }, data: { id_ticket: null } });
    expect(crearOt.mock.calls[0][0].data).toMatchObject({ id_ticket: 9 });
    expect(ticketUpdate).toHaveBeenCalledWith({
      where: { id_ticket: 9 },
      data: { estado: 'DERIVADO_OT', fecha_cierre: null, resuelto_remotamente: false },
    });
  });

  it('SIN_RESPUESTA agenda otro intento y al tercero queda sin contacto', async () => {
    const r1 = await service.registrarLlamadaCortesia(40, { resultado: 'SIN_RESPUESTA' }, jefe);
    expect(r1).toMatchObject({ resultado: 'SIN_RESPUESTA', intento: 1 });
    expect(upsert.mock.calls[0][0].create).toMatchObject({ resultado: 'SIN_RESPUESTA', observaciones: 'Sin respuesta (intento 1 de 3)' });

    ot.llamada = { resultado: 'SIN_RESPUESTA' };
    intentosPrevios = 2;
    const r3 = await service.registrarLlamadaCortesia(40, { resultado: 'SIN_RESPUESTA' }, jefe);
    expect(r3).toMatchObject({ resultado: 'SIN_CONTACTO', intento: 3 });
    expect(upsert.mock.calls[1][0].update).toMatchObject({
      resultado: 'SIN_CONTACTO',
      observaciones: 'Conformidad no confirmada por falta de contacto.',
    });
  });

  it('una llamada ya cerrada no se vuelve a registrar; una OT no completada tampoco', async () => {
    ot.llamada = { resultado: 'CONFORME' };
    await expect(service.registrarLlamadaCortesia(40, { resultado: 'CONFORME' }, jefe)).rejects.toBeInstanceOf(BadRequestException);
    ot.llamada = null;
    ot.estado = 'PENDIENTE_APROBACION';
    await expect(service.registrarLlamadaCortesia(40, { resultado: 'CONFORME' }, jefe)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.registrarLlamadaCortesia(40, { resultado: 'CONFORME' }, { ...jefe, id_empresa: 2 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('las pendientes son las completadas sin llamada o sin respuesta, con a quien llamar', async () => {
    const ahora = new Date('2026-09-29T15:00:00Z');
    findMany.mockResolvedValueOnce([
      {
        id_ot: 40, tipo_ot: 'INSTALACION', fecha_completada: new Date('2026-09-29T10:00:00Z'),
        cliente: { nombre_completo: 'Ana Soto', telefono: '+56911111111' }, solicitud_integracion: null,
        tecnico: { nombre_completo: 'Pedro' }, llamada: null,
      },
      {
        id_ot: 41, tipo_ot: 'INSTALACION', fecha_completada: new Date('2026-09-29T09:00:00Z'),
        cliente: null, solicitud_integracion: { nombre_completo: 'Juan Pérez', telefono: '+56922222222' },
        tecnico: null, llamada: { resultado: 'SIN_RESPUESTA', fecha_llamada: new Date('2026-09-29T14:00:00Z'), observaciones: 'Sin respuesta (intento 2 de 3)' },
      },
    ]);

    const r = await service.llamadasPendientes(1, ahora);

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      id_empresa: 1,
      estado: 'COMPLETADA',
      OR: [{ llamada: { is: null } }, { llamada: { resultado: 'SIN_RESPUESTA' } }],
    });
    expect(r).toEqual([
      expect.objectContaining({ id_ot: 40, contacto: { nombre: 'Ana Soto', telefono: '+56911111111' }, intentos: 0, proximo_intento: null, toca_llamar: true }),
      expect.objectContaining({
        id_ot: 41,
        contacto: { nombre: 'Juan Pérez', telefono: '+56922222222' },
        intentos: 2,
        proximo_intento: '2026-09-29T16:00:00.000Z',
        toca_llamar: false,
      }),
    ]);
  });

  it('es de ADMIN y JEFE_TECNICO', () => {
    expect(Reflect.getMetadata('roles', OrdenesController.prototype.registrarLlamadaCortesia)).toEqual(['ADMIN', 'JEFE_TECNICO']);
    expect(Reflect.getMetadata('roles', OrdenesController.prototype.llamadasPendientes)).toEqual(['ADMIN', 'JEFE_TECNICO']);
  });
});
