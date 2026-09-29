import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { IntegracionesController } from './integraciones.controller.js';
import { IntegracionesService } from './integraciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MOMENTO_FAN_OUT } from '../ordenes/fan-out/momento-fan-out.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';

/**
 * Pruebas de CARACTERIZACION de `src/integraciones`: fijan el contrato que hoy
 * consumen G1 y G8, antes de tocar el cierre (P0-c de G8 y aprobacion del
 * cierre, MOD RF-04). No describen lo que deberia pasar sino lo que pasa: si
 * una cae, el contrato con otro grupo cambio, y eso se avisa antes de mergear.
 *
 * Lo que fijan:
 *   - el envoltorio `{ success, data }` de toda respuesta;
 *   - el controller sin JWT (`@Public`) y con `ApiKeyGuard`;
 *   - el guard: 401 sin clave o con clave desconocida, scope por empresa;
 *   - el servicio: 400 sin `id_empresa`, 403 fuera del scope, el filtro por
 *     empresa en toda consulta y los topes de paginacion y de rango.
 */

const scopeG1 = { grupo: 'G1', empresas: [1] };

describe('IntegracionesController: forma del contrato', () => {
  it('es publico para el JWT y exige la API key', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, IntegracionesController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, IntegracionesController)).toEqual([ApiKeyGuard]);
  });

  describe('envoltorio { success, data }', () => {
    const svc = {
      ordenes: jest.fn(async (..._a: unknown[]) => ({ data: [], total: 0, page: 1, limit: 50 })),
      cierres: jest.fn(async () => ({ data: [], total: 0, page: 1, limit: 100 })),
      cierre: jest.fn(async (..._a: unknown[]) => ({ id_ot: 41 })),
      categoriasFalla: jest.fn(async () => [{ id_categoria: 1 }]),
      mapeoEstados: jest.fn(() => ({ acciones: [] })),
      clientePorRut: jest.fn(async () => ({ rut: '1-9' })),
      buscarClientes: jest.fn(async () => []),
    };
    const ctrl = new IntegracionesController(svc as unknown as IntegracionesService, {} as never, {} as never);
    const req = { apiScope: scopeG1 };

    it.each([
      ['ordenes', () => ctrl.ordenes(req, '1'), { data: [], total: 0, page: 1, limit: 50 }],
      ['cierres', () => ctrl.cierres(req, '1', '2026-09-01', '2026-09-02'), { data: [], total: 0, page: 1, limit: 100 }],
      ['cierre', () => ctrl.cierre(req, '41', '1'), { id_ot: 41 }],
      ['categoriasFalla', () => ctrl.categoriasFalla(), [{ id_categoria: 1 }]],
      ['clientePorRut', () => ctrl.clientePorRut(req, '1-9', '1'), { rut: '1-9' }],
      ['buscarClientes', () => ctrl.buscarClientes(req, '1', 'ana'), []],
    ])('%s responde { success: true, data }', async (_n, llamar, data) => {
      await expect(llamar()).resolves.toEqual({ success: true, data });
    });

    it('mapeoEstados responde { success: true, data }', () => {
      expect(ctrl.mapeoEstados()).toEqual({ success: true, data: { acciones: [] } });
    });

    it('convierte los parametros de query a numero antes de llegar al servicio', async () => {
      await ctrl.ordenes(req, '2', 'ASIGNADA', '14', undefined, undefined, '3', '20');
      expect(svc.ordenes).toHaveBeenLastCalledWith(scopeG1, {
        id_empresa: 2,
        estado: 'ASIGNADA',
        id_tecnico: 14,
        desde: undefined,
        hasta: undefined,
        page: 3,
        limit: 20,
      });
      await ctrl.cierre(req, '41', '1');
      expect(svc.cierre).toHaveBeenLastCalledWith(scopeG1, 41, 1);
    });
  });
});

describe('ApiKeyGuard', () => {
  const guard = (raw: string) =>
    new ApiKeyGuard({ get: () => raw } as unknown as ConfigService);
  const contexto = (headers: Record<string, string>) => {
    const req: Record<string, unknown> = { headers };
    return {
      req,
      ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never,
    };
  };

  it('responde 401 sin X-API-KEY', () => {
    const { ctx } = contexto({});
    expect(() => guard('G1:k1:1').canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('responde 401 con una clave desconocida', () => {
    const { ctx } = contexto({ 'x-api-key': 'otra' });
    expect(() => guard('G1:k1:1').canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('deja en la request el grupo y las empresas de la clave', () => {
    const { req, ctx } = contexto({ 'x-api-key': 'k8' });
    expect(guard('G1:k1:1;G8:k8:1,2').canActivate(ctx)).toBe(true);
    expect(req.apiScope).toEqual({ grupo: 'G8', empresas: [1, 2] });
  });

  it('ignora una entrada mal formada sin tumbar las demas', () => {
    const g = guard('G1:k:con:dos-puntos:1;G8:k8:2');
    const malo = contexto({ 'x-api-key': 'k' });
    expect(() => g.canActivate(malo.ctx)).toThrow(UnauthorizedException);
    const bueno = contexto({ 'x-api-key': 'k8' });
    expect(g.canActivate(bueno.ctx)).toBe(true);
  });
});

describe('IntegracionesService: aislamiento y topes', () => {
  const findMany = jest.fn(async (_a?: unknown) => [] as unknown[]);
  const count = jest.fn(async (_a?: unknown) => 0);
  const findFirst = jest.fn(async (_a?: unknown) => null as unknown);
  let service: IntegracionesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegracionesService,
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
        {
          provide: PrismaService,
          useValue: {
            orden_trabajo: { findMany, count, findFirst },
            cliente: { findFirst, findMany },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(IntegracionesService);
  });

  it('400 si falta id_empresa', async () => {
    await expect(service.ordenes(scopeG1, { id_empresa: NaN })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('403 si la clave no cubre la empresa, en cada endpoint con empresa', async () => {
    await expect(service.ordenes(scopeG1, { id_empresa: 2 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.cierres(scopeG1, { id_empresa: 2, desde: '2026-09-01', hasta: '2026-09-02' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.cierre(scopeG1, 41, 2)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.clientePorRut(scopeG1, 2, '1-9')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.buscarClientes(scopeG1, 2, 'ana')).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('ordenes filtra por empresa, pagina de a 50 y no pasa de 100', async () => {
    await expect(service.ordenes(scopeG1, { id_empresa: 1 })).resolves.toEqual({ data: [], total: 0, page: 1, limit: 50 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { id_empresa: 1 }, skip: 0, take: 50 });

    await service.ordenes(scopeG1, { id_empresa: 1, limit: 500, page: 2 });
    expect(findMany.mock.calls[1][0]).toMatchObject({ skip: 100, take: 100 });
  });

  it('ordenes pasa estado y tecnico tal cual al filtro', async () => {
    await service.ordenes(scopeG1, { id_empresa: 1, estado: 'ASIGNADA', id_tecnico: 14 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { id_empresa: 1, estado: 'ASIGNADA', id_tecnico: 14 } });
  });

  // Cambio de contrato con MOD RF-04: con el aviso al cierre del tecnico (el
  // modo por defecto), una OT que espera aprobacion ya se aviso y se reconcilia.
  it('cierres exige rango, lo limita a 90 dias y solo mira cierres ya avisados', async () => {
    await expect(service.cierres(scopeG1, { id_empresa: 1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.cierres(scopeG1, { id_empresa: 1, desde: '2026-01-01', hasta: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.cierres(scopeG1, { id_empresa: 1, desde: '2026-09-01', hasta: '2026-09-02' });
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { id_empresa: 1, estado: { in: ['COMPLETADA', 'PENDIENTE_APROBACION'] } },
      take: 100,
    });
  });

  it('cierre responde 404 si la OT no esta cerrada en esa empresa', async () => {
    await expect(service.cierre(scopeG1, 41, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: { id_ot: 41, id_empresa: 1, estado: { in: ['COMPLETADA', 'PENDIENTE_APROBACION'] } },
    });
  });

  it('buscarClientes exige al menos 3 caracteres', async () => {
    await expect(service.buscarClientes(scopeG1, 1, 'an')).rejects.toBeInstanceOf(BadRequestException);
  });
});
