// En ESM, Jest no inyecta los globals: hay que importarlos.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { ClientesService } from './clientes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * Como se guarda el RUT al dar de alta un cliente.
 *
 * El §11 del Documento 0 fija el almacenamiento sin puntos ni guion
 * ("formatear solo en UI"), y G2 ya lo cumple. Nuestro alta guardaba `dto.rut`
 * crudo, asi que por API entraba cualquier grafia: en el respaldo de
 * produccion del 29-09 habia 14 filas con guion y 11 sin guion.
 *
 * Importa mas de lo que parece: `cliente.rut` es `@unique`, pero el constraint
 * es sobre el texto, y "12345678-5" y "123456785" son textos distintos. Con
 * grafias mezcladas, la base deja entrar dos veces a la misma persona.
 */
describe('el alta guarda el RUT en forma canonica', () => {
  let create: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
  let findFirst: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
  let service: ClientesService;

  const dto = (rut: string) =>
    ({
      rut,
      nombre_completo: 'Ana Soto',
      direccion_completa: 'Av. Costanera 100',
      comuna: 'Cartagena',
      ciudad: 'San Antonio',
    }) as never;

  /** El RUT con que quedo llamado `cliente.create`. */
  const rutGuardado = () =>
    (create.mock.calls[0][0] as { data: { rut: string } }).data.rut;

  beforeEach(async () => {
    jest.clearAllMocks();
    create = jest.fn(() => Promise.resolve({ id_cliente: 1, direcciones: [] }));
    findFirst = jest.fn(() => Promise.resolve(null));

    const tx = {
      cliente: { create },
      contrato: { create: jest.fn(() => Promise.resolve({})) },
      log_auditoria: { create: jest.fn(() => Promise.resolve({})) },
    };
    const prisma = {
      cliente: { findFirst },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: PrismaService, useValue: prisma },
        // Doble: el alta no ejercita RF-08, que tiene su propio spec.
        { provide: ReparacionesRecurrentesService, useValue: {} },
      ],
    }).compile();

    service = mod.get(ClientesService);
  });

  it('guarda sin puntos ni guion, venga como venga', async () => {
    for (const entrada of ['12.345.678-5', '12345678-5', '123456785']) {
      jest.clearAllMocks();
      create.mockResolvedValue({ id_cliente: 1, direcciones: [] });
      findFirst.mockResolvedValue(null);

      await service.registrarCliente(dto(entrada), 1, 1);

      expect(rutGuardado()).toBe('123456785');
    }
  });

  it('guarda la K en mayuscula', async () => {
    // 21116770-K es valido con K; la grafia en minuscula es la que llegaba de
    // los formularios y dejaba dos textos distintos para la misma persona.
    await service.registrarCliente(dto('21116770-k'), 1, 1);
    expect(rutGuardado()).toBe('21116770K');
  });

  it('busca el duplicado en todas las grafias, no solo en la canonica', async () => {
    // La fila vieja quedo con guion. Si el chequeo comparara solo contra el
    // valor canonico, no la encontraria y entraria la misma persona dos veces:
    // el @unique de la columna tampoco la frena, porque son textos distintos.
    findFirst.mockResolvedValue({ id_cliente: 7 });

    await expect(
      service.registrarCliente(dto('123456785'), 1, 1),
    ).rejects.toThrow(ConflictException);

    const where = (
      findFirst.mock.calls[0][0] as { where: { rut: { in: string[] } } }
    ).where;
    expect(where.rut.in).toEqual(
      expect.arrayContaining(['123456785', '12345678-5', '12.345.678-5']),
    );
    expect(create).not.toHaveBeenCalled();
  });
});
