import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { CrearUsuarioDto } from './dto/crear-usuario.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * La tabla `usuario` de la base global tiene columnas que el FSM no conocia
 * (medido el 14-11, despues del wipe):
 *  - `rut`: los otros grupos identifican al tecnico por RUT, y el FSM nunca lo
 *    guardaba (G1 respondio TECNICO_NO_ENCONTRADO a una OT nuestra).
 *  - `debe_cambiar_password`: la misma idea que nuestro `es_password_temporal`
 *    con otro nombre. Se escriben y se leen los dos.
 *  - `fecha_eliminacion`: borrado logico. Una cuenta con fecha no entra ni
 *    aparece, como si no existiera.
 */
const dto = (extra: Partial<CrearUsuarioDto> = {}): CrearUsuarioDto => ({
  nombre_completo: 'Tecnico de Prueba Uno',
  nombre_usuario: 'tecnico.prueba1',
  password_temporal: 'Temporal.2026',
  rol: 'TECNICO',
  id_empresa: 1,
  ...extra,
});

describe('crear usuario con las columnas de la base global', () => {
  let creado: any;
  const crearUsuario = jest.fn(async (a: any) => (creado = { id_usuario: 9, ...a.data }));
  const crearRol = jest.fn(async (_a: any) => ({}));
  const auditar = jest.fn(async (_a: any) => ({}));
  let roles: string[];
  let existentes: any[];
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    creado = null;
    roles = ['Administrador', 'Terreno'];
    existentes = [];
    const buscarRol = jest.fn(async (a: any) => {
      const nombre = (a.where.nombre_rol.in as string[]).find((n) => roles.includes(n));
      return nombre ? { id_rol: roles.indexOf(nombre) + 1, nombre_rol: nombre } : null;
    });
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            usuario: {
              findUnique: jest.fn(async () => null),
              findFirst: jest.fn(async (a: any) => existentes.find((e) => (a.where.rut?.in ?? []).includes(e.rut)) ?? null),
            },
            rol: { findFirst: buscarRol },
            $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
              fn({
                usuario: { create: crearUsuario },
                rol: { findFirst: buscarRol },
                usuario_rol: { create: crearRol },
                log_auditoria: { create: auditar },
              }),
            ),
          },
        },
      ],
    }).compile();
    service = mod.get(AuthService);
  });

  it('guarda el RUT sin puntos ni guion, el email y las dos marcas de clave temporal', async () => {
    await service.crearUsuario(dto({ rut: '12.345.678-5', email: ' Tecnico.Prueba1@FiNet.cl ' }), 1);

    expect(creado).toMatchObject({
      rut: '123456785',
      email: 'tecnico.prueba1@finet.cl',
      es_password_temporal: true,
      debe_cambiar_password: true,
    });
    expect(crearRol).toHaveBeenCalled();
  });

  it('sin RUT ni email los deja vacios, como los usuarios que creo el administrador', async () => {
    await service.crearUsuario(dto(), 1);

    expect(creado.rut).toBeNull();
    expect(creado.email).toBeNull();
  });

  it('un RUT invalido no crea nada', async () => {
    await expect(service.crearUsuario(dto({ rut: '12.345.678-9' }), 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(crearUsuario).not.toHaveBeenCalled();
  });

  it('un RUT que ya tiene otra cuenta vigente es conflicto, venga escrito como venga', async () => {
    existentes = [{ id_usuario: 3, rut: '12345678-5' }];
    await expect(service.crearUsuario(dto({ rut: '123456785' }), 1)).rejects.toBeInstanceOf(ConflictException);
    expect(crearUsuario).not.toHaveBeenCalled();
  });

  it('un rol que no existe en esta base es 400 y no deja una cuenta sin rol', async () => {
    // En la global no hay JEFE_TECNICO ni COORDINADOR: antes se creaba la
    // cuenta igual, sin rol, y la persona no podia hacer nada.
    await expect(service.crearUsuario(dto({ rol: 'JEFE_TECNICO' }), 1)).rejects.toThrow(/no existe en esta base/);
    expect(crearUsuario).not.toHaveBeenCalled();
  });
});

describe('formato del nombre de usuario', () => {
  const errores = async (nombre_usuario: string) =>
    (await validate(plainToInstance(CrearUsuarioDto, dto({ nombre_usuario })))).map((e) => e.property);

  it('acepta numeros despues del punto, como tecnico.prueba1', async () => {
    expect(await errores('tecnico.prueba1')).toEqual([]);
  });

  it('sigue exigiendo minusculas y un punto', async () => {
    expect(await errores('Tecnico.Prueba')).toContain('nombre_usuario');
    expect(await errores('tecnicoprueba')).toContain('nombre_usuario');
  });
});

describe('cuentas de la base global al entrar', () => {
  const HASH = bcrypt.hashSync('LaBuena.2026', 4);
  let fila: any;
  const actualizar = jest.fn(async (_a: any) => ({}));
  let service: AuthService;
  let strategy: JwtStrategy;

  beforeEach(async () => {
    jest.clearAllMocks();
    fila = {
      id_usuario: 7, id_empresa: 1, nombre_usuario: 'tecnico.prueba1', password_hash: HASH,
      activo: true, es_password_temporal: false, debe_cambiar_password: false, fecha_eliminacion: null,
    };
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtStrategy,
        { provide: JwtService, useValue: { sign: () => 'token' } },
        { provide: ConfigService, useValue: { get: () => 'secreto-de-prueba', getOrThrow: () => 'secreto-de-prueba' } },
        {
          provide: PrismaService,
          useValue: {
            usuario: { findUnique: jest.fn(async () => fila), update: actualizar },
            intento_fallido: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})) },
            usuario_rol: { findFirst: jest.fn(async () => ({ rol: { nombre_rol: 'Terreno' } })) },
            empresa: { findUnique: jest.fn(async () => ({ id_empresa: 1 })) },
            log_auditoria: { create: jest.fn(async () => ({})) },
          },
        },
      ],
    }).compile();
    service = mod.get(AuthService);
    strategy = mod.get(JwtStrategy);
  });

  const entrar = () => service.login({ nombre_usuario: 'tecnico.prueba1', password: 'LaBuena.2026' }, '1.2.3.4');

  it('pide cambiar la clave si cualquiera de las dos marcas lo dice', async () => {
    fila.debe_cambiar_password = true;
    expect((await entrar()).cambiar_password).toBe(true);
  });

  it('una cuenta con fecha de eliminacion no entra, con el mismo mensaje que una inexistente', async () => {
    fila.fecha_eliminacion = new Date('2026-11-14T00:00:00Z');
    await expect(entrar()).rejects.toThrow(new UnauthorizedException('Usuario o contraseña incorrectos'));
  });

  it('el token de una cuenta eliminada deja de servir', async () => {
    fila.fecha_eliminacion = new Date('2026-11-14T00:00:00Z');
    const payload = { userId: 7, nombre_usuario: 'tecnico.prueba1', rol: 'TECNICO', id_empresa: 1 };
    await expect(strategy.validate({ headers: {} }, payload as any)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cambiar la clave apaga las dos marcas', async () => {
    await service.cambiarPassword(7, { nueva_password: 'Nueva.Clave.2026', confirmar_password: 'Nueva.Clave.2026' } as any);
    expect(actualizar.mock.calls[0][0]).toMatchObject({
      data: { es_password_temporal: false, debe_cambiar_password: false },
    });
  });
});
