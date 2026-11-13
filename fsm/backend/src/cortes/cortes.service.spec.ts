import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CortesService } from './cortes.service.js';
import { ACCION_CORTE } from './cortes.js';

const contrato = (id: number, estado: string, extra: Record<string, unknown> = {}) => ({
  id_contrato: id,
  estado,
  fecha_suspension: estado.toLowerCase().startsWith('suspend') ? new Date('2026-11-13T00:00:00Z') : null,
  id_cliente: 100 + id,
  plan: { nombre_comercial: 'FULL S' },
  cliente: { id_cliente: 100 + id, nombre_completo: `Cliente ${id}`, rut: '11111111-1', telefono: '9 1234 5678', direcciones: [{ direccion_completa: 'Calle 1', comuna: 'La Granja' }] },
  ...extra,
});

describe('CortesService', () => {
  let contratos: any[];
  let registros: any[];
  let prisma: any;
  let service: CortesService;

  beforeEach(() => {
    contratos = [];
    registros = [];
    prisma = {
      contrato: {
        findMany: jest.fn(async () => contratos),
        findFirst: jest.fn(async ({ where }: any) => contratos.find((c) => c.id_contrato === where.id_contrato && where.id_empresa === 1) ?? null),
      },
      log_auditoria: {
        findMany: jest.fn(async () => registros),
        findFirst: jest.fn(async () => registros[0] ?? null),
        create: jest.fn(async ({ data }: any) => ({ id_log: 77n, accion: data.accion, fecha_hora: new Date('2026-11-13T15:00:00Z') })),
      },
      registro_ont: { findMany: jest.fn(async () => []) },
    };
    service = new CortesService(prisma as unknown as PrismaService);
  });

  it('separa por cortar y por reactivar, solo de la empresa pedida', async () => {
    contratos = [contrato(1, 'Suspendido'), contrato(2, 'Activo'), contrato(3, 'Activo')];
    registros = [{ id_log: 5n, accion: ACCION_CORTE, fecha_hora: new Date('2026-11-01T12:00:00Z'), id_entidad_afectada: 2, valor_nuevo: { observacion: 'listo' }, usuario: { nombre_completo: 'Ana' } }];

    const r = await service.listar(1);

    expect(prisma.contrato.findMany.mock.calls[0][0].where).toEqual({ id_empresa: 1 });
    expect(r.por_cortar.map((f) => f.id_contrato)).toEqual([1]);
    expect(r.por_reactivar.map((f) => f.id_contrato)).toEqual([2]);
    expect(r.por_cortar[0]).toMatchObject({ fecha_suspension: '2026-11-13', plan: 'FULL S', direccion: { comuna: 'La Granja' } });
    expect(r.historial[0]).toMatchObject({ id_log: 5, usuario: 'Ana', id_contrato: 2, cliente: 'Cliente 2', observacion: 'listo' });
  });

  it('un contrato sin cliente se lista igual', async () => {
    contratos = [contrato(9, 'Suspendido', { id_cliente: null, cliente: null })];
    const r = await service.listar(1);
    expect(r.por_cortar[0]).toMatchObject({ id_contrato: 9, cliente: null, direccion: null, onts: [] });
  });

  it('registra un corte pendiente en log_auditoria', async () => {
    contratos = [contrato(1, 'Suspendido')];
    const r = await service.registrar(1, 1, 'CORTE', 'hecho por Daniel', 4);

    expect(prisma.log_auditoria.create.mock.calls[0][0].data).toMatchObject({
      id_usuario: 4,
      accion: 'CORTE_SMARTOLT',
      entidad_afectada: 'contrato',
      id_entidad_afectada: 1,
      valor_nuevo: { observacion: 'hecho por Daniel', estado_contrato: 'Suspendido', fecha_suspension: '2026-11-13' },
    });
    expect(r).toMatchObject({ id_log: 77, accion: 'CORTE_SMARTOLT' });
  });

  it('409 si el contrato no esta pendiente de esa accion (por ejemplo, un segundo clic)', async () => {
    contratos = [contrato(1, 'Suspendido')];
    registros = [{ accion: ACCION_CORTE, fecha_hora: new Date('2026-11-13T15:00:00Z') }];
    await expect(service.registrar(1, 1, 'CORTE', undefined, 4)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.registrar(1, 1, 'REACTIVACION', undefined, 4)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.log_auditoria.create).not.toHaveBeenCalled();
  });

  it('409 tambien para un corte registrado de noche, con la suspension fechada en UTC', async () => {
    contratos = [contrato(1, 'Suspendido', { fecha_suspension: new Date('2026-11-14T00:00:00Z') })];
    registros = [{ accion: ACCION_CORTE, fecha_hora: new Date('2026-11-14T01:30:00Z'), id_entidad_afectada: 1, valor_nuevo: { fecha_suspension: '2026-11-14' } }];
    await expect(service.registrar(1, 1, 'CORTE', undefined, 4)).rejects.toBeInstanceOf(ConflictException);
    const r = await service.listar(1);
    expect(r.por_cortar).toHaveLength(0);
  });

  it('404 por un contrato de otra empresa', async () => {
    contratos = [contrato(1, 'Suspendido')];
    await expect(service.registrar(2, 1, 'CORTE', undefined, 4)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('503 SIN_PERMISO_CONTRATO si la base niega leer contrato', async () => {
    prisma.contrato.findMany.mockImplementation(async () => {
      throw Object.assign(new Error('permission denied for table contrato'), { code: '42501' });
    });
    const e = await service.listar(1).catch((x) => x);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(e.getResponse()).toMatchObject({ codigo: 'SIN_PERMISO_CONTRATO' });
  });
});
