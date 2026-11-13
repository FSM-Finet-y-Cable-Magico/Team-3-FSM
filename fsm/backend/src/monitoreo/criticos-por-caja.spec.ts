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
 *
 * La caja es la de SmartOLT (`odb_name` + puerto PON), no la del KML de Tomodat:
 * el panel tiene que nombrar la caja igual que la ve el tecnico en SmartOLT, y
 * agrupar igual que el motor de alertas para no contradecirlo.
 */
describe('CU-15 · clientes criticos por caja', () => {
  let service: AlertasService;
  let estado: any[];

  const queryRaw = jest.fn(async () => estado);
  const cajaFindMany = jest.fn(async () => []);

  // Zona de SmartOLT de cada caja de prueba, para no repetirla en cada fila.
  const ZONA: Record<string, string> = { 'NAP 1': 'ZONA 3', 'NAP 2': 'ZONA 7' };

  // Atajo para armar una fila de las que lee `cargarEstado`. `odb` es el nombre
  // de caja tal como lo escribio el instalador en SmartOLT.
  const ont = (
    id: number,
    odb: string | null,
    estadoConexion: string,
    dbm: number | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id_registro_ont: id,
    numero_serie: `SN-${id}`,
    id_cliente: null,
    id_caja_nap: null,
    olt_externo: '2',
    board: 1,
    puerto_pon: 7,
    odb,
    zona: odb ? (ZONA[odb] ?? null) : null,
    nombre_cliente_ext: `Cliente ${id}`,
    estado_conexion: estadoConexion,
    potencia_dbm: dbm,
    sin_senal_desde: null,
    ...extra,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
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
      ont(1, 'NAP 1', 'LOS', null), ont(2, 'NAP 1', 'LOS', null), ont(3, 'NAP 1', 'OFFLINE', null), ont(4, 'NAP 1', 'ONLINE', -21),
      ont(5, 'NAP 2', 'LOS', null), ont(6, 'NAP 2', 'ONLINE', -21), ont(7, 'NAP 2', 'ONLINE', -20), ont(8, 'NAP 2', 'ONLINE', -22),
    ];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas).toHaveLength(2);
    expect(r.cajas[0]).toMatchObject({ nombre: 'NAP 1', criticos: 3, pct_afectado: 75 });
    expect(r.cajas[1]).toMatchObject({ nombre: 'NAP 2', criticos: 1, pct_afectado: 25 });
  });

  describe('la caja es la de SmartOLT', () => {
    it('no consulta las cajas del KML de Tomodat', async () => {
      estado = [ont(1, 'NAP 1', 'LOS', null)];

      await service.criticosPorCaja(1);

      expect(cajaFindMany).not.toHaveBeenCalled();
    });

    it('usa la misma clave que el motor de alertas: puerto PON + nombre', async () => {
      estado = [ont(1, 'NAP 1', 'LOS', null)];

      const r = await service.criticosPorCaja(1);

      expect(r.cajas[0]).toMatchObject({
        clave: '2/1/7|NAP 1',
        olt_externo: '2',
        board: 1,
        puerto_pon: 7,
      });
    });

    it('junta las grafias de una misma caja del mismo puerto PON', async () => {
      // "NAP53" y "NAP 53" en el mismo splitter son la misma caja escrita por
      // dos instaladores distintos. Se muestra la grafia mas usada.
      estado = [
        ont(1, 'NAP53', 'LOS', null),
        ont(2, 'NAP53', 'ONLINE', -21),
        ont(3, 'NAP 53', 'LOS', null),
      ];

      const r = await service.criticosPorCaja(1);

      expect(r.cajas).toHaveLength(1);
      expect(r.cajas[0]).toMatchObject({ nombre: 'NAP53', clientes_en_la_caja: 3, criticos: 2 });
    });

    it('separa cajas homonimas de puertos PON distintos', async () => {
      // FiNet tiene varias "NAP 5" en barrios distintos: juntarlas mezclaria
      // clientes que no comparten nada fisico.
      estado = [
        ont(1, 'NAP 5', 'LOS', null, { puerto_pon: 3 }),
        ont(2, 'NAP 5', 'LOS', null, { puerto_pon: 9 }),
      ];

      const r = await service.criticosPorCaja(1);

      expect(r.cajas.map((c) => c.clave).sort()).toEqual(['2/1/3|NAP 5', '2/1/9|NAP 5']);
    });

    it('toma la zona de SmartOLT, la mas frecuente de sus ONT', async () => {
      estado = [
        ont(1, 'NAP 1', 'LOS', null, { zona: 'ZONA 6' }),
        ont(2, 'NAP 1', 'ONLINE', -21, { zona: 'ZONA 6' }),
        ont(3, 'NAP 1', 'ONLINE', -21, { zona: 'ZONA 5' }),
      ];

      const r = await service.criticosPorCaja(1);

      expect(r.cajas[0].zona).toBe('ZONA 6');
    });

    it('devuelve las ONT criticas de la caja para desplegarlas en la fila', async () => {
      estado = [
        ont(1, 'NAP 1', 'LOS', null),
        ont(2, 'NAP 1', 'ONLINE', -30),
        ont(3, 'NAP 1', 'ONLINE', -21),
      ];

      const r = await service.criticosPorCaja(1);

      expect(r.cajas[0].onts_criticas).toEqual([
        { numero_serie: 'SN-1', nombre_cliente: 'Cliente 1', estado_conexion: 'LOS', potencia_dbm: null },
        { numero_serie: 'SN-2', nombre_cliente: 'Cliente 2', estado_conexion: 'ONLINE', potencia_dbm: -30 },
      ]);
    });
  });

  it('ordena por cantidad de gente afectada, no por porcentaje', async () => {
    // NAP 1: 6 criticos de 12 = 50%. NAP 2: 2 criticos de 2 = 100%.
    //
    // Es el caso que rompia la pantalla: la mayoria de las cajas tienen menos
    // de cinco ONT registradas, asi que ordenar por porcentaje llenaba todo
    // con cajas de 2/2 al 100% --que son las de padron incompleto-- y
    // enterraba las que tienen seis clientes caidos de verdad.
    estado = [
      ...Array.from({ length: 6 }, (_, i) => ont(i + 1, 'NAP 1', 'LOS', null)),
      ...Array.from({ length: 6 }, (_, i) => ont(i + 7, 'NAP 1', 'ONLINE', -21)),
      ont(13, 'NAP 2', 'LOS', null), ont(14, 'NAP 2', 'LOS', null),
    ];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas.map((c) => c.nombre)).toEqual(['NAP 1', 'NAP 2']);
    expect(r.cajas[0]).toMatchObject({ criticos: 6, pct_afectado: 50 });
    expect(r.cajas[1]).toMatchObject({ criticos: 2, pct_afectado: 100 });
  });

  it('a igual cantidad de afectados, primero la proporcionalmente peor', async () => {
    // NAP 1: 2 de 4 = 50%. NAP 2: 2 de 2 = 100%.
    estado = [
      ont(1, 'NAP 1', 'LOS', null), ont(2, 'NAP 1', 'LOS', null),
      ont(3, 'NAP 1', 'ONLINE', -21), ont(4, 'NAP 1', 'ONLINE', -20),
      ont(5, 'NAP 2', 'LOS', null), ont(6, 'NAP 2', 'LOS', null),
    ];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas.map((c) => c.nombre)).toEqual(['NAP 2', 'NAP 1']);
  });

  it('marca las cajas de padron incompleto para no leer su 100% como firme', async () => {
    // Una caja con 2 ONT conocidas no esta "caida al 100%": se sabe de dos.
    // Mismo criterio con el que CU-17 se niega a declararla caida.
    estado = [
      ont(1, 'NAP 1', 'LOS', null), ont(2, 'NAP 1', 'LOS', null),
      ...Array.from({ length: 5 }, (_, i) => ont(i + 3, 'NAP 2', 'LOS', null)),
    ];

    const r = await service.criticosPorCaja(1);
    const porNombre = Object.fromEntries(r.cajas.map((c) => [c.nombre, c]));

    expect(porNombre['NAP 1'].padron_chico).toBe(true);
    expect(porNombre['NAP 2'].padron_chico).toBe(false);
  });

  it('separa los caidos de los que tienen potencia fuera de rango', async () => {
    // -30 dBm esta fuera del rango operativo (-24 a -19) pero la ONT responde.
    estado = [ont(1, 'NAP 1', 'LOS', null), ont(2, 'NAP 1', 'ONLINE', -30), ont(3, 'NAP 1', 'ONLINE', -21)];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas[0]).toMatchObject({ criticos: 2, sin_senal: 1, potencia_fuera_de_rango: 1 });
  });

  it('NO cuenta la franja preventiva como critica', async () => {
    // -23 dBm esta degradandose pero DENTRO del rango: el cliente tiene
    // servicio. Contarlo aca inflaria el panel con gente que no hay que ir a
    // ver hoy, y ya tiene su propia alerta preventiva.
    estado = [ont(1, 'NAP 1', 'ONLINE', -23), ont(2, 'NAP 1', 'ONLINE', -21)];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas).toHaveLength(0);
    expect(r.totales.clientes_criticos).toBe(0);
  });

  // Los equipos de clientes dados de baja siguen en SmartOLT, OFFLINE para
  // siempre. El motor de RF-15 nunca los conto; este panel si, y por eso
  // mostraba cajas "100% afectadas" que no tenian un solo cliente activo.
  describe('equipos dados de baja', () => {
    const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

    it('no los cuenta como afectados ni como padron de la caja', async () => {
      // NAP 1: 4 equipos, 3 caidos hace meses (bajas) y 1 activo caido hoy.
      estado = [
        ont(1, 'NAP 1', 'OFFLINE', null, { sin_senal_desde: hace(200) }),
        ont(2, 'NAP 1', 'OFFLINE', null, { sin_senal_desde: hace(180) }),
        ont(3, 'NAP 1', 'OFFLINE', null, { sin_senal_desde: hace(90) }),
        ont(4, 'NAP 1', 'LOS', null, { sin_senal_desde: hace(1) }),
      ];
      const r = await service.criticosPorCaja(1);

      expect(r.cajas[0]).toMatchObject({ nombre: 'NAP 1', clientes_en_la_caja: 1, criticos: 1 });
    });

    it('saca del panel la caja que solo tiene bajas', async () => {
      estado = [
        ont(1, 'NAP 1', 'OFFLINE', null, { sin_senal_desde: hace(300) }),
        ont(2, 'NAP 1', 'OFFLINE', null, { sin_senal_desde: hace(300) }),
        ont(3, 'NAP 2', 'LOS', null, { sin_senal_desde: hace(1) }),
      ];
      const r = await service.criticosPorCaja(1);

      expect(r.cajas.map((c) => c.nombre)).toEqual(['NAP 2']);
    });

    it('una caida reciente si cuenta: la baja se define por antiguedad', async () => {
      estado = [
        ont(1, 'NAP 1', 'LOS', null, { sin_senal_desde: hace(2) }),
        ont(2, 'NAP 1', 'ONLINE', -21),
      ];
      const r = await service.criticosPorCaja(1);

      expect(r.cajas[0]).toMatchObject({ clientes_en_la_caja: 2, criticos: 1, pct_afectado: 50 });
    });
  });

  it('deja fuera las cajas sin ningun critico', async () => {
    estado = [ont(1, 'NAP 1', 'ONLINE', -21), ont(2, 'NAP 2', 'LOS', null)];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas.map((c) => c.nombre)).toEqual(['NAP 2']);
  });

  it('cuenta aparte los criticos sin nombre de caja en SmartOLT', async () => {
    // Una ONT sin `odb_name` no tiene caja segun SmartOLT, aunque el ligado le
    // haya encontrado una del KML. Esconderla daria un total que no cuadra.
    estado = [
      ont(1, 'NAP 1', 'LOS', null),
      ont(2, null, 'LOS', null, { id_caja_nap: 99 }),
      ont(3, '  ', 'LOS', null),
      ont(4, null, 'ONLINE', -21),
    ];

    const r = await service.criticosPorCaja(1);

    expect(r.totales).toMatchObject({
      cajas_afectadas: 1,
      clientes_criticos: 1,
      criticos_sin_caja: 2,
    });
  });

  it('filtra por zona cuando se pide', async () => {
    estado = [ont(1, 'NAP 1', 'LOS', null), ont(2, 'NAP 2', 'LOS', null)];

    const r = await service.criticosPorCaja(1, 'zona 7');

    expect(r.cajas).toHaveLength(1);
    expect(r.cajas[0].zona).toBe('ZONA 7');
  });
});
