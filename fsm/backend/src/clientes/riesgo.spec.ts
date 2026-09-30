import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService } from './clientes.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';
import { MENSAJE_JUSTIFICACION_RIESGO, nivelVigente, normalizarDireccion } from './lista-roja.js';

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

describe('cambiar el nivel de riesgo (MOD RF-32)', () => {
  let filas: any[];
  let cliente: any;
  const actualizar = jest.fn(async (a: any) => Object.assign(cliente, a.data));
  const crearFila = jest.fn(async (a: any) => filas.unshift({ id_vetado: filas.length + 1, ...a.data }));
  const auditar = jest.fn(async (_a: any) => ({}));
  let service: ClientesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    filas = [];
    cliente = {
      id_cliente: 10,
      id_empresa: 1,
      rut: '12345678-5',
      es_conflictivo: false,
      obs_conflictivo: null,
      direcciones: [{ direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' }],
    };
    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            cliente: {
              findFirst: jest.fn(async (a: any) => (a.where.id_cliente === 10 && a.where.id_empresa === 1 ? cliente : null)),
            },
            lista_negra: { findMany: jest.fn(async () => filas) },
            $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
              fn({ cliente: { update: actualizar }, lista_negra: { create: crearFila }, log_auditoria: { create: auditar } }),
            ),
          },
        },
      ],
    }).compile();
    service = mod.get(ClientesService);
  });

  const motivo = 'Agredió verbalmente al técnico en la visita';

  it('AMARILLO y ROJO exigen 20 caracteres de justificacion, con el texto del CU', async () => {
    await expect(service.cambiarNivelRiesgo(10, { nivel: 'ROJO', motivo: 'muy corto' }, 3, 1)).rejects.toThrow(
      MENSAJE_JUSTIFICACION_RIESGO,
    );
    await expect(service.cambiarNivelRiesgo(10, { nivel: 'AMARILLO' }, 3, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(crearFila).not.toHaveBeenCalled();
  });

  it('AMARILLO avisa pero no bloquea: no es conflictivo ni guarda direccion', async () => {
    await service.cambiarNivelRiesgo(10, { nivel: 'AMARILLO', motivo }, 3, 1);

    expect(crearFila).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_cliente: 10, rut_vetado: '12345678-5', nivel: 'AMARILLO', motivo, direccion_vetada: null, id_usuario_registro: 3 }),
    });
    expect(cliente).toMatchObject({ es_conflictivo: false, obs_conflictivo: motivo });
    expect(auditar).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accion: 'CAMBIAR_NIVEL_RIESGO',
        entidad_afectada: 'cliente',
        id_entidad_afectada: 10,
        valor_anterior: { nivel: 'VERDE' },
        valor_nuevo: { nivel: 'AMARILLO', motivo },
      }),
    });
  });

  it('ROJO es conflictivo y deja la direccion en la lista roja (CU-35)', async () => {
    await service.cambiarNivelRiesgo(10, { nivel: 'ROJO', motivo }, 3, 1);
    expect(crearFila.mock.calls[0][0].data).toMatchObject({ nivel: 'ROJO', direccion_vetada: 'Av. Ejemplo 1234, La Pintana' });
    expect(cliente.es_conflictivo).toBe(true);
  });

  it('volver a VERDE no pide justificacion y apaga el indicador', async () => {
    filas = [{ id_vetado: 1, nivel: 'ROJO' }];
    await service.cambiarNivelRiesgo(10, { nivel: 'VERDE' }, 3, 1);
    expect(cliente).toMatchObject({ es_conflictivo: false, obs_conflictivo: null });
    expect(auditar.mock.calls[0][0].data.valor_anterior).toEqual({ nivel: 'ROJO' });
  });

  it('el mismo nivel no escribe nada', async () => {
    await expect(service.cambiarNivelRiesgo(10, { nivel: 'VERDE' }, 3, 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(crearFila).not.toHaveBeenCalled();
  });

  it('404 fuera de la empresa', async () => {
    await expect(service.cambiarNivelRiesgo(10, { nivel: 'ROJO', motivo }, 3, 2)).rejects.toBeInstanceOf(NotFoundException);
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
