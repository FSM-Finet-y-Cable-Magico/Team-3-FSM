import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UploadApiOptions, UploadApiResponse, UploadResponseCallback } from 'cloudinary';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { CLOUDINARY_CLIENT } from '../src/cloudinary/cloudinary.service.js';
import { Prisma } from '../generated/prisma/client.js';

// Evolución del arnés de #43/#42: los guards, DTO, servicios de OT/clientes y
// el cliente Prisma generado son reales. Solo se sustituyen persistencia,
// autenticación de credenciales y transporte del SDK (nunca la autorización).
@Controller('test-denegado')
class SinRolesController {
  @Get() obtener() { return { expuesto: true }; }
}

const historial = Array.from({ length: 25 }, (_, i) => ({
  id_historial: i + 1, fecha_hora: new Date(2026, 0, i + 1), estado_nuevo: 'ASIGNADA',
}));
const crearOrdenes = () => [
  { id_ot: 1, id_empresa: 1, id_tecnico: 7, estado: 'EN_CURSO', tipo_ot: 'REPARACION', id_cliente: 1 },
  { id_ot: 2, id_empresa: 1, id_tecnico: 8, estado: 'EN_CURSO', tipo_ot: 'REPARACION', id_cliente: 2 },
  { id_ot: 3, id_empresa: 2, id_tecnico: 7, estado: 'EN_CURSO', tipo_ot: 'REPARACION', id_cliente: 3 },
  { id_ot: 4, id_empresa: 1, id_tecnico: null, estado: 'PENDIENTE', tipo_ot: 'INSTALACION', id_cliente: 4 },
];
let ordenes = crearOrdenes();
const clientes = Array.from({ length: 130 }, (_, i) => ({ id_cliente: i + 1, id_empresa: i < 125 ? 1 : 2 }));
const prisma = {
  $connect: async () => undefined,
  $disconnect: async () => undefined,
  orden_trabajo: {
    findFirst: jest.fn(async ({ where, select, include }: Prisma.orden_trabajoFindFirstArgs = {}) => {
      const row = ordenes.find(o => o.id_ot === where?.id_ot && o.id_empresa === where?.id_empresa &&
        (where.id_tecnico === undefined || o.id_tecnico === where.id_tecnico));
      if (!row) return null;
      if (select) return { id_tecnico: row.id_tecnico };
      const historyArgs = include?.historial;
      const take = typeof historyArgs === 'object' ? historyArgs.take : undefined;
      return { ...row, historial: [...historial].reverse().slice(0, take), cliente: { nombre_completo: 'Cliente de prueba' } };
    }),
    findUnique: jest.fn(async ({ where }: Prisma.orden_trabajoFindUniqueArgs) => ordenes.find(o => o.id_ot === where.id_ot)),
    update: jest.fn(async ({ where, data }: Prisma.orden_trabajoUpdateArgs) => {
      const row = ordenes.find(o => o.id_ot === where.id_ot)!;
      if (typeof data.estado === 'string') row.estado = data.estado;
      return row;
    }),
    findMany: jest.fn(async (_args: Prisma.orden_trabajoFindManyArgs) => []),
    count: jest.fn(async () => 1),
  },
  cliente: {
    findFirst: jest.fn(async ({ where }: Prisma.clienteFindFirstArgs = {}) =>
      where?.rut === '12345678-5' && where?.id_empresa === 1
        ? { id_cliente: 1, rut: '12345678-5', nombre_completo: 'Cliente de prueba', direcciones: [], contratos: [] }
        : null),
    findMany: jest.fn(async ({ where, skip = 0, take }: Prisma.clienteFindManyArgs = {}) =>
      clientes.filter(c => c.id_empresa === where?.id_empresa).slice(skip, take === undefined ? undefined : skip + take)),
    count: jest.fn(async ({ where }: Prisma.clienteCountArgs = {}) => clientes.filter(c => c.id_empresa === where?.id_empresa).length),
  },
  categoria_falla: { findUnique: jest.fn(async () => ({ id_categoria: 1, nombre: 'Señal', sla_horas: 24 })) },
  evidencia_foto: { createMany: jest.fn(async (_args: Prisma.evidencia_fotoCreateManyArgs) => ({ count: 1 })) },
  historial_ot: { create: jest.fn(async (_args: Prisma.historial_otCreateArgs) => ({})) },
  log_auditoria: { create: jest.fn(async (_args: Prisma.log_auditoriaCreateArgs) => ({})) },
  llamada_cortes: { create: jest.fn(async (_args: Prisma.llamada_cortesCreateArgs) => ({})) },
  tipo_equipo: {
    findFirst: jest.fn(async () => ({ nombre: 'Cable' })),
    // La rama de monitoreo agrego al cierre una validacion de que el material
    // exista en el catalogo de la empresa (ACUERDO G1-G3: G3 valida existencia,
    // G1 valida saldo). Devolver el largo de `where.id_tipo_equipo.in` simula
    // "todos los ids existen", que es el caso feliz que ejercitan estos tests;
    // un doble que devolviera 0 haria fallar el cierre con 400, no con 500.
    count: jest.fn(async (args: Prisma.tipo_equipoCountArgs = {}) => {
      const ids = (args.where?.id_tipo_equipo as { in?: number[] })?.in;
      return ids ? ids.length : 1;
    }),
  },
  stock_consumible: {
    findFirst: jest.fn(async () => ({ id_stock: 1, id_bodega: null, cantidad_disponible: 10 })),
    update: jest.fn(async (_args: Prisma.stock_consumibleUpdateArgs) => ({})),
  },
  movimiento_inventario: { create: jest.fn(async (_args: Prisma.movimiento_inventarioCreateArgs) => ({})) },
  uso_material_ot: { createMany: jest.fn(async (_args: Prisma.uso_material_otCreateManyArgs) => ({ count: 1 })) },
  $queryRaw: jest.fn(async (sql: Prisma.Sql) => sql.sql.includes('COUNT(*)') ? [{ total: 0 }] : []),
  $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
};
const imagenRemota = { secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/evidencia.jpg', format: 'jpg', bytes: 2048 } as UploadApiResponse;
const sdk = { uploader: { upload_stream: jest.fn((_options: UploadApiOptions, callback?: UploadResponseCallback) => ({
  end: (_buffer: Buffer) => callback?.(undefined, imagenRemota),
})) } };
const cierre = () => ({
  fotos: [{ url_cloudinary: 'https://res.cloudinary.com/demo/image/upload/v1/evidencia.jpg', formato: 'jpg', tamano_kb: 1 }],
  materiales: [{ id_tipo_equipo: 1, cantidad: 2 }],
  potencia_optica_dbm: -21, resultado_llamada: 'CONFORME', id_categoria_falla: 1,
});

describe('API real: autenticación, permisos, evidencias y consultas', () => {
  let app: INestApplication;
  let appConCloud: INestApplication;
  let jwt: JwtService;
  const token = (rol = 'TECNICO', id_empresa = 1) => jwt.sign({ userId: 7, rol, id_empresa });
  const get = (id: number, rol = 'TECNICO', empresa = 1) => request(app.getHttpServer())
    .get('/api/ordenes/' + id).auth(token(rol, empresa), { type: 'bearer' });
  const foto = (id: number, rol = 'TECNICO') => request(app.getHttpServer())
    .post('/api/ordenes/' + id + '/foto').auth(token(rol), { type: 'bearer' })
    .attach('file', Buffer.from('imagen de prueba'), { filename: 'foto.jpg', contentType: 'image/jpeg' });
  const cerrar = (id: number, rol = 'TECNICO', dto = cierre()) => request(app.getHttpServer())
    .post('/api/ordenes/' + id + '/cerrar').auth(token(rol), { type: 'bearer' }).send(dto);
  const estado = (id: number, rol = 'TECNICO', nuevo = 'CANCELADA') => request(app.getHttpServer())
    .patch('/api/ordenes/' + id + '/estado').auth(token(rol), { type: 'bearer' })
    .send({ estado: nuevo, obs_cancelacion: 'Cancelación de prueba' });

  async function crearApp(configurada: boolean) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [SinRolesController] })
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_SECRET: process.env.JWT_SECRET, JWT_EXPIRES_IN: '8h',
        FRONTEND_URL: 'http://127.0.0.1:5173',
        CLOUDINARY_CLOUD_NAME: configurada ? 'cloud-de-prueba' : '',
        CLOUDINARY_API_KEY: configurada ? 'key-de-prueba' : '',
        CLOUDINARY_API_SECRET: configurada ? 'secret-de-prueba' : '',
      }))
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(CLOUDINARY_CLIENT).useValue(sdk)
      .overrideProvider(AuthService).useValue({
        login: async () => ({ access_token: 'prueba' }),
        cambiarPassword: async () => ({ ok: true }),
        listarUsuarios: async () => [],
      }).compile();
    const nuevaApp = moduleRef.createNestApplication();
    nuevaApp.setGlobalPrefix('api');
    nuevaApp.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await nuevaApp.init();
    return nuevaApp;
  }
  beforeAll(async () => {
    app = await crearApp(false);
    appConCloud = await crearApp(true);
    jwt = app.get(JwtService);
  });
  beforeEach(() => { ordenes = crearOrdenes(); jest.clearAllMocks(); });
  afterAll(async () => { await app?.close(); await appConCloud?.close(); });

  it('carga el SQL del cliente Prisma ESM real', () => {
    expect(Prisma.sql`SELECT ${7}`.values).toEqual([7]);
  });
  it('login público conserva acceso sin token', async () => {
    await request(app.getHttpServer()).post('/api/auth/login')
      .send({ nombre_usuario: 'prueba.usuario', password: 'Prueba123!' }).expect(201);
  });
  it.each(['/dashboard', '/clientes', '/clientes/rut/12345678-5', '/ordenes', '/dashboard/empresas', '/auth/usuarios'])
    ('GET %s sin token responde 401 antes de evaluar roles', async ruta => {
      await request(app.getHttpServer()).get('/api' + ruta).expect(401);
    });
  it.each(['foto', 'cerrar'])('POST OT/%s sin token responde 401', async operacion => {
    await request(app.getHttpServer()).post('/api/ordenes/1/' + operacion).send(cierre()).expect(401);
  });
  it('PATCH estado sin token responde 401', async () => {
    await request(app.getHttpServer()).patch('/api/ordenes/1/estado').send({ estado: 'EN_CURSO' }).expect(401);
  });
  it.each(['basura', 'firma', 'vencido'])('rechaza token %s', async caso => {
    const invalido = caso === 'basura' ? 'no-es-token' : jwt.sign({ userId: 7, rol: 'TECNICO', id_empresa: 1 },
      caso === 'firma' ? { secret: 'otro-secreto' } : { expiresIn: -1 });
    await request(app.getHttpServer()).get('/api/ordenes/1').auth(invalido, { type: 'bearer' }).expect(401);
  });
  it('un handler sin @Roles permanece cerrado', async () => {
    await request(app.getHttpServer()).get('/api/test-denegado').auth(token('ADMIN'), { type: 'bearer' }).expect(403);
  });
  it.each(['ADMIN', 'JEFE_TECNICO', 'TECNICO'])('cambiar contraseña permite %s autenticado', async rol => {
    await request(app.getHttpServer()).post('/api/auth/cambiar-password').auth(token(rol), { type: 'bearer' })
      .send({ nueva_password: 'Nueva1234!', confirmar_password: 'Nueva1234!' }).expect(201);
  });
  it('TECNICO no accede a clientes ni empresas administrativas', async () => {
    for (const ruta of ['/clientes', '/clientes/rut/12345678-5', '/dashboard/empresas', '/auth/usuarios']) {
      await request(app.getHttpServer()).get('/api' + ruta).auth(token(), { type: 'bearer' }).expect(403);
    }
  });
  it('TECNICO no consulta la ficha ni su historial en persistencia', async () => {
    await request(app.getHttpServer()).get('/api/clientes/rut/12345678-5')
      .auth(token(), { type: 'bearer' }).expect(403);
    expect(prisma.cliente.findFirst).not.toHaveBeenCalled();
    expect(prisma.orden_trabajo.findMany).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'JEFE_TECNICO'])('%s consulta la ficha por RUT solo en su empresa', async rol => {
    const res = await request(app.getHttpServer()).get('/api/clientes/rut/12345678-5')
      .auth(token(rol), { type: 'bearer' }).expect(200);
    expect(res.body.cliente).toMatchObject({ id_cliente: 1, rut: '12345678-5' });
    await request(app.getHttpServer()).get('/api/clientes/rut/12345678-5')
      .auth(token(rol, 2), { type: 'bearer' }).expect(404);
    expect(prisma.cliente.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { rut: '12345678-5', id_empresa: 2 },
    }));
  });
  it.each(['ADMIN', 'JEFE_TECNICO', 'TECNICO'])('%s consulta OT propia y nunca otra empresa', async rol => {
    await get(1, rol).expect(200);
    await get(3, rol).expect(404);
    await get(999, rol).expect(404);
  });
  it.each(['ADMIN', 'JEFE_TECNICO'])('%s consulta y cambia OT de otro técnico de su empresa', async rol => {
    await get(2, rol).expect(200);
    await get(4, rol).expect(200);
    await estado(2, rol).expect(200);
    await estado(3, rol).expect(404);
  });
  it.each([2, 4])('TECNICO no hidrata ni lee la OT ajena/sin asignar %s', async id => {
    const res = await get(id).expect(403);
    expect(res.body.message).toBe('No tienes permiso para ver esta OT.');
    expect(res.body.cliente).toBeUndefined();
    expect(prisma.orden_trabajo.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.orden_trabajo.findFirst).toHaveBeenCalledWith({ where: { id_ot: id, id_empresa: 1 }, select: { id_tecnico: true } });
  });
  it.each(['ADMIN', 'JEFE_TECNICO'])('%s no puede subir ni cerrar aunque sea el usuario asignado', async rol => {
    await foto(1, rol).expect(403); await cerrar(1, rol).expect(403);
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(sdk.uploader.upload_stream).not.toHaveBeenCalled();
  });
  it('no modifica, sube ni cierra una OT ajena; otra empresa/inexistente conserva 404', async () => {
    for (const [id, status] of [[2, 403], [3, 404], [999, 404]]) {
      await estado(id).expect(status); await foto(id).expect(status); await cerrar(id).expect(status);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(sdk.uploader.upload_stream).not.toHaveBeenCalled();
  });
  it('subida sin Cloudinary responde 503 sin persistir ni invocar el SDK', async () => {
    const res = await foto(1).expect(503);
    expect(res.body.message).toContain('Cloudinary no está configurado');
    expect(prisma.evidencia_foto.createMany).not.toHaveBeenCalled();
    expect(sdk.uploader.upload_stream).not.toHaveBeenCalled();
  });
  it('sube por el servicio real y permite persistir su respuesta en el cierre', async () => {
    const subida = await request(appConCloud.getHttpServer()).post('/api/ordenes/1/foto')
      .auth(token(), { type: 'bearer' }).attach('file', Buffer.from('foto'), 'foto.jpg').expect(201);
    expect(subida.body).toEqual({ url_cloudinary: imagenRemota.secure_url, formato: 'jpg', tamano_kb: 2 });
    expect(sdk.uploader.upload_stream).toHaveBeenCalledWith(expect.objectContaining({ folder: 'fsm_evidencias', resource_type: 'image' }), expect.any(Function));
    const dto = cierre(); dto.fotos = [subida.body];
    await cerrar(1, 'TECNICO', dto).expect(201);
    expect(prisma.evidencia_foto.createMany).toHaveBeenCalledWith({ data: [{ id_ot: 1, ...subida.body }] });
  });
  it('un error del SDK responde 503 sin filtrar detalles del proveedor', async () => {
    sdk.uploader.upload_stream.mockImplementationOnce(() => { throw new Error('detalle interno secreto'); });
    const res = await request(appConCloud.getHttpServer()).post('/api/ordenes/1/foto')
      .auth(token(), { type: 'bearer' }).attach('file', Buffer.from('foto'), 'foto.jpg').expect(503);
    expect(JSON.stringify(res.body)).not.toContain('detalle interno secreto');
  });
  it('subida sin archivo responde 400', async () => {
    await request(app.getHttpServer()).post('/api/ordenes/1/foto').auth(token(), { type: 'bearer' }).expect(400);
  });
  it.each(['data:image/jpeg;base64,YWJj', 'javascript:alert(1)', 'ftp://example.com/foto.jpg', '//example.com/foto.jpg', 'https://', ''])
    ('el DTO directo rechaza %s antes de persistir evidencia', async url => {
      const dto = cierre(); dto.fotos[0].url_cloudinary = url;
      await cerrar(1, 'TECNICO', dto).expect(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  it.each(['http', 'https'])('cierre con %s persiste evidencia, material, llamada, historial y auditoría', async protocolo => {
    const dto = cierre(); dto.fotos[0].url_cloudinary = protocolo + '://example.com/foto.jpg';
    const res = await cerrar(1, 'TECNICO', dto).expect(201);
    expect(res.body.estado).toBe('COMPLETADA');
    expect(prisma.evidencia_foto.createMany).toHaveBeenCalledWith({ data: [{ id_ot: 1, ...dto.fotos[0] }] });
    expect(prisma.stock_consumible.update).toHaveBeenCalledWith({ where: { id_stock: 1 }, data: { cantidad_disponible: { decrement: 2 } } });
    expect(prisma.movimiento_inventario.create).toHaveBeenCalled();
    expect(prisma.llamada_cortes.create).toHaveBeenCalled();
    expect(prisma.historial_ot.create).toHaveBeenCalled();
    expect(prisma.log_auditoria.create).toHaveBeenCalled();
  });
  it('técnico inicia su OT y se rechazan transiciones inválidas', async () => {
    ordenes[0].estado = 'ASIGNADA';
    await estado(1, 'TECNICO', 'EN_CURSO').expect(200);
    expect(ordenes[0].estado).toBe('EN_CURSO');
    await estado(1, 'TECNICO', 'ASIGNADA').expect(400);
  });
  it('no cierra una OT fuera de EN_CURSO', async () => {
    ordenes[0].estado = 'ASIGNADA'; await cerrar(1).expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('devuelve las 20 transiciones más recientes', async () => {
    const res = await get(1).expect(200);
    expect(res.body.historial.map((h: { id_historial: number }) => h.id_historial)).toEqual(
      Array.from({ length: 20 }, (_, i) => 25 - i));
    expect(prisma.orden_trabajo.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      include: expect.objectContaining({ historial: { orderBy: { fecha_hora: 'desc' }, take: 20 } }),
    }));
  });
  it('clientes limita a 100 por página y conserva empresa y metadatos', async () => {
    const res = await request(app.getHttpServer()).get('/api/clientes?limit=100000').auth(token('ADMIN'), { type: 'bearer' }).expect(200);
    expect(res.body).toMatchObject({ total: 125, page: 1, limit: 100 }); expect(res.body.data).toHaveLength(100);
    const segunda = await request(app.getHttpServer()).get('/api/clientes?limit=100&page=2').auth(token('JEFE_TECNICO'), { type: 'bearer' }).expect(200);
    expect(segunda.body.data).toHaveLength(25);
    expect(segunda.body.data.every((c: { id_empresa: number }) => c.id_empresa === 1)).toBe(true);
  });
  it('el listado de OT normaliza infinitos antes de construir el SQL parametrizado', async () => {
    const res = await request(app.getHttpServer()).get('/api/ordenes?page=Infinity&limit=Infinity')
      .auth(token(), { type: 'bearer' }).expect(200);
    expect(res.body).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    const sql = prisma.$queryRaw.mock.calls[1][0];
    expect(sql.values.slice(-2)).toEqual([20, 0]);
    expect(sql.sql).toContain('id_empresa =');
    expect(sql.sql).toContain('id_tecnico =');
  });
  it.each(['Infinity', '-Infinity', 'NaN', 'abc', '1e300'])('clientes normaliza page=%s sin enviarlo a Prisma', async valor => {
    const res = await request(app.getHttpServer()).get('/api/clientes?page=' + valor).auth(token('ADMIN'), { type: 'bearer' }).expect(200);
    expect(res.body).toMatchObject({ page: 1, limit: 20 }); expect(res.body.data).toHaveLength(20);
  });
});
