import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService, MENSAJE_RUT_INVALIDO, MENSAJE_SIN_SERVICIO } from './tickets.service.js';
import { TicketsController } from './tickets.controller.js';

/**
 * Tickets de soporte: CU-29 (reportar), CU-30 (gestionar) y CU-32
 * (reclasificar). `model ticket` ya existia completo: el modulo no necesita
 * migracion.
 */

const categorias = [
  { id_categoria: 1, nombre: 'Sin internet', sla_horas: 4 },
  { id_categoria: 2, nombre: 'Internet lento', sla_horas: 24 },
  { id_categoria: 3, nombre: 'Otro', sla_horas: null },
];
const ahora = new Date('2026-09-29T15:00:00.000Z');
const jefe = { userId: 3, id_empresa: 1, rol: 'JEFE_TECNICO' };

describe('TicketsService', () => {
  let tickets: any[];
  let auditoria: any[];
  let siguienteId: number;
  let service: TicketsService;

  const conRelaciones = (t: any) => ({
    ...t,
    categoria: categorias.find((c) => c.id_categoria === t.id_categoria) ?? null,
    cliente: t.id_cliente ? { id_cliente: t.id_cliente, rut: '12345678-5', nombre_completo: 'Ana Soto', telefono: '+56911111111' } : null,
    usuario_asignado: t.id_usuario_asignado ? { id_usuario: t.id_usuario_asignado, nombre_completo: 'Jefe' } : null,
    orden_trabajo: null,
  });

  const prisma: any = {
    cliente: {
      findFirst: jest.fn(async (a: any) =>
        a.where.rut === '12345678-5' && a.where.id_empresa === 1
          ? { id_cliente: 10, estado: 'ACTIVO', nombre_completo: 'Ana Soto' }
          : a.where.rut === '11111111-1' && a.where.id_empresa === 1
            ? { id_cliente: 11, estado: 'SUSPENDIDO', nombre_completo: 'Luis Paz' }
            : null,
      ),
    },
    categoria_falla: {
      findUnique: jest.fn(async (a: any) => categorias.find((c) => c.id_categoria === a.where.id_categoria) ?? null),
    },
    usuario: {
      findFirst: jest.fn(async (a: any) => (a.where.id_usuario === 3 && a.where.id_empresa === 1 ? { id_usuario: 3 } : null)),
    },
    ticket: {
      findFirst: jest.fn(async (a: any) => {
        const t = tickets.find(
          (x) =>
            (a.where.id_ticket === undefined || x.id_ticket === a.where.id_ticket) &&
            (a.where.codigo_seguimiento === undefined || x.codigo_seguimiento === a.where.codigo_seguimiento) &&
            x.id_empresa === a.where.id_empresa,
        );
        return t ? conRelaciones(t) : null;
      }),
      findMany: jest.fn(async (a: any) =>
        tickets
          .filter((x) => x.id_empresa === a.where.id_empresa && (!a.where.estado || x.estado === a.where.estado))
          .map(conRelaciones),
      ),
      count: jest.fn(async (a: any) => tickets.filter((x) => x.id_empresa === a.where.id_empresa).length),
    },
    log_auditoria: {
      findMany: jest.fn(async () => auditoria),
    },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
      fn({
        ticket: {
          create: jest.fn(async (a: any) => {
            if (tickets.some((t) => t.codigo_seguimiento === a.data.codigo_seguimiento)) {
              throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
            }
            const t = { id_ticket: siguienteId++, fecha_creacion: ahora, fecha_cierre: null, resuelto_remotamente: false, id_usuario_asignado: null, ...a.data };
            tickets.push(t);
            return t;
          }),
          update: jest.fn(async (a: any) => {
            const t = tickets.find((x) => x.id_ticket === a.where.id_ticket);
            Object.assign(t, a.data);
            return t;
          }),
        },
        log_auditoria: { create: jest.fn(async (a: any) => auditoria.push(a.data)) },
      }),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tickets = [];
    auditoria = [];
    siguienteId = 1;
    const mod = await Test.createTestingModule({
      providers: [TicketsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(TicketsService);
  });

  const crear = (extra: Record<string, unknown> = {}) =>
    service.crear({ rut_cliente: '12345678-5', id_categoria: 1, descripcion: 'No hay luz en la ONT', origen: 'TELEFONO', ...extra } as any, jefe, ahora);

  describe('CU-29: crear', () => {
    it('crea el ticket ABIERTO con codigo, prioridad por SLA y vencimiento', async () => {
      const t = await crear();

      expect(t).toMatchObject({
        estado: 'ABIERTO',
        prioridad: 'CRITICA',
        origen: 'TELEFONO',
        id_cliente: 10,
        id_empresa: 1,
        sla_horas: 4,
        vence_en: '2026-09-29T19:00:00.000Z',
        sla_vencido: false,
      });
      expect(t.codigo_seguimiento).toMatch(/^TK-[A-Z2-9]{7}$/);
      expect(auditoria[0]).toMatchObject({ accion: 'CREAR_TICKET', entidad_afectada: 'ticket', id_usuario: 3 });
    });

    it('con un RUT invalido responde el mensaje del CU', async () => {
      await expect(crear({ rut_cliente: '12345678-9' })).rejects.toThrow(MENSAJE_RUT_INVALIDO);
    });

    it('sin servicio activo responde el mensaje del CU, tambien si el cliente esta suspendido', async () => {
      await expect(crear({ rut_cliente: '22222222-2' })).rejects.toThrow(MENSAJE_SIN_SERVICIO);
      await expect(crear({ rut_cliente: '11111111-1' })).rejects.toThrow(MENSAJE_SIN_SERVICIO);
    });

    it('una categoria que no existe es 400', async () => {
      await expect(crear({ id_categoria: 99 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('si el codigo choca, reintenta con otro', async () => {
      tickets.push({ id_ticket: 99, id_empresa: 2, codigo_seguimiento: 'TK-AAAAAAA' });
      const gen = jest.spyOn(service as any, 'nuevoCodigo').mockReturnValueOnce('TK-AAAAAAA').mockReturnValueOnce('TK-BBBBBBB');
      const t = await crear();
      expect(t.codigo_seguimiento).toBe('TK-BBBBBBB');
      gen.mockRestore();
    });
  });

  describe('CU-30: listar, ver y gestionar', () => {
    it('un ticket de otra empresa no existe para esta', async () => {
      await crear();
      await expect(service.obtener(1, 2, ahora)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.tomar(1, { ...jefe, id_empresa: 2 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('el listado pagina, filtra por empresa y marca el SLA vencido', async () => {
      await crear();
      const despues = new Date('2026-09-29T20:00:00.000Z');
      const r = await service.listar(1, { page: '1', limit: '20' }, despues);
      expect(r).toMatchObject({ total: 1, page: 1, limit: 20 });
      expect(r.data[0]).toMatchObject({ sla_vencido: true, horas_transcurridas: 5 });
      expect(prisma.ticket.findMany.mock.calls[0][0]).toMatchObject({ where: { id_empresa: 1 }, skip: 0, take: 20 });
    });

    it('un ticket resuelto no marca SLA vencido', async () => {
      await crear();
      await service.tomar(1, jefe);
      await service.resolver(1, { observacion: 'Se reinicio la ONT a distancia' }, jefe, ahora);
      const t = await service.obtener(1, 1, new Date('2026-10-05T00:00:00Z'));
      expect(t.sla_vencido).toBe(false);
    });

    it('tomar para resolver remotamente lo pasa a EN_PROGRESO y lo asigna a quien lo toma', async () => {
      await crear();
      const t = await service.tomar(1, jefe);
      expect(t).toMatchObject({ estado: 'EN_PROGRESO', id_usuario_asignado: 3 });
      expect(auditoria.at(-1)).toMatchObject({ accion: 'CAMBIAR_ESTADO_TICKET', valor_anterior: { estado: 'ABIERTO' }, valor_nuevo: { estado: 'EN_PROGRESO' } });
    });

    it('resolver exige la observacion, cierra con fecha y marca resuelto remotamente', async () => {
      await crear();
      await service.tomar(1, jefe);
      await expect(service.resolver(1, { observacion: ' ' }, jefe, ahora)).rejects.toBeInstanceOf(BadRequestException);
      const t = await service.resolver(1, { observacion: 'Se reinicio la ONT a distancia' }, jefe, ahora);
      expect(t).toMatchObject({ estado: 'RESUELTO', resuelto_remotamente: true, fecha_cierre: ahora });
      expect(auditoria.at(-1)).toMatchObject({ valor_nuevo: { estado: 'RESUELTO', observacion: 'Se reinicio la ONT a distancia' } });
    });

    it('no deja saltar transiciones: un ticket ABIERTO no se resuelve sin tomarlo', async () => {
      await crear();
      await expect(service.resolver(1, { observacion: 'listo' }, jefe, ahora)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un ticket RESUELTO no vuelve a EN_PROGRESO', async () => {
      await crear();
      await service.tomar(1, jefe);
      await service.resolver(1, { observacion: 'Se reinicio la ONT' }, jefe, ahora);
      await expect(service.tomar(1, jefe)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('asignar exige un usuario de la misma empresa', async () => {
      await crear();
      await expect(service.asignar(1, 99, jefe)).rejects.toBeInstanceOf(NotFoundException);
      const t = await service.asignar(1, 3, jefe);
      expect(t.id_usuario_asignado).toBe(3);
      expect(auditoria.at(-1)).toMatchObject({ accion: 'ASIGNAR_TICKET' });
    });

    it('el detalle trae el historial del ticket desde la auditoria', async () => {
      await crear();
      await service.obtener(1, 1, ahora);
      expect(prisma.log_auditoria.findMany.mock.calls[0][0]).toMatchObject({
        where: { entidad_afectada: 'ticket', id_entidad_afectada: 1 },
      });
    });
  });

  describe('CU-32: reclasificar', () => {
    it('cambia la categoria, recalcula SLA y prioridad, y audita antes y despues', async () => {
      await crear();
      const t = await service.reclasificar(1, 2, jefe, ahora);

      expect(t).toMatchObject({ id_categoria: 2, prioridad: 'MEDIA', sla_horas: 24, vence_en: '2026-09-30T15:00:00.000Z' });
      expect(auditoria.at(-1)).toMatchObject({
        accion: 'RECLASIFICAR_TICKET',
        valor_anterior: { id_categoria: 1, categoria: 'Sin internet', sla_horas: 4, prioridad: 'CRITICA' },
        valor_nuevo: { id_categoria: 2, categoria: 'Internet lento', sla_horas: 24, prioridad: 'MEDIA' },
      });
    });

    it('la misma categoria no cambia nada y lo dice con el texto del CU', async () => {
      await crear();
      await expect(service.reclasificar(1, 1, jefe, ahora)).rejects.toThrow('La categoría seleccionada es la misma que la actual.');
    });

    it('un ticket resuelto no se reclasifica', async () => {
      await crear();
      await service.tomar(1, jefe);
      await service.resolver(1, { observacion: 'Se reinicio la ONT' }, jefe, ahora);
      await expect(service.reclasificar(1, 2, jefe, ahora)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('TicketsController', () => {
  it('toda accion es de ADMIN y JEFE_TECNICO', () => {
    const metodos = Object.getOwnPropertyNames(TicketsController.prototype).filter((m) => m !== 'constructor');
    expect(metodos.length).toBeGreaterThanOrEqual(7);
    for (const m of metodos) {
      expect([m, Reflect.getMetadata('roles', (TicketsController.prototype as any)[m])]).toEqual([m, ['ADMIN', 'JEFE_TECNICO']]);
    }
  });
});
