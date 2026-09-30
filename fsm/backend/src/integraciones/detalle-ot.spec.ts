import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IntegracionesService } from './integraciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MOMENTO_FAN_OUT } from '../ordenes/fan-out/momento-fan-out.js';

/**
 * P0-b del acuerdo con G8: `GET /integraciones/ordenes/{id}` es la consulta
 * oficial de estado mientras la OT no se cierra (el GET de `/cierre` solo
 * sirve despues). Forma: §7 del acuerdo propuesto por G8.
 */
describe('detalle de OT para otros sistemas', () => {
  const scope = { grupo: 'G8', empresas: [1] };
  const fila = {
    id_ot: 781,
    id_empresa: 1,
    tipo_ot: 'INSTALACION',
    prioridad: 'MEDIA',
    estado: 'ASIGNADA',
    fecha_creacion: new Date('2026-09-29T18:00:00Z'),
    fecha_programada: new Date('2026-09-30T13:00:00Z'),
    fecha_completada: null,
    tecnico: { id_usuario: 14, nombre_completo: 'Pedro Rojas' },
    solicitud_integracion: {
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      trace_id: '6f1d7d17-3f7d-4db8-93a8-87e8d7ce0031',
      id_contrato_externo: 92,
      id_prospecto_externo: 45,
      id_plan_externo: 15,
    },
  };
  const findFirst = jest.fn(async (_a?: any): Promise<any> => fila);
  let service: IntegracionesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [IntegracionesService, { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' }, { provide: PrismaService, useValue: { orden_trabajo: { findFirst } } }],
    }).compile();
    service = moduleRef.get(IntegracionesService);
  });

  it('devuelve el estado real con el tecnico y el origen de la solicitud', async () => {
    await expect(service.orden(scope, 781, 1)).resolves.toEqual({
      id_ot: 781,
      id_empresa: 1,
      tipo_ot: 'INSTALACION',
      prioridad: 'MEDIA',
      estado: 'ASIGNADA',
      fecha_creacion: fila.fecha_creacion,
      fecha_programada: fila.fecha_programada,
      fecha_completada: null,
      tecnico: { id_usuario: 14, nombre_completo: 'Pedro Rojas' },
      origen_integracion: {
        request_id: '550e8400-e29b-41d4-a716-446655440000',
        trace_id: '6f1d7d17-3f7d-4db8-93a8-87e8d7ce0031',
        id_contrato: 92,
        id_prospecto: 45,
        id_plan: 15,
      },
    });
    expect(findFirst.mock.calls[0][0]).toMatchObject({ where: { id_ot: 781, id_empresa: 1 } });
  });

  it('una OT que no vino de G8 lleva origen_integracion null', async () => {
    findFirst.mockResolvedValueOnce({ ...fila, tecnico: null, solicitud_integracion: null });
    const r = await service.orden(scope, 781, 1);
    expect(r.origen_integracion).toBeNull();
    expect(r.tecnico).toBeNull();
  });

  it('no expone datos del cliente ni de la persona', async () => {
    const r = await service.orden(scope, 781, 1);
    expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['cliente']));
    expect(JSON.stringify(r)).not.toMatch(/telefono|rut/);
  });

  it('404 si la OT no es de esa empresa, 403 fuera del scope, 400 con id invalido', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(service.orden(scope, 781, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.orden(scope, 781, 2)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.orden(scope, NaN, 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.orden(scope, -3, 1)).rejects.toBeInstanceOf(BadRequestException);
  });
});
