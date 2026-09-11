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
      { id_caja_nap: 1, identificador_unico: 'NAP 1', zona: 'ZONA 3', latitud: null, longitud: null, capacidad_puertos: 16 },
      { id_caja_nap: 2, identificador_unico: 'NAP 2', zona: 'ZONA 7', latitud: null, longitud: null, capacidad_puertos: 16 },
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

  it('ordena por cantidad de gente afectada, no por porcentaje', async () => {
    // NAP 1: 6 criticos de 12 = 50%. NAP 2: 2 criticos de 2 = 100%.
    //
    // Es el caso que rompia la pantalla: 216 de las 262 cajas de FiNet tienen
    // menos de cinco ONT registradas y capacidad declarada de 16 puertos, asi
    // que ordenar por porcentaje llenaba todo con cajas de 2/2 al 100% --que
    // son las de padron incompleto-- y enterraba las que tienen seis clientes
    // caidos de verdad.
    estado = [
      ...Array.from({ length: 6 }, (_, i) => ont(i + 1, 1, 'LOS', null)),
      ...Array.from({ length: 6 }, (_, i) => ont(i + 7, 1, 'ONLINE', -21)),
      ont(13, 2, 'LOS', null), ont(14, 2, 'LOS', null),
    ];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas.map((c) => c.identificador_unico)).toEqual(['NAP 1', 'NAP 2']);
    expect(r.cajas[0]).toMatchObject({ criticos: 6, pct_afectado: 50 });
    expect(r.cajas[1]).toMatchObject({ criticos: 2, pct_afectado: 100 });
  });

  it('a igual cantidad de afectados, primero la proporcionalmente peor', async () => {
    // NAP 1: 2 de 4 = 50%. NAP 2: 2 de 2 = 100%.
    estado = [
      ont(1, 1, 'LOS', null), ont(2, 1, 'LOS', null),
      ont(3, 1, 'ONLINE', -21), ont(4, 1, 'ONLINE', -20),
      ont(5, 2, 'LOS', null), ont(6, 2, 'LOS', null),
    ];

    const r = await service.criticosPorCaja(1);

    expect(r.cajas.map((c) => c.identificador_unico)).toEqual(['NAP 2', 'NAP 1']);
  });

  it('marca las cajas de padron incompleto para no leer su 100% como firme', async () => {
    // Una caja de 16 puertos con 2 ONT conocidas no esta "caida al 100%": se
    // sabe de dos. Mismo criterio con el que CU-17 se niega a declararla caida.
    estado = [
      ont(1, 1, 'LOS', null), ont(2, 1, 'LOS', null),
      ...Array.from({ length: 5 }, (_, i) => ont(i + 3, 2, 'LOS', null)),
    ];

    const r = await service.criticosPorCaja(1);
    const porNombre = Object.fromEntries(r.cajas.map((c) => [c.identificador_unico, c]));

    expect(porNombre['NAP 1'].padron_chico).toBe(true);
    expect(porNombre['NAP 2'].padron_chico).toBe(false);
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

  // Los equipos de clientes dados de baja siguen en SmartOLT, OFFLINE para
  // siempre. El motor de RF-15 nunca los conto; este panel si, y por eso
  // mostraba cajas "100% afectadas" que no tenian un solo cliente activo.
  describe('equipos dados de baja', () => {
    const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

    it('no los cuenta como afectados ni como padron de la caja', async () => {
      // NAP 1: 4 equipos, 3 caidos hace meses (bajas) y 1 activo caido hoy.
      // Contando las bajas seria 4/4 = 100%. Sin ellas es 1/1 = 100%, pero
      // sobre un padron de uno: la caja queda marcada como padron chico.
      estado = [
        { ...ont(1, 1, 'OFFLINE', null), sin_senal_desde: hace(200) },
        { ...ont(2, 1, 'OFFLINE', null), sin_senal_desde: hace(180) },
        { ...ont(3, 1, 'OFFLINE', null), sin_senal_desde: hace(90) },
        { ...ont(4, 1, 'LOS', null), sin_senal_desde: hace(1) },
      ];
      const r = await service.criticosPorCaja(1);

      expect(r.cajas[0]).toMatchObject({
        id_caja_nap: 1,
        clientes_en_la_caja: 1,
        criticos: 1,
      });
    });

    it('saca del panel la caja que solo tiene bajas', async () => {
      // Todos sus equipos son de clientes que ya no estan: no hay incidente
      // que despachar, la caja no deberia aparecer.
      estado = [
        { ...ont(1, 1, 'OFFLINE', null), sin_senal_desde: hace(300) },
        { ...ont(2, 1, 'OFFLINE', null), sin_senal_desde: hace(300) },
        { ...ont(3, 2, 'LOS', null), sin_senal_desde: hace(1) },
      ];
      const r = await service.criticosPorCaja(1);

      expect(r.cajas.map((c: any) => c.id_caja_nap)).toEqual([2]);
    });

    it('una caida reciente si cuenta: la baja se define por antiguedad', async () => {
      estado = [
        { ...ont(1, 1, 'LOS', null), sin_senal_desde: hace(2) },
        { ...ont(2, 1, 'ONLINE', -21), sin_senal_desde: null },
      ];
      const r = await service.criticosPorCaja(1);

      expect(r.cajas[0]).toMatchObject({
        id_caja_nap: 1,
        clientes_en_la_caja: 2,
        criticos: 1,
        pct_afectado: 50,
      });
    });
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
