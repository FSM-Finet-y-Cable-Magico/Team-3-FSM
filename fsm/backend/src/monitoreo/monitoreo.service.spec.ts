// En ESM, Jest no inyecta los globals: hay que importarlos. Este archivo se
// escribio antes de que el runner soportara ESM, asi que nunca llego a
// ejecutarse y el `jest` global pasaba desapercibido.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { MonitoreoGateway } from './monitoreo.gateway.js';
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
  /** Lo que el dedupe encuentra ya guardado. Vacío = tabla recién purgada. */
  let yaGuardado: {
    id_registro_ont: number;
    estado_conexion: string | null;
    potencia: string | null;
    timestamp_medicion: Date;
  }[];

  beforeEach(async () => {
    monitoreoCreateMany = jest.fn(async () => ({ count: 1 }));
    historialCreateMany = jest.fn(async () => ({ count: 1 }));
    yaGuardado = [];

    const prismaMock = {
      monitoreo_ont: { createMany: monitoreoCreateMany },
      historial_conexion_ont: { createMany: historialCreateMany },
      // El dedupe consulta la ultima fila guardada de cada ONT del lote.
      $queryRaw: jest.fn(async () => yaGuardado),
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };

    const fuenteMock: FuenteMonitoreo = {
      nombre: 'test',
      listarOlts: jest.fn(async () => []),
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
        // El gateway se dobla: estas pruebas son de la ingesta y del
        // aislamiento, no del WebSocket. `publicar` se espia igual para poder
        // afirmar que la ingesta avisa, y que una consulta NO avisa.
        { provide: MonitoreoGateway, useValue: { publicar: jest.fn() } },
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

  // -------------------------------------------------------------------------
  // El dedupe. Es lo que impide que la tabla vuelva a llenar el disco: medido
  // sobre el respaldo de produccion, el 92,2% de las 394.799 filas eran
  // identicas a la anterior de su misma ONT.
  // -------------------------------------------------------------------------

  describe('no reescribe lo que ya esta guardado', () => {
    const MEDIDO = new Date('2026-09-28T14:00:00.000Z');

    it('omite la lectura identica a la ultima guardada', async () => {
      yaGuardado = [
        { id_registro_ont: 1, estado_conexion: 'ONLINE', potencia: '-21.50', timestamp_medicion: MEDIDO },
      ];
      lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21.5, estado: 'ONLINE', medido_en: MEDIDO }];

      const r = await service.ingestarLecturas();

      expect(r.leidas).toBe(1);
      expect(r.omitidas).toBe(1);
      expect(monitoreoCreateMany).toHaveBeenCalledWith({ data: [] });
    });

    it.each([
      ['cambia el estado', { estado_conexion: 'LOS' }],
      ['cambia la potencia', { potencia: '-28.00' }],
      ['cambia el timestamp', { timestamp_medicion: new Date('2026-09-28T15:00:00.000Z') }],
    ])('escribe cuando %s', async (_caso, distinto) => {
      yaGuardado = [
        {
          id_registro_ont: 1,
          estado_conexion: 'ONLINE',
          potencia: '-21.50',
          timestamp_medicion: MEDIDO,
          ...distinto,
        },
      ];
      lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21.5, estado: 'ONLINE', medido_en: MEDIDO }];

      const r = await service.ingestarLecturas();

      expect(r.omitidas).toBe(0);
      expect(monitoreoCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ id_registro_ont: 1 })] });
    });

    it('con la tabla vacia escribe todo: tras una purga o un reinicio no se pierde la lectura', async () => {
      yaGuardado = [];
      lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21.5, estado: 'ONLINE', medido_en: MEDIDO }];

      const r = await service.ingestarLecturas();

      expect(r.omitidas).toBe(0);
      expect(monitoreoCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ id_registro_ont: 1 })] });
    });

    it('compara la potencia por valor, no por como venga escrita', async () => {
      // La columna es Decimal(5,2) y vuelve como texto: "-21.50" es el mismo
      // numero que -21.5, y sin la conversion el dedupe no omitiria nada.
      yaGuardado = [
        { id_registro_ont: 1, estado_conexion: 'ONLINE', potencia: '-21.50', timestamp_medicion: MEDIDO },
      ];
      lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21.5, estado: 'ONLINE', medido_en: MEDIDO }];

      expect((await service.ingestarLecturas()).omitidas).toBe(1);
    });

    it('distingue una potencia nula de un cero', async () => {
      yaGuardado = [
        { id_registro_ont: 1, estado_conexion: 'LOS', potencia: null, timestamp_medicion: MEDIDO },
      ];
      lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: 0, estado: 'LOS', medido_en: MEDIDO }];

      expect((await service.ingestarLecturas()).omitidas).toBe(0);
    });

    it('omitir la escritura no impide historizar el cambio de estado', async () => {
      // El historial se lleva en memoria y la fila de monitoreo puede estar
      // repetida sin que el evento lo este: son dos decisiones separadas.
      lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: -21.5, estado: 'ONLINE', medido_en: MEDIDO }];
      await service.ingestarLecturas();

      yaGuardado = [
        { id_registro_ont: 1, estado_conexion: 'LOS', potencia: null, timestamp_medicion: MEDIDO },
      ];
      lecturas = [{ sn: 'SN-0001', potencia_rx_dbm: null, estado: 'LOS', medido_en: MEDIDO }];
      const r = await service.ingestarLecturas();

      expect(r.omitidas).toBe(1);
      expect(r.cambios_estado).toBe(1);
      expect(historialCreateMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ id_registro_ont: 1, evento: 'LOS' })],
      });
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
