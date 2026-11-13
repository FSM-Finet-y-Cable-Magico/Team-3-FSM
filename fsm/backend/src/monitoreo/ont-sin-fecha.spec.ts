import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { esInactiva } from './reglas-alerta.js';
import { AlertasService } from './alertas.service.js';
import { MonitoreoService } from './monitoreo.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { MonitoreoGateway } from './monitoreo.gateway.js';
import { FUENTE_MONITOREO } from './fuente/fuente-monitoreo.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * SmartOLT manda algunas ONT sin `last_status_change` (63 de 946 el 13-11, todas
 * equipos de baja: nunca se vieron en linea). La ingesta las fecha en su
 * `primera_vez`. En una base nueva --la global de la VPS-- eso es HOY, asi que
 * durante 7 dias parecian caidas recientes: inflaban "fuera de linea" y el
 * motor les levantaba SIN_SENAL. Si SmartOLT nunca les registro un cambio,
 * llevan asi desde antes de que las vieramos: son posibles bajas desde ya.
 */
const AHORA = new Date('2026-11-13T19:30:00Z');

describe('ONT caida sin fecha de la fuente', () => {
  it('es posible baja desde el primer sondeo', () => {
    expect(esInactiva({ estado_conexion: 'OFFLINE', sin_senal_desde: AHORA, sin_fecha_de_fuente: true }, AHORA)).toBe(true);
  });

  it('una en linea sin fecha no es baja', () => {
    expect(esInactiva({ estado_conexion: 'ONLINE', sin_senal_desde: null, sin_fecha_de_fuente: true }, AHORA)).toBe(false);
  });

  it('cargarEstado marca la ONT sin evento cuya lectura quedo fechada en su primera vez', async () => {
    const fila = (id: number, sin_fecha: boolean) => ({
      id_registro_ont: id, numero_serie: `SN-${id}`, id_cliente: null, id_caja_nap: null, olt_externo: '2', board: 1,
      puerto_pon: 1, odb: 'NAP 24', odb_puerto: null, zona: 'ZONA 3', nombre_cliente_ext: null,
      estado_conexion: 'OFFLINE', potencia_dbm: null, sin_senal_desde: AHORA, sin_fecha,
    });
    const prisma = {
      $queryRaw: jest.fn(async () => [fila(1, true), fila(2, false)]),
      contrato: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;

    const r = await new AlertasService(prisma).cargarEstado(1);

    expect(r.map((o) => [o.id_registro_ont, o.sin_fecha_de_fuente])).toEqual([[1, true], [2, false]]);
  });

  it('la lista de ONT la muestra como posible baja; si alguna vez la vimos caer, no', async () => {
    const primera = new Date('2026-11-13T18:59:18Z');
    const ont = (sn: string, caidaEn?: Date) => ({
      numero_serie: sn, id_unidad: null, id_cliente: null, zona: 'ZONA 3', olt_externo: '2', nombre_cliente_ext: null,
      primera_vez: primera,
      monitoreos: [{ estado_conexion: 'OFFLINE', potencia_actual_dbm: null, timestamp_medicion: primera }],
      historial: caidaEn ? [{ evento: 'OFFLINE', timestamp: caidaEn }] : [],
    });
    const mod = await Test.createTestingModule({
      providers: [
        MonitoreoService,
        {
          provide: PrismaService,
          useValue: {
            registro_ont: { findMany: jest.fn(async () => [ont('FANTASMA'), ont('CAYO_HOY', new Date())]) },
            contrato: { findMany: jest.fn(async () => []) },
          },
        },
        { provide: RegistroOntService, useValue: {} },
        { provide: FUENTE_MONITOREO, useValue: { nombre: 'test' } },
        { provide: MonitoreoGateway, useValue: { publicar: jest.fn() } },
      ],
    }).compile();

    const l = await mod.get(MonitoreoService).lecturasRecientes(1);

    expect(l.map((o) => [o.numero_serie, o.posible_baja])).toEqual([['FANTASMA', true], ['CAYO_HOY', false]]);
  });
});
