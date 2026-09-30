import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TopologiaService } from './topologia.service.js';
import { PlantaExternaController } from './planta-externa.controller.js';

/**
 * CU-20: disponibilidad de puertos NAP.
 *
 * El codigo y la pantalla existian, pero los puertos no reflejaban la red: la
 * fuente de verdad es `registro_ont`, que el ligado del Incremento 2 ya dejo
 * con `id_caja_nap`. La reconciliacion marca OCUPADO el puerto de cada cliente
 * que tiene su ONT en la caja, y crea los puertos de las cajas que no tienen
 * ninguno cuando se conoce su capacidad. Es idempotente y por defecto solo
 * muestra lo que haria.
 */
describe('reconciliar puertos con las ONT ligadas (CU-20)', () => {
  let cajas: any[];
  let registros: any[];
  const createMany = jest.fn(async (_a: any) => ({ count: 0 }));
  const update = jest.fn(async (_a: any) => ({}));
  const auditar = jest.fn(async (_a: any) => ({}));
  let service: TopologiaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    cajas = [
      // Sin puertos pero con capacidad: se crean y se ocupan.
      { id_caja_nap: 1, identificador_unico: 'NAP-A', capacidad_puertos: 8, puertos: [] },
      // Con puertos: el cliente 20 ya tiene el suyo; al 21 le toca el primer LIBRE.
      {
        id_caja_nap: 2, identificador_unico: 'NAP-B', capacidad_puertos: 4,
        puertos: [
          { id_puerto: 21, numero_puerto: 1, estado: 'OCUPADO', id_cliente_asociado: 20 },
          { id_puerto: 22, numero_puerto: 2, estado: 'EN_MANTENCION', id_cliente_asociado: null },
          { id_puerto: 23, numero_puerto: 3, estado: 'LIBRE', id_cliente_asociado: null },
          { id_puerto: 24, numero_puerto: 4, estado: 'LIBRE', id_cliente_asociado: null },
        ],
      },
      // Llena: el cliente 31 queda sin puerto.
      { id_caja_nap: 3, identificador_unico: 'NAP-C', capacidad_puertos: 1, puertos: [{ id_puerto: 31, numero_puerto: 1, estado: 'OCUPADO', id_cliente_asociado: 30 }] },
      // Sin puertos y sin capacidad conocida: no se inventa cuantos tiene.
      { id_caja_nap: 4, identificador_unico: 'NAP-D', capacidad_puertos: null, puertos: [] },
    ];
    registros = [
      { id_caja_nap: 1, id_cliente: 10 },
      { id_caja_nap: 1, id_cliente: 11 },
      { id_caja_nap: 2, id_cliente: 20 },
      { id_caja_nap: 2, id_cliente: 21 },
      { id_caja_nap: 3, id_cliente: 31 },
      { id_caja_nap: 4, id_cliente: 40 },
      { id_caja_nap: 1, id_cliente: null },
    ];
    const mod = await Test.createTestingModule({
      providers: [
        TopologiaService,
        {
          provide: PrismaService,
          useValue: {
            caja_nap: { findMany: jest.fn(async () => cajas) },
            registro_ont: { findMany: jest.fn(async () => registros.filter((r) => r.id_cliente !== null)) },
            $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
              const tx = {
                puerto_nap: {
                  createMany,
                  update,
                  findMany: jest.fn(async () =>
                    Array.from({ length: 8 }, (_, i) => ({ id_puerto: 100 + i, numero_puerto: i + 1, estado: 'LIBRE', id_cliente_asociado: null })),
                  ),
                },
                log_auditoria: { create: auditar },
              };
              return fn(tx);
            }),
          },
        },
      ],
    }).compile();
    service = mod.get(TopologiaService);
  });

  it('sin aplicar, dice lo que haria y no escribe nada', async () => {
    const r = await service.reconciliarPuertos(1, 3, false);

    expect(r).toEqual({
      aplicado: false,
      cajas_revisadas: 4,
      puertos_creados: 8,
      puertos_ocupados: 3,
      clientes_sin_puerto: [{ id_caja_nap: 3, identificador_unico: 'NAP-C', id_cliente: 31 }],
      cajas_sin_capacidad: [{ id_caja_nap: 4, identificador_unico: 'NAP-D' }],
    });
    expect(createMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('al aplicar crea los puertos, ocupa el primero libre de cada cliente y lo audita', async () => {
    await service.reconciliarPuertos(1, 3, true);

    expect(createMany).toHaveBeenCalledWith({
      data: Array.from({ length: 8 }, (_, i) => ({ id_caja_nap: 1, numero_puerto: i + 1, estado: 'LIBRE' })),
    });
    // Caja B: el cliente 21 va al puerto 3 (el 2 esta en mantencion).
    expect(update).toHaveBeenCalledWith({ where: { id_puerto: 23 }, data: { estado: 'OCUPADO', id_cliente_asociado: 21 } });
    // Caja A: los recien creados, en orden.
    expect(update).toHaveBeenCalledWith({ where: { id_puerto: 100 }, data: { estado: 'OCUPADO', id_cliente_asociado: 10 } });
    expect(update).toHaveBeenCalledWith({ where: { id_puerto: 101 }, data: { estado: 'OCUPADO', id_cliente_asociado: 11 } });
    expect(update).toHaveBeenCalledTimes(3);
    expect(auditar).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'RECONCILIAR_PUERTOS_NAP', id_usuario: 3 }) });
  });

  it('es solo del ADMIN', () => {
    expect(Reflect.getMetadata('roles', PlantaExternaController.prototype.reconciliarPuertos)).toEqual(['ADMIN']);
  });
});

describe('cajas cercanas con puertos libres (CU-20, excepcion 1)', () => {
  let service: TopologiaService;
  const origen = { id_caja_nap: 1, latitud: -33.45, longitud: -70.66 };
  const findFirst = jest.fn(async (_a: any): Promise<any> => origen);
  const findMany = jest.fn(async (_a: any): Promise<any[]> => [
    { id_caja_nap: 3, identificador_unico: 'NAP-LEJOS', latitud: -33.50, longitud: -70.66, zona: null, puertos: [{ estado: 'LIBRE' }] },
    { id_caja_nap: 2, identificador_unico: 'NAP-CERCA', latitud: -33.451, longitud: -70.66, zona: null, puertos: [{ estado: 'LIBRE' }, { estado: 'OCUPADO' }] },
  ]);

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [TopologiaService, { provide: PrismaService, useValue: { caja_nap: { findFirst, findMany } } }],
    }).compile();
    service = mod.get(TopologiaService);
  });

  it('ordena por distancia las cajas de la empresa con al menos un puerto libre', async () => {
    const r = await service.cajasCercanas(1, 1);

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      id_empresa: 1,
      id_caja_nap: { not: 1 },
      latitud: { not: null },
      longitud: { not: null },
      puertos: { some: { estado: 'LIBRE' } },
    });
    expect(r.map((c) => c.identificador_unico)).toEqual(['NAP-CERCA', 'NAP-LEJOS']);
    expect(r[0]).toMatchObject({ libres: 1 });
    expect(r[0].distancia_m).toBeGreaterThan(100);
    expect(r[0].distancia_m).toBeLessThan(120);
  });

  it('404 si la caja no es de la empresa', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(service.cajasCercanas(9, 1)).rejects.toBeInstanceOf(NotFoundException);
  });
});
