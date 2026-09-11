import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * El login de una cuenta con nombre de usuario largo devolvia 500 en vez de 401.
 *
 * `intento_fallido.rut_intentado` era VarChar(12) --nacio pensando en un RUT--
 * pero ahi se guarda el `nombre_usuario`, que admite 50 y por convencion es
 * "nombre.apellido". Para "tecnico.pruebas" (15) el INSERT violaba el largo, y
 * como el registro del intento ocurre ANTES de lanzar el 401, el error se
 * llevaba puesta la respuesta.
 *
 * La migracion ensancha la columna. Estas pruebas cubren lo otro: que la
 * respuesta de autenticacion no dependa de que la escritura de contabilidad
 * funcione, y que si falla se note en el log.
 */
describe('intentos fallidos de login', () => {
  const HASH = bcrypt.hashSync('LaBuena.2026', 4);
  const USUARIO_LARGO = 'tecnico.pruebas'; // 15 caracteres

  let crearIntento: any;
  let service: AuthService;

  const usuario = {
    id_usuario: 7,
    id_empresa: 1,
    nombre_usuario: USUARIO_LARGO,
    password_hash: HASH,
    activo: true,
    es_password_temporal: false,
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    crearIntento = jest.fn(async () => ({}));
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: { sign: () => 'token-de-prueba' } },
        {
          provide: PrismaService,
          useValue: {
            usuario: { findUnique: jest.fn(async () => usuario) },
            intento_fallido: {
              findFirst: jest.fn(async () => null),
              create: crearIntento,
            },
            usuario_rol: { findFirst: jest.fn(async () => ({ rol: { nombre_rol: 'TECNICO' } })) },
          },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  const login = (password: string) =>
    service.login({ nombre_usuario: USUARIO_LARGO, password } as any, '10.0.0.1');

  it('con la clave mala responde 401, no 500', async () => {
    await expect(login('la-que-no-es')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('guarda el nombre de usuario completo, sin recortarlo', async () => {
    await login('la-que-no-es').catch(() => {});

    expect(crearIntento).toHaveBeenCalledTimes(1);
    const { data } = (crearIntento.mock.calls[0] as any[])[0];
    expect(data.rut_intentado).toBe(USUARIO_LARGO);
    // El largo real del dato tiene que caber en la columna que declara el
    // esquema; si alguien vuelve a angostarla, esto lo delata.
    expect(data.rut_intentado.length).toBeLessThanOrEqual(50);
  });

  it('si no puede anotar el intento igual responde 401 y deja el fallo en el log', async () => {
    const error = new Error('value too long for type character varying(12)');
    crearIntento.mockRejectedValue(error);
    const registrado = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    await expect(login('la-que-no-es')).rejects.toBeInstanceOf(UnauthorizedException);

    // Callarse seria peor que el 500: el bloqueo por intentos dejaria de
    // protegernos y nadie se enteraria.
    expect(registrado).toHaveBeenCalled();
    expect(String((registrado.mock.calls[0] as any[])[0])).toContain(USUARIO_LARGO);
  });

  it('con la clave correcta entra y no anota ningun intento', async () => {
    await expect(login('LaBuena.2026')).resolves.toMatchObject({ rol: 'TECNICO' });
    expect(crearIntento).not.toHaveBeenCalled();
  });
});
