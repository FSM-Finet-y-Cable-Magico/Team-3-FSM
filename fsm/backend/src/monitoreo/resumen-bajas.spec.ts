import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { MonitoreoService } from './monitoreo.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MonitoreoGateway } from './monitoreo.gateway.js';
import { FUENTE_MONITOREO } from './fuente/fuente-monitoreo.js';

/**
 * Los equipos de clientes dados de baja siguen en SmartOLT, OFFLINE para
 * siempre. En la base de FiNet son ~200 de ~970 ONT: contados como "fuera de
 * linea" inundaban el indicador y el listado. Se separan con la misma regla
 * del motor de alertas (`esInactiva`: caida hace mas de 7 dias).
 */
describe('resumen y listado de ONT · posibles bajas', () => {
  const dias = (n: number) => new Date(Date.now() - n * 86_400_000);
  const ont = (sn: string, estado: string, desde: Date, caidaEn?: Date, id_cliente: number | null = null) => ({
    numero_serie: sn,
    id_unidad: null,
    id_cliente,
    zona: 'ZONA 3',
    olt_externo: '2',
    nombre_cliente_ext: null,
    monitoreos: [{ estado_conexion: estado, potencia_actual_dbm: estado === 'ONLINE' ? -21 : null, timestamp_medicion: desde }],
    historial: caidaEn ? [{ evento: 'OFFLINE', timestamp: caidaEn }] : [],
  });
  const findMany = jest.fn(async (_a?: any) => [
    ont('A', 'ONLINE', dias(30)),
    ont('B', 'OFFLINE', dias(2)),
    ont('C', 'OFFLINE', dias(800)),
    // El evento de caida manda sobre la fecha de la lectura: se cayo ayer.
    ont('D', 'OFFLINE', dias(800), dias(1)),
  ]);
  const contratoFindMany = jest.fn(async (_a?: any) => [] as any[]);
  let service: MonitoreoService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        MonitoreoService,
        { provide: PrismaService, useValue: { registro_ont: { findMany }, contrato: { findMany: contratoFindMany } } },
        { provide: RegistroOntService, useValue: {} },
        { provide: FUENTE_MONITOREO, useValue: { nombre: 'test' } },
        { provide: MonitoreoGateway, useValue: { publicar: jest.fn() } },
      ],
    }).compile();
    service = mod.get(MonitoreoService);
  });

  it('marca como posible baja solo la caida hace mas de 7 dias', async () => {
    const l = await service.lecturasRecientes(1);
    expect(l.map((o) => [o.numero_serie, o.posible_baja])).toEqual([
      ['A', false],
      ['B', false],
      ['C', true],
      ['D', false],
    ]);
  });

  it('pide al historial solo el ultimo evento de caida', async () => {
    await service.lecturasRecientes(1);
    expect(findMany.mock.calls.at(-1)![0].include.historial).toEqual({
      where: { evento: { not: 'ONLINE' } },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });
  });

  it('el resumen cuenta las posibles bajas aparte y no las suma a fuera de linea', async () => {
    const r = await service.resumen(1);
    expect(r.total_ont).toBe(4);
    expect(r.posibles_bajas).toBe(1);
    expect(r.por_estado).toMatchObject({ ONLINE: 1, OFFLINE: 2 });
  });

  it('el cliente suspendido no es posible baja ni fuera de linea: se cuenta aparte', async () => {
    contratoFindMany.mockImplementation(async () => [{ id_cliente: 9, estado: 'Suspendido' }]);
    findMany.mockImplementation(async () => [
      ont('A', 'ONLINE', dias(30)),
      ont('S', 'OFFLINE', dias(800), undefined, 9),
    ]);

    const l = await service.lecturasRecientes(1);
    expect(l.find((o) => o.numero_serie === 'S')).toMatchObject({ suspendido: true, posible_baja: false });

    const r = await service.resumen(1);
    expect(r).toMatchObject({ suspendidos: 1, posibles_bajas: 0 });
    expect(r.por_estado).toMatchObject({ ONLINE: 1, OFFLINE: 0 });
  });
});
