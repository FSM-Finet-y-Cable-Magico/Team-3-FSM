import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';

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
