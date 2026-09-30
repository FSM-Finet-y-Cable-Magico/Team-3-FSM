import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientesService } from './clientes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

describe('busqueda de clientes por criterios multiples', () => {
  const findMany = jest.fn(async (_args?: any) => []);
  const count = jest.fn(async (_args?: any) => 0);
  let moduleRef: TestingModule;
  let service: ClientesService;

  const whereUsado = () => findMany.mock.calls[0][0].where;

  beforeEach(async () => {
    jest.clearAllMocks();
    moduleRef = await Test.createTestingModule({
      providers: [
        {
          // Doble: estas pruebas no son de RF-08. La regla tiene su propio spec.
          provide: ReparacionesRecurrentesService,
          useValue: { evaluar: jest.fn(async () => ({ activa: false, total_reparaciones_30_dias: 0, ots: [] })) },
        },
        ClientesService,
        { provide: PrismaService, useValue: { cliente: { findMany, count } } },
      ],
    }).compile();
    service = moduleRef.get(ClientesService);
  });

  // Sin cerrar el modulo, Jest avisa de un worker que no termina al correr la
  // suite completa.
  afterEach(async () => {
    await moduleRef.close();
  });

  it('mantiene el aislamiento por empresa aunque no se filtre nada', async () => {
    await service.listarClientes(7);

    expect(whereUsado().id_empresa).toBe(7);
    // El mismo where va al conteo: si no, la paginacion mostraria otro total.
    expect(count.mock.calls[0][0].where).toEqual(whereUsado());
  });

  it('busca nombre y direccion sin distinguir mayusculas', async () => {
    await service.listarClientes(1, 1, 20, { nombre: 'juan', direccion: 'alameda' });
    const where = whereUsado();

    expect(where.nombre_completo).toEqual({ contains: 'juan', mode: 'insensitive' });
    expect(where.direcciones).toEqual({
      some: { direccion_completa: { contains: 'alameda', mode: 'insensitive' } },
    });
  });

  it('busca un RUT completo contra las dos grafias guardadas', async () => {
    // La columna guarda mitad "12345678-5" y mitad "123456785": comparar por
    // igualdad exacta encontraba solo una de las dos mitades de la cartera.
    await service.listarClientes(1, 1, 20, { rut: '12.345.678-5' });

    expect(whereUsado().rut).toEqual({ in: expect.arrayContaining(['123456785', '12345678-5', '12.345.678-5']) });
  });

  it('busca un RUT parcial por el cuerpo, que va sin puntuacion en las dos grafias', async () => {
    await service.listarClientes(1, 1, 20, { rut: '12.345' });

    expect(whereUsado().rut).toEqual({ contains: '12345', mode: 'insensitive' });
  });

  it('sigue sin distinguir la K del digito verificador', async () => {
    await service.listarClientes(1, 1, 20, { rut: '21116770k' });

    // 21116770-K si tiene la K por digito verificador, asi que entra por las
    // grafias, y ahi van las dos cajas porque `in` no admite `insensitive`.
    expect(whereUsado().rut).toEqual({ in: expect.arrayContaining(['21116770K', '21116770k', '21116770-K', '21116770-k']) });
  });

  it('combina los filtros en un AND, sin ampliar el resultado', async () => {
    await service.listarClientes(1, 1, 20, { nombre: 'juan', telefono: '5678' });
    const where = whereUsado();

    expect(where.nombre_completo).toBeDefined();
    expect(where.telefono).toEqual({ contains: '5678' });
    expect(where.OR).toBeUndefined();
  });

  it('ignora los filtros en blanco y devuelve el listado completo', async () => {
    await service.listarClientes(1, 1, 20, { nombre: '   ', rut: '', telefono: undefined });

    expect(whereUsado()).toEqual({ id_empresa: 1 });
  });

  it('pone techo al limit para que no se pida la tabla entera', async () => {
    await service.listarClientes(1, 1, 100000);

    expect(findMany.mock.calls[0][0].take).toBeLessThanOrEqual(100);
  });
});
