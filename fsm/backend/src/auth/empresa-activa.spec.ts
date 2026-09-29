import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, HEADER_EMPRESA_ACTIVA } from './jwt.strategy.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-33, cambio de empresa activa. El ADMIN administra las dos empresas
 * (FiNet y Cable Magico) y elige con cual trabaja; los demas roles quedan
 * siempre en la de su token.
 *
 * Se resuelve en UN lugar --la estrategia JWT-- para que todo endpoint use la
 * empresa elegida sin que cada controller tenga que leer un parametro. Antes
 * solo cuatro controllers aceptaban `?empresa=` y el resto ignoraba la
 * eleccion en silencio.
 */
describe('empresa activa del ADMIN (CU-33)', () => {
  const findUnique = jest.fn(async (a: any) => (a.where.id_empresa === 2 ? { id_empresa: 2 } : null));
  const strategy = new JwtStrategy(
    { get: () => 'secreto' } as unknown as ConfigService,
    { empresa: { findUnique } } as unknown as PrismaService,
  );
  const payload = (rol: string) => ({ userId: 1, nombre_usuario: 'x', rol, id_empresa: 1 });
  const req = (valor?: string) => ({ headers: valor === undefined ? {} : { [HEADER_EMPRESA_ACTIVA]: valor } });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sin header, cada uno queda en la empresa de su token', async () => {
    await expect(strategy.validate(req(), payload('ADMIN'))).resolves.toMatchObject({ id_empresa: 1 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('el ADMIN trabaja sobre la empresa que eligio', async () => {
    await expect(strategy.validate(req('2'), payload('ADMIN'))).resolves.toMatchObject({ id_empresa: 2, rol: 'ADMIN' });
  });

  it.each(['JEFE_TECNICO', 'TECNICO'])('a %s el header no le cambia la empresa', async (rol) => {
    await expect(strategy.validate(req('2'), payload(rol))).resolves.toMatchObject({ id_empresa: 1 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-1', '1.5', '99'])('rechaza una empresa invalida o inexistente: %s', async (valor) => {
    await expect(strategy.validate(req(valor), payload('ADMIN'))).rejects.toBeInstanceOf(BadRequestException);
  });
});
