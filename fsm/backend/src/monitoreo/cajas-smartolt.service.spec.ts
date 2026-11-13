import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from './alertas.service.js';
import { CajasSmartoltService } from './cajas-smartolt.service.js';
import type { EstadoOnt } from './reglas-alerta.js';

describe('cajas SmartOLT · lista y detalle', () => {
  let service: CajasSmartoltService;
  let onts: EstadoOnt[];
  let catalogo: { nombre: string; capacidad: number | null }[];
  const cargarEstado = jest.fn(async (_id: number) => onts);
  const findMany = jest.fn(async (_a: unknown) => catalogo);

  const ont = (sn: string, odb: string | null, puerto: number | null, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
    id_registro_ont: 1,
    numero_serie: sn,
    id_cliente: null,
    id_caja_nap: null,
    olt_externo: '2',
    board: 1,
    puerto_pon: 7,
    caja_normalizada: odb ? odb.toUpperCase().replace(/([A-Z])(\d)/g, '$1 $2') : null,
    estado_conexion: 'ONLINE',
    potencia_dbm: -21,
    sin_senal_desde: null,
    odb,
    odb_puerto: puerto,
    zona: 'ZONA 6',
    nombre_cliente: null,
    ...extra,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    onts = [];
    catalogo = [];
    const mod = await Test.createTestingModule({
      providers: [
        CajasSmartoltService,
        { provide: AlertasService, useValue: { cargarEstado } },
        { provide: PrismaService, useValue: { odb_smartolt: { findMany } } },
      ],
    }).compile();
    service = mod.get(CajasSmartoltService);
  });

  it('lee las ONT y el catalogo SOLO de la empresa pedida', async () => {
    await service.listar(5);

    expect(cargarEstado).toHaveBeenCalledWith(5);
    expect((findMany.mock.calls[0][0] as any).where).toEqual({ id_empresa: 5 });
  });

  it('una fila por caja, con su ocupacion', async () => {
    onts = [ont('A', 'NAP53', 1), ont('B', 'NAP53', 3), ont('C', 'NAP53', null), ont('D', 'NAP61', 2)];
    catalogo = [{ nombre: 'NAP53', capacidad: 16 }];

    const r = await service.listar(1);

    expect(r).toEqual([
      expect.objectContaining({
        clave: '2/1/7|NAP 53', nombre: 'NAP53', capacidad: 16, capacidad_estimada: false,
        ocupados: 2, ont_total: 3, sin_puerto: 1,
      }),
      expect.objectContaining({ nombre: 'NAP61', capacidad: 8, capacidad_estimada: true, ocupados: 1 }),
    ]);
  });

  it('las ONT sin nombre de caja no forman caja', async () => {
    onts = [ont('A', null, 1)];

    expect(await service.listar(1)).toEqual([]);
  });

  it('filtra por zona y ordena por zona y nombre (NAP 9 antes que NAP 10)', async () => {
    onts = [
      ont('A', 'NAP10', 1, { puerto_pon: 1 }),
      ont('B', 'NAP9', 1, { puerto_pon: 2 }),
      ont('C', 'NAP1', 1, { puerto_pon: 3, zona: 'ZONA 3' }),
    ];

    expect((await service.listar(1)).map((c) => c.nombre)).toEqual(['NAP1', 'NAP9', 'NAP10']);
    expect((await service.listar(1, 'zona 6')).map((c) => c.nombre)).toEqual(['NAP9', 'NAP10']);
  });

  it('el detalle encuentra la caja por su clave literal, con espacios, barras y pipe', async () => {
    onts = [ont('A', 'NAP53', 3)];

    const d = await service.detalle(1, '2/1/7|NAP 53');

    expect(d).toMatchObject({ clave: '2/1/7|NAP 53', nombre: 'NAP53', ocupados: 1 });
    expect(d.puertos[2].onts[0].numero_serie).toBe('A');
  });

  it('una clave que no existe en la empresa es 404', async () => {
    onts = [ont('A', 'NAP53', 3)];

    await expect(service.detalle(1, '2/1/7|NAP 99')).rejects.toBeInstanceOf(NotFoundException);
  });
});
