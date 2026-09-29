import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MonitoreoService } from './monitoreo.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { FUENTE_MONITOREO } from './fuente/fuente-monitoreo.js';
import { MonitoreoGateway } from './monitoreo.gateway.js';

/** CU-14: el historial de una ONT en un periodo, con sus interrupciones. */
describe('interrupciones de una ONT (CU-14)', () => {
  const registro = { id_registro_ont: 9, numero_serie: 'ZTEG1234', id_empresa: 1, nombre_cliente_ext: 'Ana Soto' };
  const findUnique = jest.fn(async (_a: any): Promise<any> => registro);
  const findFirst = jest.fn(async (_a: any): Promise<any> => ({ evento: 'ONLINE' }));
  const findMany = jest.fn(async (_a: any): Promise<any[]> => [
    { evento: 'LOS', timestamp: new Date('2026-09-20T13:00:00Z') },
    { evento: 'ONLINE', timestamp: new Date('2026-09-20T13:04:00Z') },
  ]);
  let service: MonitoreoService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        MonitoreoService,
        {
          provide: PrismaService,
          useValue: { registro_ont: { findUnique }, historial_conexion_ont: { findFirst, findMany } },
        },
        { provide: RegistroOntService, useValue: {} },
        { provide: FUENTE_MONITOREO, useValue: {} },
        { provide: MonitoreoGateway, useValue: { publicar: jest.fn() } },
      ],
    }).compile();
    service = mod.get(MonitoreoService);
  });

  const ahora = new Date('2026-09-29T15:00:00Z');

  it('por defecto mira los ultimos 30 dias', async () => {
    const r = await service.interrupcionesOnt('ZTEG1234', 1, {}, ahora);

    expect(r.periodo).toEqual({ desde: new Date('2026-08-30T15:00:00Z'), hasta: ahora });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { id_registro_ont: 9, timestamp: { gte: new Date('2026-08-30T15:00:00Z'), lt: ahora } },
      orderBy: { timestamp: 'asc' },
    });
    // El estado con el que se entra al periodo sale del ultimo evento anterior.
    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: { id_registro_ont: 9, timestamp: { lt: new Date('2026-08-30T15:00:00Z') } },
      orderBy: { timestamp: 'desc' },
    });
    expect(r.interrupciones).toHaveLength(1);
    expect(r.indicadores.total).toBe(1);
    expect(r.eventos).toHaveLength(2);
  });

  it('acepta un periodo personalizado, con hasta inclusivo', async () => {
    const r = await service.interrupcionesOnt('ZTEG1234', 1, { desde: '2026-09-20', hasta: '2026-09-21' }, ahora);
    expect(r.periodo.desde.toISOString()).toBe('2026-09-20T03:00:00.000Z');
    expect(r.periodo.hasta.toISOString()).toBe('2026-09-22T03:00:00.000Z');
  });

  it('rechaza periodos invertidos, mal escritos o de mas de 90 dias', async () => {
    await expect(service.interrupcionesOnt('ZTEG1234', 1, { desde: '2026-09-21', hasta: '2026-09-20' }, ahora))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.interrupcionesOnt('ZTEG1234', 1, { desde: 'ayer' }, ahora))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.interrupcionesOnt('ZTEG1234', 1, { desde: '2026-01-01', hasta: '2026-09-01' }, ahora))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 si la ONT es de otra empresa, igual que si no existe', async () => {
    await expect(service.interrupcionesOnt('ZTEG1234', 2, {}, ahora)).rejects.toBeInstanceOf(NotFoundException);
    findUnique.mockResolvedValueOnce(null);
    await expect(service.interrupcionesOnt('NOEXISTE', 1, {}, ahora)).rejects.toBeInstanceOf(NotFoundException);
  });
});
