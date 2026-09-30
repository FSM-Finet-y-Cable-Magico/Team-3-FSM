import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolicitudInstalacionDto } from './dto/solicitud-instalacion.dto.js';
import { InstalacionesService, hashSolicitud } from './instalaciones.service.js';
import { IntegracionesController } from './integraciones.controller.js';
import { IntegracionesService } from './integraciones.service.js';

/**
 * P0-a del acuerdo con G8: `POST /integraciones/instalaciones` crea la OT de
 * instalacion SIN cliente previo, con idempotencia por `request_id` y
 * `hash_payload` (Respuesta de G8 del 24-09, §4).
 */

// El ejemplo del §4.3 del contrato, tal cual.
const ejemplo = () => ({
  request_id: '550e8400-e29b-41d4-a716-446655440000',
  trace_id: '6f1d7d17-3f7d-4db8-93a8-87e8d7ce0031',
  id_empresa: 1,
  id_prospecto: 45,
  id_contrato: 92,
  id_plan: 15,
  persona: {
    rut: '12345678-5',
    nombre_completo: 'Juan Pérez Soto',
    telefono: '+56912345678',
    email: 'juan.perez@example.cl',
  },
  direccion: {
    direccion_completa: 'Av. Ejemplo 1234',
    comuna: 'La Pintana',
    ciudad: 'Santiago',
    latitud: null,
    longitud: null,
  },
  observaciones: 'Instalación originada por contrato CRM.',
  requisitos_equipamiento: [],
});

const errores = async (plano: unknown) => {
  const dto = plainToInstance(SolicitudInstalacionDto, plano);
  const errs = await validate(dto, { whitelist: true });
  const campos = (es: typeof errs, prefijo = ''): string[] =>
    es.flatMap((e) => [
      ...(e.constraints ? [`${prefijo}${e.property}`] : []),
      ...campos(e.children ?? [], `${prefijo}${e.property}.`),
    ]);
  return campos(errs);
};

describe('SolicitudInstalacionDto', () => {
  it('acepta el ejemplo del contrato', async () => {
    expect(await errores(ejemplo())).toEqual([]);
  });

  it('acepta la solicitud sin los opcionales', async () => {
    const p = ejemplo() as Record<string, any>;
    delete p.observaciones;
    delete p.requisitos_equipamiento;
    delete p.persona.email;
    delete p.direccion.ciudad;
    delete p.direccion.latitud;
    delete p.direccion.longitud;
    expect(await errores(p)).toEqual([]);
  });

  it.each([
    ['persona.telefono', (p: any) => delete p.persona.telefono],
    ['persona.nombre_completo', (p: any) => (p.persona.nombre_completo = '   ')],
    ['persona.rut', (p: any) => delete p.persona.rut],
    ['direccion.direccion_completa', (p: any) => delete p.direccion.direccion_completa],
    ['direccion.comuna', (p: any) => delete p.direccion.comuna],
    ['id_contrato', (p: any) => delete p.id_contrato],
    ['id_prospecto', (p: any) => delete p.id_prospecto],
    ['id_plan', (p: any) => delete p.id_plan],
    ['trace_id', (p: any) => delete p.trace_id],
  ])('rechaza la solicitud sin %s, que el contrato hace obligatorio', async (campo, quitar) => {
    const p = ejemplo();
    quitar(p);
    expect(await errores(p)).toContain(campo);
  });

  it.each([
    ['persona.telefono', (p: any) => (p.persona.telefono = '9 1234 5678')],
    ['persona.rut', (p: any) => (p.persona.rut = '12.345.678-5')],
    ['persona.rut', (p: any) => (p.persona.rut = '12345678-9')],
    ['request_id', (p: any) => (p.request_id = 'install-contract-92-v1')],
    ['id_empresa', (p: any) => (p.id_empresa = '1')],
  ])('rechaza %s fuera del formato canonico', async (campo, romper) => {
    const p = ejemplo();
    romper(p);
    expect(await errores(p)).toContain(campo);
  });
});

describe('hashSolicitud', () => {
  it('no depende del orden de las claves ni de null contra ausente', () => {
    const a = ejemplo();
    const b = JSON.parse(JSON.stringify(ejemplo()));
    delete b.direccion.latitud;
    delete b.direccion.longitud;
    const reordenado = { persona: b.persona, ...b };
    expect(hashSolicitud(reordenado)).toBe(hashSolicitud(a));
    expect(hashSolicitud(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cambia si cambia un dato', () => {
    const b = ejemplo();
    b.persona.telefono = '+56911111111';
    expect(hashSolicitud(b)).not.toBe(hashSolicitud(ejemplo()));
  });
});

describe('InstalacionesService', () => {
  const scopeG8 = { grupo: 'G8', empresas: [1] };
  let solicitudes: any[];
  const tx = {
    direccion_servicio: { create: jest.fn(async (_a: any) => ({ id_direccion: 501 })) },
    orden_trabajo: {
      create: jest.fn(async (a: any) => ({
        id_ot: 781,
        ...a.data,
        fecha_creacion: new Date('2026-09-29T18:00:00Z'),
      })),
    },
    historial_ot: { create: jest.fn(async (_a: any) => ({})) },
    log_auditoria: { create: jest.fn(async (_a: any) => ({})) },
    solicitud_instalacion_integracion: {
      create: jest.fn(async (a: any) => {
        solicitudes.push({ ...a.data });
        return a.data;
      }),
    },
  };
  const prisma = {
    solicitud_instalacion_integracion: {
      findUnique: jest.fn(async (a: any) => {
        const s = solicitudes.find((x) => x.request_id === a.where.request_id);
        return s ? { ...s, orden_trabajo: { estado: 'ASIGNADA' } } : null;
      }),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  let service: InstalacionesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    solicitudes = [];
    const moduleRef = await Test.createTestingModule({
      providers: [InstalacionesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(InstalacionesService);
  });

  it('crea la OT de instalacion sin cliente, apuntando a una direccion propia sin cliente', async () => {
    const r = await service.crear(scopeG8, ejemplo());

    expect(tx.direccion_servicio.create).toHaveBeenCalledWith({
      data: {
        id_cliente: null,
        direccion_completa: 'Av. Ejemplo 1234',
        comuna: 'La Pintana',
        ciudad: 'Santiago',
        es_principal: false,
      },
    });
    expect(tx.orden_trabajo.create.mock.calls[0][0].data).toMatchObject({
      id_empresa: 1,
      id_cliente: null,
      id_direccion: 501,
      tipo_ot: 'INSTALACION',
      estado: 'PENDIENTE',
    });
    expect(r).toEqual({
      creado: true,
      data: {
        request_id: '550e8400-e29b-41d4-a716-446655440000',
        trace_id: '6f1d7d17-3f7d-4db8-93a8-87e8d7ce0031',
        id_ot: 781,
        tipo_ot: 'INSTALACION',
        estado: 'PENDIENTE',
        fecha_creacion: '2026-09-29T18:00:00.000Z',
      },
    });
  });

  it('guarda el snapshot con su hash y la OT, sin replicar el email', async () => {
    await service.crear(scopeG8, ejemplo());

    const guardada = solicitudes[0];
    expect(guardada).toMatchObject({
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      hash_payload: hashSolicitud(ejemplo()),
      id_empresa: 1,
      id_prospecto_externo: 45,
      id_contrato_externo: 92,
      id_plan_externo: 15,
      rut: '12345678-5',
      nombre_completo: 'Juan Pérez Soto',
      telefono: '+56912345678',
      id_ot: 781,
    });
    // G8 pidio no replicar el email si no hace falta para ejecutar la OT.
    expect(JSON.stringify(guardada)).not.toContain('juan.perez@example.cl');
  });

  it('un reintento con el mismo payload devuelve la OT original sin crear otra', async () => {
    await service.crear(scopeG8, ejemplo());
    jest.clearAllMocks();

    const r = await service.crear(scopeG8, ejemplo());

    expect(tx.orden_trabajo.create).not.toHaveBeenCalled();
    expect(r).toEqual({
      creado: false,
      data: {
        request_id: '550e8400-e29b-41d4-a716-446655440000',
        id_ot: 781,
        estado: 'ASIGNADA',
        duplicado: true,
      },
    });
  });

  it('el mismo request_id con otro payload es un 409', async () => {
    await service.crear(scopeG8, ejemplo());
    const distinto = ejemplo();
    distinto.direccion.direccion_completa = 'Otra calle 1';

    await expect(service.crear(scopeG8, distinto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('si dos llamadas compiten, la que pierde responde como reintento', async () => {
    // La otra llamada inserto entre el findUnique y el create: el UNIQUE de
    // request_id rechaza la segunda y la transaccion se deshace entera.
    tx.solicitud_instalacion_integracion.create.mockImplementationOnce(async (a: any) => {
      solicitudes.push({ ...a.data, id_ot: 780 });
      throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
    });

    const r = await service.crear(scopeG8, ejemplo());

    expect(r).toMatchObject({ creado: false, data: { id_ot: 780, duplicado: true } });
  });

  it('403 si la clave no es de G8 o no cubre la empresa', async () => {
    await expect(service.crear({ grupo: 'G1', empresas: [1] }, ejemplo())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.crear({ grupo: 'G8', empresas: [2] }, ejemplo())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('POST /integraciones/instalaciones', () => {
  const crear = jest.fn(async (..._a: unknown[]): Promise<any> => ({ creado: true, data: { id_ot: 781 } }));
  const ctrl = new IntegracionesController(
    {} as IntegracionesService,
    { crear } as unknown as InstalacionesService,
  );
  const req = { apiScope: { grupo: 'G8', empresas: [1] } };

  it('responde 201 con el envoltorio y el mensaje del contrato', async () => {
    const res = { status: jest.fn() };
    const r = await ctrl.instalacion(req, ejemplo() as SolicitudInstalacionDto, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(r).toEqual({ success: true, data: { id_ot: 781 }, message: 'Solicitud de instalación aceptada' });
    expect(crear).toHaveBeenCalledWith(req.apiScope, ejemplo());
  });

  it('responde 200 al reintento', async () => {
    crear.mockResolvedValueOnce({ creado: false, data: { id_ot: 781, duplicado: true } });
    const res = { status: jest.fn() };
    const r = await ctrl.instalacion(req, ejemplo() as SolicitudInstalacionDto, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(r).toEqual({ success: true, data: { id_ot: 781, duplicado: true } });
  });
});
