import { describe, expect, it, jest } from '@jest/globals';
import type { PrismaService } from '../prisma/prisma.service.js';
import { clientesSuspendidos, esFaltaDePermiso } from './suspendidos.js';

const prismaCon = (findMany: (a?: any) => Promise<unknown>) =>
  ({ contrato: { findMany: jest.fn(findMany) } }) as unknown as PrismaService & { contrato: { findMany: jest.Mock } };

describe('clientesSuspendidos', () => {
  it('marca al cliente con un contrato suspendido y ninguno activo', async () => {
    const prisma = prismaCon(async () => [
      { id_cliente: 1, estado: 'Suspendido' },
      { id_cliente: 2, estado: '  SUSPENDIDO ' },
      { id_cliente: 3, estado: 'Activo' },
    ]);
    expect([...(await clientesSuspendidos(prisma, 1))].sort()).toEqual([1, 2]);
    expect(prisma.contrato.findMany.mock.calls[0][0]).toMatchObject({ where: { id_empresa: 1 } });
  });

  it('no marca al cliente que ademas tiene un contrato activo: no se sabe de cual es la ONT', async () => {
    const prisma = prismaCon(async () => [
      { id_cliente: 7, estado: 'Suspendido' },
      { id_cliente: 7, estado: 'activo' },
    ]);
    expect((await clientesSuspendidos(prisma, 1)).size).toBe(0);
  });

  it('si no puede leer contrato devuelve vacio y avisa, sin lanzar', async () => {
    const prisma = prismaCon(async () => {
      throw Object.assign(new Error('permission denied for table contrato'), { code: '42501' });
    });
    const warn = jest.fn();
    expect((await clientesSuspendidos(prisma, 1, { warn })).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('esFaltaDePermiso', () => {
  it('reconoce el 42501 de Postgres venga como venga', () => {
    expect(esFaltaDePermiso(Object.assign(new Error('x'), { code: '42501' }))).toBe(true);
    expect(esFaltaDePermiso(new Error('permission denied for table contrato'))).toBe(true);
    expect(esFaltaDePermiso({ meta: { driverAdapterError: { cause: { originalCode: '42501' } } } })).toBe(true);
    expect(esFaltaDePermiso(new Error('connection refused'))).toBe(false);
  });
});
