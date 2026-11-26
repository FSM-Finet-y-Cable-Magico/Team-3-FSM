import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { CLOUDINARY_CLIENT } from '../src/cloudinary/cloudinary.service.js';
import { configurarCuerpo } from '../src/common/http/limites-http.js';

/**
 * Topes de tamano de lo que entra por HTTP.
 *
 * Las dos subidas (foto de evidencia y KML) usan `memoryStorage()`: el archivo
 * entero queda en la RAM del proceso. Sin `limits.fileSize`, un archivo de
 * cualquier tamano se cargaba completo antes de que nadie lo mirara. El cuerpo
 * JSON aceptaba 20 MB, resto del incremento 1, cuando la foto viajaba en
 * base64; hoy va por multipart y ningun DTO pasa de unos KB.
 *
 * Cada tope tiene su control: lo legitimo tiene que seguir entrando.
 */
const MB = 1024 * 1024;

describe('limites de tamano de las peticiones', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const sdk = { uploader: { upload_stream: jest.fn() } };
  const token = (rol: string) => jwt.sign({ userId: 7, rol, id_empresa: 1 });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          JWT_SECRET: process.env.JWT_SECRET,
          JWT_EXPIRES_IN: '8h',
          FRONTEND_URL: 'http://127.0.0.1:5173',
          CLOUDINARY_CLOUD_NAME: 'cloud-de-prueba',
          CLOUDINARY_API_KEY: 'key-de-prueba',
          CLOUDINARY_API_SECRET: 'secret-de-prueba',
        }),
      )
      .overrideProvider(PrismaService)
      .useValue({
        $connect: async () => undefined,
        $disconnect: async () => undefined,
        usuario: { findUnique: jest.fn(async () => ({ activo: true })) },
      })
      .overrideProvider(CLOUDINARY_CLIENT)
      .useValue(sdk)
      .overrideProvider(AuthService)
      .useValue({ login: async () => ({ access_token: 'prueba' }) })
      .compile();

    // Igual que main.ts: sin el parser por defecto de Nest, con el nuestro.
    app = moduleRef.createNestApplication({ bodyParser: false });
    configurarCuerpo(app);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const cerrar = (cuerpo: object) =>
    request(app.getHttpServer())
      .post('/api/ordenes/1/cerrar')
      .auth(token('TECNICO'), { type: 'bearer' })
      .send(cuerpo);

  it('un cuerpo JSON de 2 MB se rechaza con 413', async () => {
    await cerrar({ observaciones: 'x'.repeat(2 * MB) }).expect(413);
  });

  it('control: un cuerpo JSON de 500 KB todavia entra (llega a la validacion)', async () => {
    const res = await cerrar({ observaciones: 'x'.repeat(500 * 1024) });
    expect(res.status).not.toBe(413);
  });

  it('una foto de 11 MB se rechaza con 413 sin llegar a Cloudinary', async () => {
    await request(app.getHttpServer())
      .post('/api/ordenes/1/foto')
      .auth(token('TECNICO'), { type: 'bearer' })
      .attach('file', Buffer.alloc(11 * MB), { filename: 'foto.jpg', contentType: 'image/jpeg' })
      .expect(413);
    expect(sdk.uploader.upload_stream).not.toHaveBeenCalled();
  });

  it('un KML de 21 MB se rechaza con 413', async () => {
    await request(app.getHttpServer())
      .post('/api/planta-externa/importar-kml')
      .auth(token('ADMIN'), { type: 'bearer' })
      .attach('kml', Buffer.alloc(21 * MB), { filename: 'red.kml', contentType: 'application/xml' })
      .expect(413);
  });

  it('control: un KML de 1 MB (el real de Tomodat pesa 740 KB) todavia entra', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/planta-externa/importar-kml')
      .auth(token('ADMIN'), { type: 'bearer' })
      .attach('kml', Buffer.alloc(1 * MB, ' '), { filename: 'red.kml', contentType: 'application/xml' });
    expect(res.status).not.toBe(413);
  });
});
