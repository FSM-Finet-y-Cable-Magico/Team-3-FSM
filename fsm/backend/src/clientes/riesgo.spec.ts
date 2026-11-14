import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService } from './clientes.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';
import { nivelVigente, normalizarDireccion } from './lista-roja.js';

/**
 * MOD RF-32: el indicador binario "conflictivo" pasa a un semaforo VERDE,
 * AMARILLO o ROJO. D3 del plan: el nivel no es una columna de `cliente` sino
 * la ultima fila del cliente en `lista_negra` (tabla de G3), y
 * `cliente.es_conflictivo` se mantiene igual a (nivel === ROJO), asi lo que ya
 * lo lee sigue funcionando.
 *
 * CU-35: al pasar a ROJO se guarda la direccion, para avisar si otra persona
 * pide servicio en una direccion con antecedentes.
 */
describe('normalizarDireccion', () => {
  it('ignora mayusculas, tildes, puntuacion y espacios', () => {
    expect(normalizarDireccion('Av. Ejemplo 1234, La Pintana')).toBe(normalizarDireccion('AV EJEMPLO  1234 la pintana'));
    expect(normalizarDireccion('Pasaje Ñandú 12, Peñalolén')).toBe(normalizarDireccion('pasaje ñandu 12 penalolen'));
  });
});

describe('nivelVigente', () => {
  it('sin filas es VERDE; la ultima fila manda; una fila vieja sin nivel era conflictivo, o sea ROJO', () => {
    expect(nivelVigente([])).toBe('VERDE');
    expect(nivelVigente([{ nivel: null }])).toBe('ROJO');
    expect(nivelVigente([{ nivel: 'VERDE' }, { nivel: 'ROJO' }])).toBe('VERDE');
  });
});

describe('verificar la lista roja (CU-35)', () => {
  let service: ClientesService;
  const clientePorRut = jest.fn(async (_a: any): Promise<any> => null);
  const filasEmpresa = jest.fn(async (_a: any): Promise<any[]> => []);

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: {} },
        {
          provide: PrismaService,
          useValue: { cliente: { findFirst: clientePorRut }, lista_negra: { findMany: filasEmpresa } },
        },
      ],
    }).compile();
    service = mod.get(ClientesService);
  });

  it('un cliente en ROJO esta vetado, con su motivo', async () => {
    clientePorRut.mockResolvedValueOnce({ id_cliente: 10, es_conflictivo: true, obs_conflictivo: 'Deuda impaga de 3 meses sin acuerdo' });
    const r = await service.verificarListaRoja(1, { rut: '12345678-5' });
    expect(r.vetado).toEqual({ motivo: 'Deuda impaga de 3 meses sin acuerdo' });
    expect(r.mensaje).toContain('CLIENTE VETADO — Motivo: Deuda impaga de 3 meses sin acuerdo');
  });

  it('una direccion con antecedentes da la advertencia del CU, sin bloquear', async () => {
    const fila = { id_vetado: 5, id_cliente: 20, nivel: 'ROJO', direccion_vetada: 'Av. Ejemplo 1234, La Pintana' };
    // Primero las direcciones vetadas de la empresa; despues, el nivel vigente
    // de los clientes cuya direccion coincide.
    filasEmpresa.mockResolvedValueOnce([fila]).mockResolvedValueOnce([fila]);
    const r = await service.verificarListaRoja(1, { direccion_completa: 'AV EJEMPLO 1234', comuna: 'la pintana' });
    expect(r.vetado).toBeNull();
    expect(r.advertencia).toBe(
      'Esta dirección tiene antecedentes de clientes vetados. Verifique la identidad del solicitante antes de continuar.',
    );
    expect(filasEmpresa.mock.calls[0][0].where).toMatchObject({ cliente: { id_empresa: 1 }, direccion_vetada: { not: null } });
  });

  it('una direccion cuyo cliente ya volvio a VERDE no cuenta', async () => {
    const roja = { id_vetado: 5, id_cliente: 20, nivel: 'ROJO', direccion_vetada: 'Av. Ejemplo 1234, La Pintana' };
    filasEmpresa
      .mockResolvedValueOnce([roja])
      .mockResolvedValueOnce([{ id_vetado: 6, id_cliente: 20, nivel: 'VERDE', direccion_vetada: null }, roja]);
    const r = await service.verificarListaRoja(1, { direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' });
    expect(r.advertencia).toBeNull();
  });
});
