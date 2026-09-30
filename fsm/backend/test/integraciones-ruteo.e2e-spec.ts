import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { IntegracionesService } from '../src/integraciones/integraciones.service.js';

/**
 * Que cada ruta de `/api/integraciones` llegue al handler que le toca.
 *
 * POR QUE POR HTTP Y NO LLAMANDO AL CONTROLADOR. Las pruebas del modulo llaman
 * a los metodos directamente (`ctrl.cierres(...)`), lo que no pasa por el
 * router de Nest. Nest resuelve las rutas EN EL ORDEN EN QUE SE DECLARAN, asi
 * que `@Get('ordenes/:id')` declarado antes que `@Get('ordenes/cierres')` se
 * traga "cierres" como si fuera un id.
 *
 * Eso no es teorico: se comprobo moviendo la ruta a proposito y las 59 pruebas
 * del modulo siguieron pasando en verde, con `GET /integraciones/ordenes/cierres`
 * --el endpoint con el que G1 reconcilia cierres con materiales, T1-CU-90--
 * muerto en produccion y nadie enterandose.
 *
 * Estas pruebas no miran QUE devuelve cada endpoint, solo A QUIEN llega. De lo
 * otro ya se encargan las del modulo.
 */

const CLAVE = 'clave-de-ruteo';

describe('ruteo de /api/integraciones', () => {
  let app: INestApplication;

  /** Espia por metodo del servicio: dice cual se invoco de verdad. */
  const svc = {
    ordenes: jest.fn(async () => ({ data: [], total: 0, page: 1, limit: 50 })),
    cierres: jest.fn(async () => ({ data: [], total: 0, page: 1, limit: 100 })),
    orden: jest.fn(async () => ({ id_ot: 7, origen_integracion: null })),
    cierre: jest.fn(async () => ({ id_ot: 7, clave_idempotencia: '7:x' })),
    categoriasFalla: jest.fn(async () => []),
    mapeoEstados: jest.fn(() => ({ acciones: [] })),
    clientePorRut: jest.fn(async () => ({ rut: '1-9' })),
    buscarClientes: jest.fn(async () => []),
  };

  const get = (ruta: string) =>
    request(app.getHttpServer()).get('/api/integraciones' + ruta).set('X-API-KEY', CLAVE);

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
          INTEGRACION_API_KEYS: `G1:${CLAVE}:1,2`,
        }),
      )
      .overrideProvider(PrismaService)
      .useValue({ $connect: async () => undefined, $disconnect: async () => undefined })
      .overrideProvider(IntegracionesService)
      .useValue(svc)
      .overrideProvider(AuthService)
      .useValue({ login: async () => ({ access_token: 'prueba' }) })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
  });

  // -------------------------------------------------------------------------
  // El caso que motiva el archivo
  // -------------------------------------------------------------------------
  it('GET /ordenes/cierres llega a `cierres`, NO al detalle con id="cierres"', async () => {
    await get('/ordenes/cierres?id_empresa=1&desde=2026-09-01&hasta=2026-09-02').expect(200);

    expect(svc.cierres).toHaveBeenCalledTimes(1);
    expect(svc.orden).not.toHaveBeenCalled();
  });

  it('si se lo tragara el detalle, el id llegaria como NaN', async () => {
    // Deja escrito cual seria el sintoma en produccion: `+("cierres")` es NaN, y
    // un NaN en el `where` de Prisma responde 500 en vez de 400 o 404.
    await get('/ordenes/cierres?id_empresa=1&desde=2026-09-01&hasta=2026-09-02').expect(200);

    for (const llamada of svc.orden.mock.calls as unknown as unknown[][]) {
      expect(Number.isNaN(llamada[1] as number)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // El resto de las rutas, por si alguna otra se reordena
  // -------------------------------------------------------------------------
  it.each([
    ['/ordenes?id_empresa=1', 'ordenes'],
    ['/ordenes/cierres?id_empresa=1&desde=2026-09-01&hasta=2026-09-02', 'cierres'],
    ['/ordenes/41?id_empresa=1', 'orden'],
    ['/ordenes/41/cierre?id_empresa=1', 'cierre'],
    ['/categorias-falla', 'categoriasFalla'],
    ['/estados-equipo', 'mapeoEstados'],
    ['/clientes/rut/11111111-1?id_empresa=1', 'clientePorRut'],
    ['/clientes?id_empresa=1&busqueda=ana', 'buscarClientes'],
  ] as const)('GET %s resuelve a %s y a ningun otro', async (ruta, esperado) => {
    await get(ruta).expect(200);

    for (const [nombre, espia] of Object.entries(svc)) {
      if (nombre === esperado) expect(espia).toHaveBeenCalledTimes(1);
      else expect(espia).not.toHaveBeenCalled();
    }
  });

  // -------------------------------------------------------------------------
  // Las dos rutas literales que un `:id` podria tragarse
  // -------------------------------------------------------------------------
  it('GET /clientes/rut/:rut no lo captura ningun comodin', async () => {
    await get('/clientes/rut/11111111-1?id_empresa=1').expect(200);

    expect(svc.clientePorRut).toHaveBeenCalledTimes(1);
  });

  it('un id no numerico en /ordenes/:id no responde 500', async () => {
    // Si alguien agrega una ruta literal nueva bajo `ordenes/` y la declara
    // despues del comodin, este es el sintoma con el que aparecera.
    const res = await get('/ordenes/loquesea?id_empresa=1');

    expect(res.status).toBeLessThan(500);
  });
});
