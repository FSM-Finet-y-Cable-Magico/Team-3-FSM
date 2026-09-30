import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService } from './clientes.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * RF-53 (zona en la ficha) y RF-54 (filtrar clientes por zona).
 *
 * El acta con FiNet dejo el catalogo administrable de zonas en el Grupo 2
 * (D-02). Mientras G2 no exponga su catalogo, la zona sale de lo que G3 ya
 * sabe: la zona que informa SmartOLT para la ONT del cliente, o la de la caja
 * NAP de su puerto. Se dice de donde salio, para que nadie la tome por la del
 * catalogo.
 */
describe('zona del cliente (RF-53, RF-54)', () => {
  const registroFindFirst = jest.fn(async (_a: any): Promise<any> => null);
  const registroFindMany = jest.fn(async (_a: any): Promise<any[]> => [{ id_cliente: 10 }, { id_cliente: 12 }]);
  const puertoFindFirst = jest.fn(async (_a: any): Promise<any> => null);
  const clienteFindMany = jest.fn(async (_a: any): Promise<any[]> => []);
  let service: ClientesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            registro_ont: { findFirst: registroFindFirst, findMany: registroFindMany },
            puerto_nap: { findFirst: puertoFindFirst },
            cliente: { findMany: clienteFindMany, count: jest.fn(async () => 0) },
          },
        },
      ],
    }).compile();
    service = mod.get(ClientesService);
  });

  it('la zona de la ONT manda, y se dice que viene del monitoreo', async () => {
    registroFindFirst.mockResolvedValueOnce({ zona: 'Norte' });
    await expect(service.zonaDe(10, 1)).resolves.toEqual({ nombre: 'Norte', origen: 'MONITOREO' });
    expect(registroFindFirst.mock.calls[0][0].where).toEqual({ id_cliente: 10, id_empresa: 1, zona: { not: null } });
  });

  it('sin zona en la ONT, la de la caja de su puerto', async () => {
    puertoFindFirst.mockResolvedValueOnce({ caja_nap: { zona: 'Sur' } });
    await expect(service.zonaDe(10, 1)).resolves.toEqual({ nombre: 'Sur', origen: 'CAJA_NAP' });
  });

  it('sin ninguna de las dos, no hay zona', async () => {
    await expect(service.zonaDe(10, 1)).resolves.toBeNull();
  });

  it('el filtro por zona busca en las dos fuentes, dentro de la empresa', async () => {
    await service.listarClientes(1, 1, 20, { zona: 'nor' });

    expect(registroFindMany.mock.calls[0][0]).toMatchObject({
      where: { id_empresa: 1, id_cliente: { not: null }, zona: { contains: 'nor', mode: 'insensitive' } },
    });
    expect(clienteFindMany.mock.calls[0][0].where).toMatchObject({
      id_empresa: 1,
      OR: [
        { id_cliente: { in: [10, 12] } },
        { puertos_nap: { some: { caja_nap: { zona: { contains: 'nor', mode: 'insensitive' } } } } },
      ],
    });
  });

  it('sin filtro de zona no consulta el monitoreo', async () => {
    await service.listarClientes(1, 1, 20, {});
    expect(registroFindMany).not.toHaveBeenCalled();
  });
});
