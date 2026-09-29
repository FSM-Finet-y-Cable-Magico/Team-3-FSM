import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './jwt.strategy.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-43, desactivar una cuenta de usuario. `usuario.activo` ya existia y el
 * login ya lo respetaba, pero no habia forma de cambiarlo sin tocar la base, y
 * un token emitido antes seguia sirviendo hasta 8 horas.
 */
describe('CU-43: desactivar y reactivar una cuenta', () => {
  const admin = { userId: 1, id_empresa: 1, rol: 'ADMIN' };
  let fila: { id_usuario: number; id_empresa: number; activo: boolean; nombre_completo: string };
  const update = jest.fn(async (a: any) => ({ ...fila, ...a.data }));
  const auditar = jest.fn(async (_a: any) => ({}));
  const contarOt = jest.fn(async (_a: any) => 2);
  const findMany = jest.fn(async (_a: any) => [] as any[]);
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    fila = { id_usuario: 14, id_empresa: 1, activo: true, nombre_completo: 'Pedro Rojas' };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            usuario: {
              findFirst: jest.fn(async (a: any) =>
                a.where.id_usuario === fila.id_usuario && a.where.id_empresa === fila.id_empresa ? fila : null,
              ),
              findMany,
            },
            orden_trabajo: { count: contarOt },
            $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
              fn({ usuario: { update }, log_auditoria: { create: auditar } }),
            ),
          },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('desactiva la cuenta, lo audita y avisa cuantas OT activas le quedan', async () => {
    const r = await service.cambiarActivo(14, false, admin);

    expect(update).toHaveBeenCalledWith({ where: { id_usuario: 14 }, data: { activo: false } });
    expect(auditar).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_usuario: 1,
        accion: 'DESACTIVAR_USUARIO',
        entidad_afectada: 'usuario',
        id_entidad_afectada: 14,
        valor_anterior: { activo: true },
        valor_nuevo: { activo: false },
      }),
    });
    // Las OT ASIGNADA o EN_CURSO del tecnico quedan sin quien las haga: la
    // Vista avisa para reasignarlas (RF-45).
    expect(contarOt.mock.calls[0][0]).toEqual({
      where: { id_tecnico: 14, id_empresa: 1, estado: { in: ['ASIGNADA', 'EN_CURSO'] } },
    });
    expect(r).toEqual({ id_usuario: 14, activo: false, ot_activas: 2 });
  });

  it('reactiva la cuenta', async () => {
    fila.activo = false;
    await service.cambiarActivo(14, true, admin);
    expect(auditar).toHaveBeenCalledWith({ data: expect.objectContaining({ accion: 'REACTIVAR_USUARIO' }) });
  });

  it('no deja que el administrador se desactive a si mismo', async () => {
    await expect(service.cambiarActivo(1, false, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('404 si la cuenta es de otra empresa', async () => {
    await expect(service.cambiarActivo(14, false, { ...admin, id_empresa: 2 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no escribe nada si la cuenta ya estaba asi', async () => {
    fila.activo = false;
    await service.cambiarActivo(14, false, admin);
    expect(update).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it('el listado incluye las cuentas desactivadas, para poder reactivarlas', async () => {
    findMany.mockResolvedValueOnce([
      { id_usuario: 14, id_empresa: 1, nombre_completo: 'Pedro', nombre_usuario: 'p', email: null, fecha_creacion: new Date(), activo: false, roles: [] },
    ]);
    const lista = await service.listarUsuarios(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ id_empresa: 1 });
    expect(lista[0]).toMatchObject({ id_usuario: 14, activo: false });
  });

  it('cambiar el estado de una cuenta es solo del ADMIN', () => {
    expect(Reflect.getMetadata('roles', AuthController.prototype.cambiarActivo)).toEqual(['ADMIN']);
  });
});

describe('CU-43: un token de una cuenta desactivada deja de servir', () => {
  const findUnique = jest.fn(async (_a: any): Promise<any> => ({ activo: true }));
  const strategy = new JwtStrategy(
    { get: () => 'secreto' } as unknown as ConfigService,
    { usuario: { findUnique }, empresa: { findUnique: jest.fn() } } as unknown as PrismaService,
  );
  const payload = { userId: 14, nombre_usuario: 'p', rol: 'TECNICO', id_empresa: 1 };

  it('una cuenta activa pasa', async () => {
    await expect(strategy.validate({ headers: {} }, payload)).resolves.toMatchObject({ userId: 14 });
    expect(findUnique).toHaveBeenCalledWith({ where: { id_usuario: 14 }, select: { activo: true } });
  });

  it.each([{ activo: false }, null])('una cuenta desactivada o borrada es 401 (%p)', async (fila) => {
    findUnique.mockResolvedValueOnce(fila);
    await expect(strategy.validate({ headers: {} }, payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
