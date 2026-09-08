import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AlertasService } from './alertas.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-15 / RF-13: panel consolidado de clientes criticos por caja NAP.
 *
 * Lo que se prueba es la AGRUPACION, que es donde estan las decisiones: que se
 * agrupe por caja y no por cliente suelto, que el porcentaje afectado sea el que
 * decide si mandar una cuadrilla, y que los criticos sin caja no se escondan.
 */
describe('CU-15 · clientes criticos por caja', () => {
  let service: AlertasService;
  let estado: any[];
  let cajas: any[];

  const queryRaw = jest.fn(async () => estado);
  const cajaFindMany = jest.fn(async () => cajas);

  // Atajo para armar una ONT del estado que devuelve `cargarEstado`.
  const ont = (id: number, caja: number | null, estadoConexion: string, dbm: number | null) => ({
    id_registro_ont: id,
    numero_serie: `SN-${id}`,
    id_cliente: null,
    id_caja_nap: caja,
    olt_externo: '2',
    board: 1,
    puerto_pon: 7,
    caja_normalizada: caja == null ? null : `NAP ${caja}`,
    estado_conexion: estadoConexion,
    potencia_dbm: dbm,
    sin_senal_desde: null,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    cajas = [
      { id_caja_nap: 1, identificador_unico: 'NAP 1', zona: 'ZONA 3', latitud: null, longitud: null },
      { id_caja_nap: 2, identificador_unico: 'NAP 2', zona: 'ZONA 7', latitud: null, longitud: null },
    ];
    const mod = await Test.createTestingModule({
      providers: [
        AlertasService,
        {
          provide: PrismaService,
          useValue: { $queryRaw: queryRaw, caja_nap: { findMany: cajaFindMany } },
        },
      ],
    }).compile();
    service = mod.get(AlertasService);
  });

  it('agrupa por caja y calcula el porcentaje afectado', async () => {
    // NAP 1: 3 de 4 caidos = 75%. NAP 2: 1 de 4 = 25%.
    estado = [
      ont(1, 1, 'LOS', null), ont(2, 1, 'LOS', null), ont(3, 1, 'OFFLINE', null), ont(4, 1, 'ONLINE', -21),
      ont(5, 2, 'LOS', null), ont(6, 2, 'ONLINE', -21), ont(7, 2, 'ONLINE', -20), ont(8, 2, 'ONLINE', -22),
    ];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas).toHaveLength(2);
    expect(r.cajas[0]).toMatchObject({ identificador_unico: 'NAP 1', criticos: 3, pct_afectado: 75 });
    expect(r.cajas[1]).toMatchObject({ identificador_unico: 'NAP 2', criticos: 1, pct_afectado: 25 });
  });

  it('ordena por caja mas comprometida, que es el orden en que se despacha', async () => {
    estado = [
      ont(1, 1, 'ONLINE', -21), ont(2, 1, 'LOS', null),
      ont(3, 2, 'LOS', null), ont(4, 2, 'LOS', null),
    ];

    const r = await service.criticosPorCaja(1);

    // NAP 2 esta al 100% y NAP 1 al 50%: primero la que esta peor.
    expect(r.cajas.map((c) => c.identificador_unico)).toEqual(['NAP 2', 'NAP 1']);
  });

  it('separa los caidos de los que tienen potencia fuera de rango', async () => {
    // -30 dBm esta fuera del rango operativo (-24 a -19) pero la ONT responde.
    estado = [ont(1, 1, 'LOS', null), ont(2, 1, 'ONLINE', -30), ont(3, 1, 'ONLINE', -21)];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas[0]).toMatchObject({ criticos: 2, sin_senal: 1, potencia_fuera_de_rango: 1 });
  });

  it('NO cuenta la franja preventiva como critica', async () => {
    // -23 dBm esta degradandose pero DENTRO del rango: el cliente tiene
    // servicio. Contarlo aca inflaria el panel con gente que no hay que ir a
    // ver hoy, y ya tiene su propia alerta preventiva.
    estado = [ont(1, 1, 'ONLINE', -23), ont(2, 1, 'ONLINE', -21)];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas).toHaveLength(0);
    expect(r.totales.clientes_criticos).toBe(0);
  });

  it('deja fuera las cajas sin ningun critico', async () => {
    estado = [ont(1, 1, 'ONLINE', -21), ont(2, 2, 'LOS', null)];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas.map((c) => c.identificador_unico)).toEqual(['NAP 2']);
  });

  it('cuenta aparte los criticos que no se pudieron atribuir a una caja', async () => {
    // 215 de las 940 ONT reales no tienen caja resuelta. Esconderlas daria un
    // total que no cuadra con el resto del panel.
    estado = [ont(1, 1, 'LOS', null), ont(2, null, 'LOS', null), ont(3, null, 'ONLINE', -21)];

    const r = await service.criticosPorCaja(1);

    expect(r.totales).toMatchObject({
      cajas_afectadas: 1,
      clientes_criticos: 1,
      criticos_sin_caja: 1,
    });
  });

  it('filtra por zona cuando se pide', async () => {
    estado = [ont(1, 1, 'LOS', null), ont(2, 2, 'LOS', null)];

    const r = await service.criticosPorCaja(1, 'zona 7');

    expect(r.cajas).toHaveLength(1);
    expect(r.cajas[0].zona).toBe('ZONA 7');
  });
});
