import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { MonitoreoService } from './monitoreo.service.js';
import {
  FUENTE_MONITOREO,
  type FuenteMonitoreo,
  type LecturaOnt,
} from './fuente/fuente-monitoreo.js';

/**
 * Cubre lo riesgoso de la ingesta: el mapeo lectura→fila (con id_registro_ont)
 * y la detección de transición de estado (la 1ª lectura de una ONT no
 * historiza; el cambio posterior sí).
 */
describe('MonitoreoService.ingestarLecturas', () => {
  let service: MonitoreoService;
  let monitoreoCreateMany: jest.Mock;
  let historialCreateMany: jest.Mock;
  let lecturas: LecturaOnt[];

  beforeEach(async () => {
    monitoreoCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    historialCreateMany = jest.fn().mockResolvedValue({ count: 1 });

    const prismaMock = {
      monitoreo_ont: { createMany: monitoreoCreateMany },
      historial_conexion_ont: { createMany: historialCreateMany },
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };

    const fuenteMock: FuenteMonitoreo = {
      nombre: 'test',
      listarOlts: jest.fn(),
      listarOntDetalles: jest.fn(async () => []),
      listarLecturas: jest.fn(async () => lecturas),
    };

    // SN-0001 resuelve a una unidad; SN-9999 no.
    const registroMock = {
      asegurarRegistros: jest.fn(async (sns: string[]) => {
        const m = new Map();
        for (const sn of sns) {
          m.set(
            sn,
            sn === 'SN-0001'
              ? { id_registro_ont: 1, id_unidad: 10, id_cliente: 5, id_caja_nap: 2 }
              : { id_registro_ont: 2, id_unidad: null, id_cliente: null, id_caja_nap: null },
          );
        }
        return m;
      }),
      enriquecer: jest.fn(async () => 0),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        MonitoreoService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RegistroOntService, useValue: registroMock },
        { provide: FUENTE_MONITOREO, useValue: fuenteMock },
      ],
    }).compile();

    service = mod.get(MonitoreoService);
  });

  it('mapea la lectura a monitoreo_ont con id_registro_ont y enlaces resueltos', async () => {
    lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21.5, estado: 'ONLINE', medido_en: new Date() }];

    const r = await service.ingestarLecturas();

    expect(r.leidas).toBe(1);
    expect(r.sin_unidad).toBe(0);
    expect(monitoreoCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id_registro_ont: 1,
          id_unidad: 10,
          id_cliente: 5,
          potencia_actual_dbm: -21.5,
          estado_conexion: 'ONLINE',
        }),
      ],
    });
  });

  it('no historiza la primera lectura, sí la transición posterior', async () => {
    lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21, estado: 'ONLINE', medido_en: new Date() }];
    const r1 = await service.ingestarLecturas();
    expect(r1.cambios_estado).toBe(0);
    expect(historialCreateMany).not.toHaveBeenCalled();

    lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: null, estado: 'LOS', medido_en: new Date() }];
    const r2 = await service.ingestarLecturas();
    expect(r2.cambios_estado).toBe(1);
    expect(historialCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id_registro_ont: 1, id_unidad: 10, evento: 'LOS' })],
    });
  });

  it('historiza también la transición de una ONT sin unidad (por id_registro_ont)', async () => {
    lecturas = [{ sn: 'SN-9999', potencia_rx_dbm: -20, estado: 'ONLINE', medido_en: new Date() }];
    const r1 = await service.ingestarLecturas();
    expect(r1.sin_unidad).toBe(1);

    lecturas = [{ sn: 'SN-9999', potencia_rx_dbm: null, estado: 'OFFLINE', medido_en: new Date() }];
    const r2 = await service.ingestarLecturas();
    expect(r2.cambios_estado).toBe(1);
    expect(historialCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id_registro_ont: 2, id_unidad: null, evento: 'OFFLINE' })],
    });
  });
});
