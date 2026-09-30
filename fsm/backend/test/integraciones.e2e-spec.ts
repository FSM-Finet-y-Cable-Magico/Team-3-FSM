import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { FAN_OUT_CIERRE } from '../src/ordenes/fan-out/fan-out-cierre.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Pruebas de CARACTERIZACION de `/api/integraciones/*`.
 *
 * El modulo no tenia ninguna hasta ahora, y es el que consumen G1 y G8 por
 * contrato: cada endpoint de aca es una promesa escrita en el acuerdo de
 * integracion. El P0-c agrega la correlacion al payload de cierre tocando
 * justo estos archivos, asi que primero se fija el comportamiento actual y
 * despues se cambia encima.
 *
 * No describen lo que el modulo DEBERIA hacer sino lo que HACE hoy. Si alguna
 * cae, la pregunta no es "esta mal la prueba" sino "quien depende de esto".
 *
 * El arnes es el de `ordenes.e2e-spec.ts`: guards, DTO y controladores reales,
 * doble solo en la persistencia. La autorizacion nunca se sustituye — es
 * precisamente lo que se esta probando.
 */

const CLAVE_G1 = 'clave-de-prueba-g1';
const CLAVE_G8 = 'clave-de-prueba-g8';

// G1 solo ve la empresa 1; G8 ve la 1 y la 2. La tercera entrada trae ":"
// dentro de la clave: el guard la ignora y avisa al arrancar, en vez de
// registrarla truncada y dejar la integracion muerta con un 403 mudo.
const CLAVES = [
  `G1:${CLAVE_G1}:1`,
  `G8:${CLAVE_G8}:1,2`,
  'ROTA:clave:con:dos-puntos:1',
].join(';');

const OT_CERRADA = {
  id_ot: 41,
  id_empresa: 1,
  tipo_ot: 'REPARACION',
  estado: 'COMPLETADA',
  id_tecnico: 35,
  fecha_completada: new Date('2026-09-20T15:00:00.000Z'),
  fecha_creacion: new Date('2026-09-19T09:00:00.000Z'),
  potencia_optica_dbm: { toString: () => '-21.5' },
  resuelto_remotamente: false,
  categoria_falla_otro: null,
  cierre_equipos: null,
  cliente: { rut: '11111111-1', nombre_completo: 'Ana Soto' },
  direccion: { direccion_completa: 'Av. Ejemplo 123', comuna: 'La Pintana' },
  categoria_falla: { id_categoria: 3, nombre: 'Falla de planta externa' },
  materiales: [{ id_tipo_equipo: 7, cantidad: 2 }],
  llamada: { resultado: 'CONFORME' },
};

/**
 * OT en estados distintos de COMPLETADA. El P0-b existe justamente para esto:
 * el CRM tiene que poder mostrar el avance antes de que la OT termine.
 */
const OT_EN_CURSO = {
  id_ot: 60,
  id_empresa: 1,
  tipo_ot: 'INSTALACION',
  prioridad: 'MEDIA',
  estado: 'EN_CURSO',
  fecha_creacion: new Date('2026-09-25T10:00:00.000Z'),
  fecha_programada: new Date('2026-09-26T14:00:00.000Z'),
  fecha_completada: null,
  tecnico: { id_usuario: 14, nombre_completo: 'Pedro Soto' },
};

const OT_SIN_TECNICO = {
  ...OT_EN_CURSO,
  id_ot: 61,
  estado: 'PENDIENTE',
  fecha_programada: null,
  tecnico: null,
};

/** OT de otra empresa, para comprobar que el filtro por empresa aisla de verdad. */
const OT_OTRA_EMPRESA = { ...OT_EN_CURSO, id_ot: 70, id_empresa: 2 };

const TODAS = [OT_CERRADA, OT_EN_CURSO, OT_SIN_TECNICO, OT_OTRA_EMPRESA];

/** Ultimo `where` que recibio cada consulta, para mirar como se arma el filtro. */
let ultimoWhereOrdenes: Record<string, unknown> | undefined;
let ultimosArgsFindMany: Record<string, unknown> | undefined;

const prisma = {
  $connect: async () => undefined,
  $disconnect: async () => undefined,
  orden_trabajo: {
    findMany: jest.fn(async (args: Prisma.orden_trabajoFindManyArgs = {}) => {
      ultimoWhereOrdenes = args.where as Record<string, unknown>;
      ultimosArgsFindMany = args as unknown as Record<string, unknown>;
      return [{ id_ot: 41, tipo_ot: 'REPARACION', estado: 'COMPLETADA' }];
    }),
    count: jest.fn(async () => 1),
    // Honra `estado` cuando viene: `cierre` exige COMPLETADA y `orden` no.
    // Un doble que lo ignorara dejaria pasar el 404 del cierre sin probarlo.
    findFirst: jest.fn(async ({ where }: Prisma.orden_trabajoFindFirstArgs = {}) =>
      TODAS.find(
        (o) =>
          o.id_ot === where?.id_ot &&
          o.id_empresa === where?.id_empresa &&
          (where?.estado === undefined || o.estado === where.estado),
      ) ?? null,
    ),
  },
  cliente: {
    findFirst: jest.fn(async ({ where }: Prisma.clienteFindFirstArgs = {}) =>
      where?.rut === '11111111-1'
        ? { id_cliente: 1, rut: '11111111-1', nombre_completo: 'Ana Soto', direcciones: [] }
        : null,
    ),
    findMany: jest.fn(async () => [{ id_cliente: 1, rut: '11111111-1', nombre_completo: 'Ana Soto' }]),
  },
  categoria_falla: {
    findMany: jest.fn(async () => [{ id_categoria: 3, nombre: 'Falla de planta externa', sla_horas: 8 }]),
  },
};

describe('API de integraciones: contrato con G1 y G8', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const api = () => request(app.getHttpServer());
  /** GET con clave de API. `null` manda la peticion sin el header. */
  const get = (ruta: string, clave: string | null = CLAVE_G1) => {
    const req = api().get('/api/integraciones' + ruta);
    return clave === null ? req : req.set('X-API-KEY', clave);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_SECRET: process.env.JWT_SECRET,
          JWT_EXPIRES_IN: '8h',
          FRONTEND_URL: 'http://127.0.0.1:5173',
          CLOUDINARY_CLOUD_NAME: '',
          CLOUDINARY_API_KEY: '',
          CLOUDINARY_API_SECRET: '',
          INTEGRACION_API_KEYS: CLAVES,
        }),
      )
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(FAN_OUT_CIERRE)
      .useValue({ nombre: 'doble', notificar: jest.fn(async () => {}) })
      .overrideProvider(AuthService)
      .useValue({ login: async () => ({ access_token: 'prueba' }) })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwt = app.get(JwtService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ultimoWhereOrdenes = undefined;
    ultimosArgsFindMany = undefined;
  });

  afterAll(async () => {
    await app?.close();
  });

  // -------------------------------------------------------------------------
  // ApiKeyGuard
  // -------------------------------------------------------------------------
  describe('ApiKeyGuard', () => {
    it('sin el header X-API-KEY responde 401', async () => {
      const res = await get('/ordenes?id_empresa=1', null).expect(401);

      expect(res.body.message).toBe('Falta el header X-API-KEY');
    });

    it('con una clave desconocida responde 401', async () => {
      const res = await get('/ordenes?id_empresa=1', 'clave-que-no-existe').expect(401);

      expect(res.body.message).toBe('X-API-KEY inválida');
    });

    it('un JWT valido NO reemplaza a la clave de API', async () => {
      // Estos endpoints van con @Public(), que apaga el JwtAuthGuard global.
      // Un token de usuario no abre nada aca: la unica credencial es la clave.
      const token = jwt.sign({ userId: 7, rol: 'ADMIN', id_empresa: 1 });

      await api()
        .get('/api/integraciones/ordenes?id_empresa=1')
        .auth(token, { type: 'bearer' })
        .expect(401);
    });

    it('ignora la entrada de configuracion cuya clave trae ":"', async () => {
      // 'ROTA:clave:con:dos-puntos:1' parte en 5 campos y no se registra.
      // Si alguna vez se registrara truncada, esta clave abriria la puerta.
      await get('/ordenes?id_empresa=1', 'clave').expect(401);
    });

    it('acepta la clave valida y deja pasar', async () => {
      await get('/ordenes?id_empresa=1', CLAVE_G1).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // Scope por empresa
  // -------------------------------------------------------------------------
  describe('scope por empresa', () => {
    it('G1 no puede leer una empresa fuera de su scope', async () => {
      const res = await get('/ordenes?id_empresa=2', CLAVE_G1).expect(403);

      // El mensaje nombra al grupo: sin eso, depurar del otro lado es a ciegas.
      expect(res.body.message).toContain('G1');
      expect(res.body.message).toContain('2');
    });

    it('G8 si puede leer la empresa 2, que esta en su scope', async () => {
      await get('/ordenes?id_empresa=2', CLAVE_G8).expect(200);

      expect(ultimoWhereOrdenes).toMatchObject({ id_empresa: 2 });
    });

    it('sin id_empresa responde 400 y no consulta la base', async () => {
      await get('/ordenes', CLAVE_G1).expect(400);

      expect(prisma.orden_trabajo.findMany).not.toHaveBeenCalled();
    });

    it('con id_empresa no numerico responde 400', async () => {
      await get('/ordenes?id_empresa=abc', CLAVE_G1).expect(400);
    });

    it.each([
      ['/ordenes?id_empresa=2', 'listado de OT'],
      ['/ordenes/cierres?id_empresa=2&desde=2026-09-01&hasta=2026-09-02', 'cierres'],
      ['/ordenes/41/cierre?id_empresa=2', 'cierre puntual'],
      ['/clientes/rut/11111111-1?id_empresa=2', 'cliente por RUT'],
      ['/clientes?id_empresa=2&busqueda=ana', 'busqueda de clientes'],
    ])('%s valida el scope antes de responder (%s)', async (ruta) => {
      await get(ruta, CLAVE_G1).expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Envoltorio
  // -------------------------------------------------------------------------
  describe('envoltorio { success, data }', () => {
    it.each([
      '/ordenes?id_empresa=1',
      '/ordenes/cierres?id_empresa=1&desde=2026-09-01&hasta=2026-09-02',
      '/ordenes/41/cierre?id_empresa=1',
      '/categorias-falla',
      '/estados-equipo',
      '/clientes/rut/11111111-1?id_empresa=1',
      '/clientes?id_empresa=1&busqueda=ana',
    ])('GET %s envuelve la respuesta', async (ruta) => {
      const res = await get(ruta, CLAVE_G1).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('data');
      // El envoltorio tiene exactamente dos llaves: G1 y G8 leen `data` y nada
      // mas. Agregar una tercera arriba es un cambio de contrato.
      expect(Object.keys(res.body).sort()).toEqual(['data', 'success']);
    });

    it('un error NO viaja envuelto: va con la forma de Nest', async () => {
      const res = await get('/ordenes?id_empresa=2', CLAVE_G1).expect(403);

      expect(res.body.success).toBeUndefined();
      expect(res.body).toMatchObject({ statusCode: 403 });
    });
  });

  // -------------------------------------------------------------------------
  // GET /ordenes
  // -------------------------------------------------------------------------
  describe('GET /ordenes', () => {
    it('devuelve data, total, page y limit', async () => {
      const res = await get('/ordenes?id_empresa=1', CLAVE_G1).expect(200);

      expect(res.body.data).toMatchObject({ total: 1, page: 1, limit: 50 });
      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    it('el limite se topa en 100 aunque se pida mas', async () => {
      await get('/ordenes?id_empresa=1&limit=5000', CLAVE_G1).expect(200);

      expect(ultimosArgsFindMany).toMatchObject({ take: 100 });
    });

    it('la pagina se traduce a skip', async () => {
      await get('/ordenes?id_empresa=1&page=3&limit=10', CLAVE_G1).expect(200);

      expect(ultimosArgsFindMany).toMatchObject({ skip: 20, take: 10 });
    });

    it('filtra por estado y por tecnico', async () => {
      await get('/ordenes?id_empresa=1&estado=COMPLETADA&id_tecnico=35', CLAVE_G1).expect(200);

      expect(ultimoWhereOrdenes).toMatchObject({
        id_empresa: 1,
        estado: 'COMPLETADA',
        id_tecnico: 35,
      });
    });

    it('sin fechas no filtra por fecha_creacion', async () => {
      await get('/ordenes?id_empresa=1', CLAVE_G1).expect(200);

      expect(ultimoWhereOrdenes).not.toHaveProperty('fecha_creacion');
    });

    it('con desde y hasta arma un intervalo semiabierto [gte, lt)', async () => {
      // El dia se toma en la zona de operacion, asi que no se comparan
      // instantes exactos: lo que importa es la FORMA del intervalo. Antes se
      // usaba `lte` con la medianoche UTC y el ultimo dia quedaba fuera; G1 y
      // G8 perdian justo los cierres del dia que consultaban.
      await get('/ordenes?id_empresa=1&desde=2026-09-01&hasta=2026-09-01', CLAVE_G1).expect(200);

      const rango = ultimoWhereOrdenes?.fecha_creacion as { gte: Date; lt: Date };
      expect(rango.gte).toBeInstanceOf(Date);
      expect(rango.lt).toBeInstanceOf(Date);
      expect(rango.lt.getTime()).toBeGreaterThan(rango.gte.getTime());
      // Un solo dia: 24 horas, o 23/25 si cae el cambio de hora.
      const horas = (rango.lt.getTime() - rango.gte.getTime()) / 3_600_000;
      expect(horas).toBeGreaterThanOrEqual(23);
      expect(horas).toBeLessThanOrEqual(25);
    });

    it('con solo una de las dos fechas, las ignora en vez de fallar', async () => {
      // Comportamiento actual: el filtro de fechas pide las DOS. `cierres`, en
      // cambio, responde 400. La asimetria es real y queda registrada aca.
      await get('/ordenes?id_empresa=1&desde=2026-09-01', CLAVE_G1).expect(200);

      expect(ultimoWhereOrdenes).not.toHaveProperty('fecha_creacion');
    });
  });

  // -------------------------------------------------------------------------
  // GET /ordenes/cierres
  // -------------------------------------------------------------------------
  describe('GET /ordenes/cierres', () => {
    it('solo trae OT COMPLETADA, filtradas por fecha_completada', async () => {
      await get('/ordenes/cierres?id_empresa=1&desde=2026-09-01&hasta=2026-09-02', CLAVE_G1).expect(200);

      expect(ultimoWhereOrdenes).toMatchObject({ id_empresa: 1, estado: 'COMPLETADA' });
      expect(ultimoWhereOrdenes).toHaveProperty('fecha_completada');
    });

    it('la pagina es de 100 y no se puede cambiar', async () => {
      await get('/ordenes/cierres?id_empresa=1&desde=2026-09-01&hasta=2026-09-02&limit=5', CLAVE_G1)
        .expect(200);

      expect(ultimosArgsFindMany).toMatchObject({ take: 100 });
    });

    it.each([
      ['sin fechas', '/ordenes/cierres?id_empresa=1'],
      ['solo desde', '/ordenes/cierres?id_empresa=1&desde=2026-09-01'],
      ['formato invalido', '/ordenes/cierres?id_empresa=1&desde=01-09-2026&hasta=02-09-2026'],
      ['hasta antes que desde', '/ordenes/cierres?id_empresa=1&desde=2026-09-10&hasta=2026-09-01'],
      ['rango mayor a 90 dias', '/ordenes/cierres?id_empresa=1&desde=2026-01-01&hasta=2026-09-01'],
    ])('responde 400: %s', async (_caso, ruta) => {
      await get(ruta, CLAVE_G1).expect(400);
    });

    it('acepta exactamente 90 dias', async () => {
      await get('/ordenes/cierres?id_empresa=1&desde=2026-06-04&hasta=2026-09-01', CLAVE_G1)
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  // GET /ordenes/:id — P0-b del acuerdo con G8 (§7)
  // -------------------------------------------------------------------------
  describe('GET /ordenes/:id — detalle para el CRM', () => {
    it('devuelve exactamente los campos del §7 del acuerdo', async () => {
      const res = await get('/ordenes/60?id_empresa=1', CLAVE_G8).expect(200);

      expect(Object.keys(res.body.data).sort()).toEqual([
        'estado',
        'fecha_completada',
        'fecha_creacion',
        'fecha_programada',
        'id_empresa',
        'id_ot',
        'origen_integracion',
        'prioridad',
        'tecnico',
        'tipo_ot',
      ]);
      expect(res.body.data).toMatchObject({
        id_ot: 60,
        id_empresa: 1,
        tipo_ot: 'INSTALACION',
        prioridad: 'MEDIA',
        estado: 'EN_CURSO',
        fecha_completada: null,
        tecnico: { id_usuario: 14, nombre_completo: 'Pedro Soto' },
      });
    });

    it('sirve la OT aunque NO este completada: para eso lo pidio G8', async () => {
      // `ordenes/:id/cierre` solo responde con la OT cerrada. Este endpoint
      // existe porque el CRM necesita mostrar el avance mientras tanto.
      const res = await get('/ordenes/60?id_empresa=1', CLAVE_G8).expect(200);

      expect(res.body.data.estado).toBe('EN_CURSO');
    });

    it('no consulta filtrando por estado', async () => {
      await get('/ordenes/60?id_empresa=1', CLAVE_G8).expect(200);

      const where = prisma.orden_trabajo.findFirst.mock.calls[0]?.[0]?.where;
      expect(where).toEqual({ id_ot: 60, id_empresa: 1 });
    });

    it('una OT sin tecnico asignado devuelve tecnico en null', async () => {
      const res = await get('/ordenes/61?id_empresa=1', CLAVE_G8).expect(200);

      expect(res.body.data).toMatchObject({ estado: 'PENDIENTE', tecnico: null, fecha_programada: null });
    });

    it('origen_integracion viaja en null hasta que exista el P0-a', async () => {
      // La llave va igual para que G8 programe contra la forma definitiva y el
      // P0-a solo tenga que llenarla, sin cambiarle el contrato.
      const res = await get('/ordenes/60?id_empresa=1', CLAVE_G8).expect(200);

      expect(res.body.data).toHaveProperty('origen_integracion', null);
    });

    it('no expone datos que el acuerdo no pidio', async () => {
      const res = await get('/ordenes/60?id_empresa=1', CLAVE_G8).expect(200);
      const texto = JSON.stringify(res.body.data);

      for (const filtrado of ['id_cliente', 'id_tecnico_externo', 'observaciones', 'cierre_equipos']) {
        expect(texto).not.toContain(filtrado);
      }
    });

    it('una OT de otra empresa responde 404, no 200', async () => {
      // G8 tiene la empresa 2 en su scope, asi que el 403 no aplica: lo que
      // aisla aca es el filtro por empresa de la consulta.
      await get('/ordenes/70?id_empresa=1', CLAVE_G8).expect(404);
    });

    it('una OT inexistente responde 404', async () => {
      await get('/ordenes/9999?id_empresa=1', CLAVE_G8).expect(404);
    });

    it('valida el scope antes de buscar', async () => {
      await get('/ordenes/60?id_empresa=2', CLAVE_G1).expect(403);

      expect(prisma.orden_trabajo.findFirst).not.toHaveBeenCalled();
    });

    it.each(['0', '-3', 'abc', '1.5'])('id %p responde 400 y no consulta', async (id) => {
      await get(`/ordenes/${id}?id_empresa=1`, CLAVE_G8).expect(400);

      expect(prisma.orden_trabajo.findFirst).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Orden de las rutas
  // -------------------------------------------------------------------------
  describe('orden de declaracion de las rutas', () => {
    // Nest resuelve por orden de declaracion. Si `ordenes/:id` subiera por
    // encima de `ordenes/cierres`, ese endpoint dejaria de existir: la peticion
    // entraria al detalle con id = "cierres". Ninguna prueba del resto del
    // archivo lo notaria, porque cada una mira su propia respuesta.
    it('ordenes/cierres NO es capturada por ordenes/:id', async () => {
      const res = await get('/ordenes/cierres?id_empresa=1&desde=2026-09-01&hasta=2026-09-02', CLAVE_G1)
        .expect(200);

      // El listado de cierres pagina; el detalle devuelve una OT suelta.
      expect(res.body.data).toMatchObject({ total: 1, page: 1, limit: 100 });
      expect(res.body.data).not.toHaveProperty('origen_integracion');
    });

    it('ordenes/:id/cierre sigue llegando a la reconciliacion', async () => {
      const res = await get('/ordenes/41/cierre?id_empresa=1', CLAVE_G1).expect(200);

      expect(res.body.data).toHaveProperty('clave_idempotencia');
      expect(res.body.data).not.toHaveProperty('origen_integracion');
    });
  });

  // -------------------------------------------------------------------------
  // GET /ordenes/:id/cierre — la reconciliacion
  // -------------------------------------------------------------------------
  describe('GET /ordenes/:id/cierre', () => {
    it('devuelve el payload de cierre completo', async () => {
      const res = await get('/ordenes/41/cierre?id_empresa=1', CLAVE_G1).expect(200);

      expect(res.body.data).toMatchObject({
        id_ot: 41,
        id_empresa: 1,
        tipo_ot: 'REPARACION',
        resultado_llamada: 'CONFORME',
        potencia_optica_dbm: -21.5,
        resuelto_remotamente: false,
        id_tecnico: 35,
        cliente: { rut: '11111111-1', nombre: 'Ana Soto' },
        direccion: { direccion_completa: 'Av. Ejemplo 123', comuna: 'La Pintana' },
        categoria_falla: { id_categoria: 3, nombre: 'Falla de planta externa' },
        materiales: [{ id_tipo_equipo: 7, cantidad: 2 }],
        equipos_instalados: [],
        equipos_retirados: [],
      });
    });

    it('la clave de idempotencia es id_ot:fecha_completada en ISO', async () => {
      // G1 y G8 deduplican con esto. Si cambia de forma, reprocesan cierres ya
      // aplicados: movimientos de inventario y facturas duplicados.
      const res = await get('/ordenes/41/cierre?id_empresa=1', CLAVE_G1).expect(200);

      expect(res.body.data.clave_idempotencia).toBe('41:2026-09-20T15:00:00.000Z');
      expect(res.body.data.fecha_completada).toBe('2026-09-20T15:00:00.000Z');
    });

    it('exige que la OT este COMPLETADA y en la empresa pedida', async () => {
      await get('/ordenes/999/cierre?id_empresa=1', CLAVE_G1).expect(404);

      const where = prisma.orden_trabajo.findFirst.mock.calls[0]?.[0]?.where;
      expect(where).toMatchObject({ id_ot: 999, id_empresa: 1, estado: 'COMPLETADA' });
    });

    it('no expone datos del tecnico mas alla del id', async () => {
      // Minima exposicion, el mismo criterio con el que el detalle de OT deja
      // fuera el email del cliente.
      const res = await get('/ordenes/41/cierre?id_empresa=1', CLAVE_G1).expect(200);

      const claves = Object.keys(res.body.data).filter((k) => k.includes('tecnico'));
      expect(claves).toEqual(['id_tecnico']);
      expect(JSON.stringify(res.body.data)).not.toContain('nombre_usuario');
    });
  });

  // -------------------------------------------------------------------------
  // Catalogo y clientes
  // -------------------------------------------------------------------------
  describe('catalogo y clientes', () => {
    it('categorias-falla y estados-equipo no piden id_empresa, pero si clave', async () => {
      await get('/categorias-falla', CLAVE_G1).expect(200);
      await get('/estados-equipo', CLAVE_G1).expect(200);
      await get('/categorias-falla', null).expect(401);
      await get('/estados-equipo', null).expect(401);
    });

    it('estados-equipo trae acciones, transiciones y diagnosticos', async () => {
      const res = await get('/estados-equipo', CLAVE_G1).expect(200);

      expect(Object.keys(res.body.data).sort()).toEqual([
        'acciones',
        'diagnostico_por_defecto',
        'diagnosticos',
        'transiciones',
      ]);
      // Cada accion viaja con sus origenes validos: G1 los necesita para
      // rechazar una transicion antes de aplicarla.
      for (const a of res.body.data.acciones) {
        expect(Object.keys(a).sort()).toEqual(['accion', 'estado_destino', 'origenes_validos']);
      }
    });

    it('cliente por RUT que no existe responde 404', async () => {
      await get('/clientes/rut/99999999-9?id_empresa=1', CLAVE_G1).expect(404);
    });

    it.each(['', 'a', 'ab'])('busqueda de %p caracteres responde 400', async (busqueda) => {
      await get(`/clientes?id_empresa=1&busqueda=${busqueda}`, CLAVE_G1).expect(400);

      expect(prisma.cliente.findMany).not.toHaveBeenCalled();
    });

    it('con 3 caracteres ya busca', async () => {
      await get('/clientes?id_empresa=1&busqueda=ana', CLAVE_G1).expect(200);

      expect(prisma.cliente.findMany).toHaveBeenCalled();
    });
  });
});
