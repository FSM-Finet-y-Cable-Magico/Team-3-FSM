import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService, MENSAJE_SIN_CLIENTES_EN_DIRECCION } from './clientes.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * CU-07: historial de cliente por direccion. Se buscan todos los clientes
 * asociados a la direccion, actuales y anteriores (una direccion que no es la
 * principal es una anterior), y se elige uno para ver su ficha (CU-06).
 *
 * `orden_trabajo` no tiene indice por `id_direccion`, asi que no se busca por
 * las OT: se buscan las direcciones de la comuna y se filtra en memoria, con
 * la misma normalizacion que la lista roja (sin tildes ni puntuacion).
 */
describe('clientes por direccion (CU-07)', () => {
  const direcciones = [
    { id_direccion: 1, direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana', es_principal: true,
      cliente: { id_cliente: 10, rut: '12345678-5', nombre_completo: 'Ana Soto', estado: 'ACTIVO' } },
    { id_direccion: 2, direccion_completa: 'AVENIDA EJEMPLO 1234 depto 5', comuna: 'La Pintana', es_principal: false,
      cliente: { id_cliente: 11, rut: '11111111-1', nombre_completo: 'Luis Paz', estado: 'BAJA' } },
    { id_direccion: 3, direccion_completa: 'Av. Ejemplo 999', comuna: 'La Pintana', es_principal: true,
      cliente: { id_cliente: 12, rut: '22222222-2', nombre_completo: 'Otra Persona', estado: 'ACTIVO' } },
  ];
  const findMany = jest.fn(async (_a: any) => direcciones);
  let service: ClientesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: {} },
        { provide: PrismaService, useValue: { direccion_servicio: { findMany } } },
      ],
    }).compile();
    service = mod.get(ClientesService);
  });

  it('busca en la comuna, dentro de la empresa, solo direcciones con cliente', async () => {
    await service.buscarPorDireccion(1, { calle: 'Ejemplo', numero: '1234', comuna: 'la pintana' });
    expect(findMany.mock.calls[0][0].where).toEqual({
      id_cliente: { not: null },
      cliente: { id_empresa: 1 },
      comuna: { equals: 'la pintana', mode: 'insensitive' },
    });
  });

  it('encuentra al cliente actual y al anterior aunque escriban distinto la calle', async () => {
    const r = await service.buscarPorDireccion(1, { calle: 'ejemplo', numero: '1234', comuna: 'La Pintana' });
    expect(r).toEqual([
      { id_cliente: 10, rut: '12345678-5', nombre_completo: 'Ana Soto', estado: 'ACTIVO', direccion: 'Av. Ejemplo 1234, La Pintana', actual: true },
      { id_cliente: 11, rut: '11111111-1', nombre_completo: 'Luis Paz', estado: 'BAJA', direccion: 'AVENIDA EJEMPLO 1234 depto 5, La Pintana', actual: false },
    ]);
  });

  it('el numero tiene que coincidir entero, no como parte de otro', async () => {
    const r = await service.buscarPorDireccion(1, { calle: 'Ejemplo', numero: '99', comuna: 'La Pintana' });
    expect(r).toEqual([]);
  });

  it('sin datos no busca', async () => {
    await expect(service.buscarPorDireccion(1, { calle: ' ', numero: '', comuna: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('el mensaje de sin resultados es el del CU', () => {
    expect(MENSAJE_SIN_CLIENTES_EN_DIRECCION).toBe(
      'No se encontraron clientes en esa dirección. Verifique la información ingresada.',
    );
  });
});
