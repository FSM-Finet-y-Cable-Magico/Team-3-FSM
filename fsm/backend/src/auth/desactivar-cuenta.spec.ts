import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-43 "Desactivando una cuenta de usuario".
 *
 * Desactivar es barato de escribir y caro de equivocar: el modo de fallar no es
 * que no funcione, sino que deje a la empresa sin nadie que pueda administrarla.
 * Tres de estas pruebas cubren exactamente eso.
 */
describe('CU-43 · desactivar y reactivar una cuenta', () => {
  const ADMIN = { userId: 1, id_empresa: 1 };

  const rolAdmin = { rol: { nombre_rol: 'ADMIN' } };
  const rolTecnico = { rol: { nombre_rol: 'TECNICO' } };

  /** Usuarios que el doble de Prisma puede encontrar. */
  let tabla: Array<Record<string, unknown>>;
  let otrosAdmins: number;
  let update: any;
  let auditoria: any;
  let service: AuthService;

  beforeEach(async () => {
    jest.restoreAllMocks();
    tabla = [
      { id_usuario: 1, id_empresa: 1, nombre_completo: 'Admin Uno', nombre_usuario: 'admin.uno', activo: true, roles: [rolAdmin] },
      { id_usuario: 7, id_empresa: 1, nombre_completo: 'Tecnico Siete', nombre_usuario: 'tec.siete', activo: true, roles: [rolTecnico] },
      { id_usuario: 8, id_empresa: 1, nombre_completo: 'Admin Ocho', nombre_usuario: 'admin.ocho', activo: true, roles: [rolAdmin] },
      { id_usuario: 9, id_empresa: 1, nombre_completo: 'Baja Nueve', nombre_usuario: 'baja.nueve', activo: false, roles: [rolTecnico] },
      { id_usuario: 20, id_empresa: 2, nombre_completo: 'Ajeno Veinte', nombre_usuario: 'ajeno.veinte', activo: true, roles: [rolTecnico] },
    ];
    otrosAdmins = 1;
    update = jest.fn(async ({ where, data }: any) => {
      const fila = tabla.find((u) => u.id_usuario === where.id_usuario)!;
      Object.assign(fila, data);
      return fila;
    });
    auditoria = jest.fn(async () => ({}));

    const prisma = {
      usuario: {
        findFirst: jest.fn(async ({ where }: any) =>
          tabla.find((u) => u.id_usuario === where.id_usuario && u.id_empresa === where.id_empresa) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          tabla
            .filter((u) => u.id_empresa === where.id_empresa)
            .filter((u) => where.activo === undefined || u.activo === where.activo)
            .map((u) => ({ ...u, email: null, fecha_creacion: new Date(), roles: [{ rol: { nombre_rol: 'TECNICO' } }] })),
        ),
        count: jest.fn(async () => otrosAdmins),
        update,
      },
      log_auditoria: { create: auditoria },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: { sign: () => 'token' } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  // ---------------------------------------------------------------- lo normal
  it('desactiva una cuenta activa', async () => {
    const r = await service.cambiarActivo(7, false, ADMIN);

    expect(r).toMatchObject({ id_usuario: 7, activo: false });
    expect(update).toHaveBeenCalledWith({ where: { id_usuario: 7 }, data: { activo: false } });
  });

  it('reactiva una cuenta inactiva por el mismo endpoint', async () => {
    const r = await service.cambiarActivo(9, true, ADMIN);

    expect(r).toMatchObject({ id_usuario: 9, activo: true });
  });

  it('deja el rastro en auditoria con el antes y el despues', async () => {
    await service.cambiarActivo(7, false, ADMIN);

    expect(auditoria).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_usuario: ADMIN.userId,
        accion: 'DESACTIVAR_USUARIO',
        entidad_afectada: 'usuario',
        id_entidad_afectada: 7,
        valor_anterior: { activo: true },
        valor_nuevo: { activo: false },
      }),
    });
  });

  it('la accion auditada distingue activar de desactivar', async () => {
    await service.cambiarActivo(9, true, ADMIN);

    expect(auditoria.mock.calls[0][0].data.accion).toBe('ACTIVAR_USUARIO');
  });

  it('el cambio y su auditoria van en la misma transaccion', async () => {
    // Si se desacoplaran, una cuenta podria quedar desactivada sin registro de
    // quien lo hizo, que es justo lo que CU-41 despues tiene que poder mostrar.
    await service.cambiarActivo(7, false, ADMIN);

    expect(update.mock.invocationCallOrder[0]).toBeLessThan(auditoria.mock.invocationCallOrder[0]);
  });

  // ------------------------------------------------- lo que no se puede hacer
  it('un ADMIN no puede desactivarse a si mismo', async () => {
    await expect(service.cambiarActivo(ADMIN.userId, false, ADMIN)).rejects.toThrow(BadRequestException);

    expect(update).not.toHaveBeenCalled();
  });

  it('no alcanza a una cuenta de otra empresa', async () => {
    // El aislamiento del listado no sirve de nada si este endpoint es la puerta
    // de atras.
    await expect(service.cambiarActivo(20, false, ADMIN)).rejects.toThrow(NotFoundException);

    expect(update).not.toHaveBeenCalled();
  });

  it('no deja a la empresa sin ningun ADMIN activo', async () => {
    otrosAdmins = 0; // el 8 seria el ultimo

    await expect(service.cambiarActivo(8, false, ADMIN)).rejects.toThrow(ConflictException);

    expect(update).not.toHaveBeenCalled();
  });

  it('si queda otro ADMIN activo, si permite desactivar a uno', async () => {
    otrosAdmins = 1;

    await expect(service.cambiarActivo(8, false, ADMIN)).resolves.toMatchObject({ activo: false });
  });

  it('desactivar al ultimo TECNICO si se permite', async () => {
    // El bloqueo es por perder la administracion, no por quedarse sin personal.
    otrosAdmins = 0;

    await expect(service.cambiarActivo(7, false, ADMIN)).resolves.toMatchObject({ activo: false });
  });

  it('una cuenta que ya esta en ese estado responde conflicto', async () => {
    // Sin esto, repetir la llamada escribe una entrada de auditoria que dice
    // que hubo un cambio cuando no lo hubo.
    await expect(service.cambiarActivo(9, false, ADMIN)).rejects.toThrow(ConflictException);

    expect(auditoria).not.toHaveBeenCalled();
  });

  it('un usuario que no existe responde 404', async () => {
    await expect(service.cambiarActivo(999, false, ADMIN)).rejects.toThrow(NotFoundException);
  });

  // ------------------------------------------------------------- el listado
  it('el listado esconde a los inactivos por defecto', async () => {
    const r = await service.listarUsuarios(1);

    expect(r.map((u) => u.id_usuario)).not.toContain(9);
  });

  it('con incluir_inactivos los muestra, y trae el campo activo', async () => {
    // Una cuenta desactivada desaparecia del listado, asi que no habia desde
    // donde reactivarla: el CU quedaba a medias.
    const r = await service.listarUsuarios(1, true);

    expect(r.map((u) => u.id_usuario)).toContain(9);
    expect(r.every((u) => 'activo' in u)).toBe(true);
  });
});
