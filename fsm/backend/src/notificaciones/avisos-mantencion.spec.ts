import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AvisosMantencionService, MENSAJE_MENOS_DE_24H } from './avisos-mantencion.service.js';
import { NotificacionesController } from './notificaciones.controller.js';

/**
 * CU-50 / RF-44: aviso anticipado de mantencion. Al programar una OT con fecha
 * futura, el jefe tecnico programa el aviso a los clientes de la caja NAP en
 * intervencion, 24 horas antes. Un poller lo emite a esa hora.
 *
 * No hay proveedor de mensajeria contratado: el envio se registra SIMULADO,
 * igual que el resto de las notificaciones. Programar, la regla de 24 horas y
 * el registro son el alcance del equipo.
 */
describe('aviso anticipado de mantencion (CU-50)', () => {
  const ahora = new Date('2026-09-29T15:00:00.000Z');
  let ot: any;
  let filas: any[];
  const plantilla = { id_plantilla: 9, id_empresa: 1, tipo_evento: 'MANTENCION_PROGRAMADA', canal: 'SMS', activa: true,
    contenido_texto: 'Hola {{cliente}}, el {{fecha}} a las {{hora}} haremos una mantencion en {{caja}}.' };
  const clientesCaja = [
    { cliente_asociado: { id_cliente: 10, nombre_completo: 'Ana Soto', telefono: '+56911111111', email: null } },
    { cliente_asociado: { id_cliente: 11, nombre_completo: 'Luis Paz', telefono: null, email: null } },
  ];
  const createMany = jest.fn(async (a: any) => { filas.push(...a.data); return { count: a.data.length }; });
  const deleteMany = jest.fn(async (_a: any) => ({ count: 0 }));
  const historial = jest.fn(async (_a: any) => ({}));
  const updateMany = jest.fn(async (_a: any) => ({ count: 2 }));
  const findManyAvisos = jest.fn(async (_a: any): Promise<any[]> => []);
  let service: AvisosMantencionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    filas = [];
    ot = { id_ot: 70, id_empresa: 1, id_caja_nap: 5, id_cliente: null, estado: 'ASIGNADA', tipo_ot: 'PREVENTIVO',
      fecha_programada: new Date('2026-10-02T13:00:00.000Z'), caja_nap: { identificador_unico: 'NAP-B' } };
    const tx = { log_notificacion: { createMany, deleteMany, updateMany }, historial_ot: { create: historial } };
    const mod = await Test.createTestingModule({
      providers: [
        AvisosMantencionService,
        {
          provide: PrismaService,
          useValue: {
            orden_trabajo: { findFirst: jest.fn(async (a: any) => (a.where.id_ot === 70 && a.where.id_empresa === 1 ? ot : null)) },
            plantilla_notificacion: { findUnique: jest.fn(async () => plantilla) },
            puerto_nap: { findMany: jest.fn(async () => clientesCaja) },
            cliente: { findMany: jest.fn(async () => []) },
            log_notificacion: { findMany: findManyAvisos },
            $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
          },
        },
      ],
    }).compile();
    service = mod.get(AvisosMantencionService);
  });

  it('programa el aviso 24 h antes a los clientes de la caja, con el texto armado', async () => {
    const r = await service.programar(70, { id_plantilla: 9 }, 1, 3, ahora);

    expect(filas).toEqual([
      expect.objectContaining({
        id_cliente: 10, id_ot: 70, id_plantilla: 9, canal: 'SMS', estado_envio: 'PROGRAMADO',
        fecha_envio: new Date('2026-10-01T13:00:00.000Z'),
        mensaje_enviado: expect.stringMatching(/^Hola Ana Soto, el .* haremos una mantencion en NAP-B\.$/),
      }),
    ]);
    expect(r).toEqual({ id_ot: 70, estado: 'PROGRAMADO', envio_en: '2026-10-01T13:00:00.000Z', destinatarios: 1, sin_contacto: 1 });
    expect(historial.mock.calls[0][0].data).toMatchObject({ id_ot: 70, id_usuario: 3, observaciones: expect.stringContaining('Aviso de mantención programado') });
  });

  it('reprogramar reemplaza el aviso pendiente anterior, no lo duplica', async () => {
    await service.programar(70, { id_plantilla: 9 }, 1, 3, ahora);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id_ot: 70, estado_envio: 'PROGRAMADO' } });
  });

  it('con menos de 24 h avisa y solo envia de inmediato si se confirma (excepcion 1)', async () => {
    ot.fecha_programada = new Date('2026-09-30T01:00:00.000Z');
    await expect(service.programar(70, { id_plantilla: 9 }, 1, 3, ahora)).rejects.toThrow(MENSAJE_MENOS_DE_24H);
    expect(createMany).not.toHaveBeenCalled();

    const r = await service.programar(70, { id_plantilla: 9, inmediato: true }, 1, 3, ahora);
    expect(r.estado).toBe('SIMULADO');
    expect(filas[0]).toMatchObject({ estado_envio: 'SIMULADO', fecha_envio: ahora });
  });

  it('una OT sin fecha futura, o de otra empresa, o una plantilla de otro evento, no se programa', async () => {
    await expect(service.programar(70, { id_plantilla: 9 }, 2, 3, ahora)).rejects.toBeInstanceOf(NotFoundException);
    ot.fecha_programada = null;
    await expect(service.programar(70, { id_plantilla: 9 }, 1, 3, ahora)).rejects.toBeInstanceOf(BadRequestException);
    ot.fecha_programada = new Date('2026-10-02T13:00:00.000Z');
    plantilla.tipo_evento = 'CORTE_IMPREVISTO';
    await expect(service.programar(70, { id_plantilla: 9 }, 1, 3, ahora)).rejects.toBeInstanceOf(BadRequestException);
    plantilla.tipo_evento = 'MANTENCION_PROGRAMADA';
  });

  it('el poller emite lo que ya vencio y lo deja en el historial de la OT', async () => {
    findManyAvisos.mockResolvedValueOnce([{ id_ot: 70 }, { id_ot: 70 }, { id_ot: 71 }]);
    const n = await service.enviarVencidos(ahora);

    expect(findManyAvisos.mock.calls[0][0]).toMatchObject({
      where: { estado_envio: 'PROGRAMADO', fecha_envio: { lte: ahora } },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { estado_envio: 'PROGRAMADO', fecha_envio: { lte: ahora } },
      data: { estado_envio: 'SIMULADO', fecha_envio: ahora },
    });
    expect(historial).toHaveBeenCalledTimes(2);
    expect(historial.mock.calls[0][0].data).toMatchObject({ id_ot: 70, observaciones: 'Aviso de mantención enviado a 2 clientes (simulado)' });
    expect(n).toBe(3);
  });

  it('programar es de ADMIN y JEFE_TECNICO', () => {
    expect(Reflect.getMetadata('roles', NotificacionesController.prototype.programarAvisoMantencion)).toEqual(['ADMIN', 'JEFE_TECNICO']);
  });
});
