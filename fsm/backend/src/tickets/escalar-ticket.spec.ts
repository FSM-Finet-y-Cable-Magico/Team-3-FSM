import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdenesService } from '../ordenes/ordenes.service.js';
import { TicketsService } from './tickets.service.js';

/**
 * CU-30: "si el problema requiere visita presencial, el ticket queda vinculado
 * a la OT creada y se cierra automaticamente cuando la OT se complete".
 *
 * La OT se crea con `OrdenesService.crearOT`, no con un insert propio: asi
 * hereda sus reglas (RUT, tecnico de la empresa, historial, auditoria). Como
 * `crearOT` busca al cliente por RUT, un ticket sin cliente no se deriva por
 * aca.
 */
describe('derivar un ticket a una OT (CU-30)', () => {
  const jefe = { userId: 3, id_empresa: 1, rol: 'JEFE_TECNICO' };
  let ticket: any;
  const crearOT = jest.fn(async (..._a: unknown[]): Promise<any> => ({ id_ot: 500, estado: 'PENDIENTE' }));
  const update = jest.fn(async (a: any) => Object.assign(ticket, a.data));
  const auditar = jest.fn(async (_a: any) => ({}));
  let service: TicketsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    ticket = {
      id_ticket: 7,
      id_empresa: 1,
      id_cliente: 10,
      id_categoria: 1,
      codigo_seguimiento: 'TK-ABCDEFG',
      prioridad: 'CRITICA',
      estado: 'EN_PROGRESO',
      descripcion: 'Sin internet desde ayer',
      fecha_creacion: new Date('2026-09-29T12:00:00Z'),
      id_usuario_asignado: 3,
      categoria: { id_categoria: 1, nombre: 'Sin internet', sla_horas: 4 },
      cliente: { id_cliente: 10, rut: '12345678-5', nombre_completo: 'Ana Soto', telefono: null },
      usuario_asignado: null,
      orden_trabajo: null,
    };
    const mod = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: OrdenesService, useValue: { crearOT } },
        {
          provide: PrismaService,
          useValue: {
            ticket: { findFirst: jest.fn(async () => ({ ...ticket })) },
            log_auditoria: { findMany: jest.fn(async () => []) },
            $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
              fn({ ticket: { update }, log_auditoria: { create: auditar } }),
            ),
          },
        },
      ],
    }).compile();
    service = mod.get(TicketsService);
  });

  it('crea la OT de reparacion con el RUT del cliente y la prioridad del ticket, y deja el ticket derivado', async () => {
    await service.escalar(7, { id_tecnico: 14, observaciones: 'Revisar roseta' }, jefe);

    expect(crearOT).toHaveBeenCalledWith(
      {
        rut_cliente: '12345678-5',
        tipo_ot: 'REPARACION',
        prioridad: 'CRITICA',
        id_tecnico: 14,
        bloque_horario: undefined,
        observaciones: 'Ticket TK-ABCDEFG (Sin internet): Sin internet desde ayer\nRevisar roseta',
      },
      3,
      1,
      { id_ticket: 7 },
    );
    expect(update).toHaveBeenCalledWith({ where: { id_ticket: 7 }, data: { estado: 'DERIVADO_OT' } });
    expect(auditar).toHaveBeenCalledWith({
      data: expect.objectContaining({ accion: 'CAMBIAR_ESTADO_TICKET', valor_nuevo: { estado: 'DERIVADO_OT', id_ot: 500 } }),
    });
  });

  it('un ticket sin cliente no se deriva por este camino', async () => {
    ticket.id_cliente = null;
    ticket.cliente = null;
    await expect(service.escalar(7, {}, jefe)).rejects.toThrow('sin cliente');
    expect(crearOT).not.toHaveBeenCalled();
  });

  it('un ticket resuelto no se deriva', async () => {
    ticket.estado = 'RESUELTO';
    await expect(service.escalar(7, {}, jefe)).rejects.toBeInstanceOf(BadRequestException);
    expect(crearOT).not.toHaveBeenCalled();
  });

  it('un ticket que ya tiene OT no crea otra', async () => {
    ticket.orden_trabajo = { id_ot: 499, estado: 'ASIGNADA' };
    ticket.estado = 'ABIERTO';
    await expect(service.escalar(7, {}, jefe)).rejects.toThrow('OT 499');
    expect(crearOT).not.toHaveBeenCalled();
  });
});
