import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService } from './clientes.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * Catalogo de planes, en solo lectura (acta con FiNet). El alta y la edicion
 * quedan pendientes de B-01: de quien son `plan` y `contrato`. Contra la base
 * compartida el catalogo lo carga el CRM de G8: aca solo se lee.
 */
describe('catalogo de planes', () => {
  const servicio = async (filas: unknown[]) => {
    const findMany = jest.fn(async (_a: any) => filas);
    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: {} },
        { provide: PrismaService, useValue: { plan: { findMany } } },
      ],
    }).compile();
    return { findMany, servicio: mod.get(ClientesService) };
  };

  it('trae los activos de la empresa con su tipo y descripcion, y el precio como numero', async () => {
    const { findMany, servicio: s } = await servicio([
      { id_plan: 1, nombre_comercial: 'Fibra 600', tipo_plan: 'INTERNET', tipo_cliente: 'HOGAR', velocidad_mbps: 600,
        precio_mensual: { toString: () => '19990.00' }, descripcion: 'Simétrico', _count: { contratos: 42 } },
    ]);
    const r = await s.listarPlanes(1);

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { id_empresa: 1, activo: true },
      orderBy: [{ tipo_plan: 'asc' }, { precio_mensual: 'asc' }],
    });
    expect(r).toEqual([
      { id_plan: 1, nombre_comercial: 'Fibra 600', tipo_plan: 'INTERNET', tipo_cliente: 'HOGAR', velocidad_mbps: 600,
        precio_mensual: 19990, descripcion: 'Simétrico', contratos_activos: 42 },
    ]);
  });

  it('cuenta solo los contratos activos de la misma empresa, con el estado insensible a mayusculas', async () => {
    // La base global la carga el CRM de G8 y guarda "Activo", no "ACTIVO"
    // (estado-activo.util.ts). Sin `mode: insensitive` todo plan saldria en 0.
    const { findMany, servicio: s } = await servicio([]);
    await s.listarPlanes(7);

    const seleccion = (findMany.mock.calls[0][0] as any).select;
    expect(seleccion._count.select.contratos).toEqual({
      where: { estado: { equals: 'ACTIVO', mode: 'insensitive' }, id_empresa: 7 },
    });
  });

  it('deja el plan en cero si la fila viene sin el conteo', async () => {
    // Defensivo: los mocks y cualquier lectura que no pida `_count` no deben
    // reventar la pagina con un "cannot read properties of undefined".
    const { servicio: s } = await servicio([
      { id_plan: 9, nombre_comercial: 'Fibra 100', tipo_plan: 'INTERNET', tipo_cliente: 'HOGAR',
        velocidad_mbps: 100, precio_mensual: { toString: () => '14990.00' }, descripcion: null },
    ]);

    expect((await s.listarPlanes(1))[0].contratos_activos).toBe(0);
  });
});
