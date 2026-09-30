import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService } from './clientes.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * Catalogo de planes, en solo lectura (acta con FiNet). El alta y la edicion
 * quedan pendientes de B-01: de quien son `plan` y `contrato`.
 */
describe('catalogo de planes', () => {
  it('trae los activos de la empresa con su tipo y descripcion, y el precio como numero', async () => {
    const findMany = jest.fn(async (_a: any) => [
      { id_plan: 1, nombre_comercial: 'Fibra 600', tipo_plan: 'INTERNET', tipo_cliente: 'HOGAR', velocidad_mbps: 600,
        precio_mensual: { toString: () => '19990.00' }, descripcion: 'Simétrico' },
    ]);
    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: {} },
        { provide: PrismaService, useValue: { plan: { findMany } } },
      ],
    }).compile();
    const r = await mod.get(ClientesService).listarPlanes(1);

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { id_empresa: 1, activo: true },
      orderBy: [{ tipo_plan: 'asc' }, { precio_mensual: 'asc' }],
    });
    expect(r).toEqual([
      { id_plan: 1, nombre_comercial: 'Fibra 600', tipo_plan: 'INTERNET', tipo_cliente: 'HOGAR', velocidad_mbps: 600, precio_mensual: 19990, descripcion: 'Simétrico' },
    ]);
  });
});
