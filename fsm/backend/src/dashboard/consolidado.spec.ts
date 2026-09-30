import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardController } from './dashboard.controller.js';
import { SinReagendarService } from '../ordenes/sin-reagendar.service.js';

/**
 * CU-34, datos consolidados de las empresas: el ADMIN compara FiNet y Cable
 * Magico en una sola pantalla. Existia `GET /dashboard/empresa/:id` pero de a
 * una empresa y sin pantalla.
 */
describe('CU-34: consolidado de empresas', () => {
  const empresas = [
    { id_empresa: 2, nombre: 'Cable Mágico', rut_empresa: null },
    { id_empresa: 1, nombre: 'FiNet', rut_empresa: '76.000.000-0' },
  ];
  const clienteCount = jest.fn(async (a: any) => (a.where.id_empresa === 1 ? 120 : 40));
  const otCount = jest.fn(async (a: any) => {
    const e = a.where.id_empresa;
    if (a.where.estado === 'PENDIENTE_APROBACION') return e === 1 ? 3 : 0;
    if (a.where.estado === 'COMPLETADA') return e === 1 ? 50 : 12;
    return e === 1 ? 9 : 4;
  });
  let service: DashboardService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: PrismaService,
          useValue: {
            empresa: { findMany: jest.fn(async () => empresas) },
            cliente: { count: clienteCount },
            orden_trabajo: { count: otCount },
          },
        },
        { provide: SinReagendarService, useValue: {} },
      ],
    }).compile();
    service = mod.get(DashboardService);
  });

  it('una fila por empresa, con los mismos indicadores y los totales', async () => {
    const r = await service.consolidado(new Date('2026-09-29T15:00:00Z'));

    expect(r.empresas).toEqual([
      { id_empresa: 2, nombre: 'Cable Mágico', clientes_activos: 40, ot_activas: 4, ot_por_aprobar: 0, ot_completadas_30_dias: 12 },
      { id_empresa: 1, nombre: 'FiNet', clientes_activos: 120, ot_activas: 9, ot_por_aprobar: 3, ot_completadas_30_dias: 50 },
    ]);
    expect(r.totales).toEqual({ clientes_activos: 160, ot_activas: 13, ot_por_aprobar: 3, ot_completadas_30_dias: 62 });
  });

  it('cuenta clientes ACTIVOS y las completadas de los ultimos 30 dias', async () => {
    await service.consolidado(new Date('2026-09-29T15:00:00Z'));
    expect(clienteCount.mock.calls[0][0]).toEqual({ where: { id_empresa: 2, estado: 'ACTIVO' } });
    const completadas = otCount.mock.calls.map((c) => c[0] as any).find((a) => a.where.estado === 'COMPLETADA');
    expect(completadas.where.fecha_completada).toEqual({ gte: new Date('2026-08-30T15:00:00Z') });
  });

  it('es solo del ADMIN', () => {
    expect(Reflect.getMetadata('roles', DashboardController.prototype.consolidado)).toEqual(['ADMIN']);
  });
});
