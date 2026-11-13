import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import type { OntDetalle } from './fuente/fuente-monitoreo.js';

/**
 * `asegurarRegistros` garantiza una fila de `registro_ont` por cada serial que
 * entra por la fuente. Creaba las faltantes con un INSERT por ONT: en la
 * primera ingesta eso son 941 viajes a la base.
 *
 * No tenia prueba propia --los otros specs la doblaban entera-- y es justo el
 * punto donde se resuelve la identidad de cada ONT.
 */
describe('registro_ont · alta de las ONT que faltan', () => {
  let service: RegistroOntService;
  let existentes: any[];
  const findMany = jest.fn(async (_a: unknown) => existentes);
  const createMany = jest.fn(async (_a: unknown) => ({ count: 0 }));
  const updateMany = jest.fn(async (_a: unknown) => ({ count: 0 }));

  const fila = (id: number, sn: string, id_empresa: number | null = 1) => ({
    id_registro_ont: id,
    numero_serie: sn,
    id_empresa,
    id_unidad: null,
    id_cliente: null,
    id_caja_nap: null,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    existentes = [];
    const mod = await Test.createTestingModule({
      providers: [
        RegistroOntService,
        {
          provide: PrismaService,
          useValue: { registro_ont: { findMany, createMany, updateMany } },
        },
        { provide: ConfigService, useValue: { get: () => 1 } },
      ],
    }).compile();
    service = mod.get(RegistroOntService);
  });

  it('crea todas las faltantes en una sola sentencia, no una por ONT', async () => {
    const sns = ['A1', 'A2', 'A3'];
    // Primera lectura: no existe ninguna. Segunda: ya estan las tres.
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(sns.map((sn, i) => fila(i + 1, sn)));

    const mapa = await service.asegurarRegistros(sns);

    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0][0] as any;
    expect(arg.data).toHaveLength(3);
    expect(mapa.size).toBe(3);
    expect(mapa.get('A2')).toMatchObject({ id_registro_ont: 2 });
  });

  it('tolera que dos ingestas solapadas calculen la misma lista', async () => {
    // Sin skipDuplicates el segundo ciclo chocaria contra el unique de
    // numero_serie y se caeria la ingesta entera.
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([fila(1, 'A1')]);

    await service.asegurarRegistros(['A1']);

    expect((createMany.mock.calls[0][0] as any).skipDuplicates).toBe(true);
  });

  it('no escribe nada si ya estaban todas', async () => {
    existentes = [fila(1, 'A1'), fila(2, 'A2')];

    const mapa = await service.asegurarRegistros(['A1', 'A2']);

    expect(createMany).not.toHaveBeenCalled();
    expect(mapa.size).toBe(2);
  });

  it('no consulta nada con la lista vacia', async () => {
    expect((await service.asegurarRegistros([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rellena la empresa de las filas viejas que quedaron en null', async () => {
    // Se crearon antes de que existiera la columna, y el motor de alertas
    // --que filtra por empresa-- no las veria nunca.
    existentes = [fila(1, 'A1', null), fila(2, 'A2', 1)];

    await service.asegurarRegistros(['A1', 'A2']);

    expect((updateMany.mock.calls[0][0] as any).where.numero_serie).toEqual({ in: ['A1'] });
    expect((updateMany.mock.calls[0][0] as any).data).toEqual({ id_empresa: 1 });
  });
});

/**
 * La caja y el puerto de cada ONT se mantienen al dia en CADA sondeo. Antes el
 * censo solo se escribia para las ONT sin unidad: una ONT ya enriquecida nunca
 * se enteraba de que la cambiaron de caja, y nunca recibiria su puerto.
 */
describe('registro_ont · caja y puerto de cada ONT segun la fuente', () => {
  let service: RegistroOntService;
  let actuales: any[];
  const findMany = jest.fn(async (_a: unknown) => actuales);
  const update = jest.fn((a: unknown) => a);
  const $transaction = jest.fn(async (ops: unknown[]) => ops);

  const det = (sn: string, odb: string | null, odb_puerto?: number | null): OntDetalle => ({
    sn,
    id_externo: sn,
    olt_externo: '3',
    board: 12,
    puerto_pon: 1,
    zona: 'ZONA 6',
    odb,
    ...(odb_puerto === undefined ? {} : { odb_puerto }),
    nombre_cliente: null,
    direccion_cliente: null,
    modelo: null,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    actuales = [];
    const mod = await Test.createTestingModule({
      providers: [
        RegistroOntService,
        { provide: PrismaService, useValue: { registro_ont: { findMany, update }, $transaction } },
        { provide: ConfigService, useValue: { get: () => 1 } },
      ],
    }).compile();
    service = mod.get(RegistroOntService);
  });

  it('escribe solo las ONT cuya caja o puerto cambio', async () => {
    actuales = [
      { numero_serie: 'A', odb: 'NAP203', odb_puerto: 3 },
      { numero_serie: 'B', odb: 'NAP203', odb_puerto: null },
      { numero_serie: 'C', odb: 'NAP61', odb_puerto: 1 },
    ];

    const n = await service.sincronizarUbicacion([
      det('A', 'NAP203', 3),
      det('B', 'NAP203', 4),
      det('C', 'NAP62', 1),
    ]);

    expect(n).toBe(2);
    expect(update.mock.calls.map((c) => c[0])).toEqual([
      { where: { numero_serie: 'B' }, data: { odb_puerto: 4 } },
      { where: { numero_serie: 'C' }, data: { odb: 'NAP62' } },
    ]);
  });

  it('busca por empresa de la fuente y no filtra por unidad: alcanza a las ONT de G1', async () => {
    await service.sincronizarUbicacion([det('A', 'NAP203', 3)]);

    expect((findMany.mock.calls[0][0] as any).where).toEqual({
      numero_serie: { in: ['A'] },
      id_empresa: 1,
    });
  });

  it('borra el puerto cuando SmartOLT dice que ya no tiene', async () => {
    actuales = [{ numero_serie: 'A', odb: 'NAP203', odb_puerto: 3 }];

    await service.sincronizarUbicacion([det('A', 'NAP203', null)]);

    expect(update.mock.calls[0][0]).toEqual({ where: { numero_serie: 'A' }, data: { odb_puerto: null } });
  });

  it('no toca el puerto si la fuente no lo informa (CSV, mock)', async () => {
    actuales = [{ numero_serie: 'A', odb: 'NAP203', odb_puerto: 3 }];

    const n = await service.sincronizarUbicacion([det('A', 'NAP203')]);

    expect(n).toBe(0);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('ignora ONT del censo que no estan registradas', async () => {
    actuales = [];

    const n = await service.sincronizarUbicacion([det('Z', 'NAP1', 2)]);

    expect(n).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });
});
