import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClientesService } from './clientes.service.js';
import { ClientesController } from './clientes.controller.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * CU-25: baja de servicio. El cliente pasa a BAJA y se generan dos OT en
 * PENDIENTE: OT-BAJA-PUERTO (desconectar el puerto NAP, que queda LIBRE al
 * cerrarla) y OT-BAJA-EQUIPO (retirar la ONT). Queda en el historial del
 * cliente y en la auditoria.
 *
 * La excepcion 1 (deuda pendiente) necesita datos comerciales que G3 no tiene
 * --CU-36 quedo fuera de alcance por eso--: se exige confirmar explicitamente
 * que no hay deuda, y sin esa confirmacion no se registra la baja.
 */
describe('baja de servicio (CU-25)', () => {
  const jefe = { userId: 3, id_empresa: 1 };
  let cliente: any;
  let siguienteOt: number;
  const crearOt = jest.fn(async (a: any) => ({ id_ot: siguienteOt++, ...a.data }));
  const actualizarCliente = jest.fn(async (_a: any) => ({}));
  const historial = jest.fn(async (_a: any) => ({}));
  const auditar = jest.fn(async (_a: any) => ({}));
  let service: ClientesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    siguienteOt = 500;
    cliente = {
      id_cliente: 10, id_empresa: 1, rut: '12345678-5', nombre_completo: 'Ana Soto', estado: 'ACTIVO',
      direcciones: [{ id_direccion: 55, direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' }],
    };
    const mod = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: {} },
        {
          provide: PrismaService,
          useValue: {
            cliente: { findFirst: jest.fn(async (a: any) => (a.where.id_cliente === 10 && a.where.id_empresa === 1 ? cliente : null)) },
            registro_ont: { findMany: jest.fn(async () => [{ numero_serie: 'ZTEG1234' }]) },
            puerto_nap: {
              findMany: jest.fn(async () => [
                { id_puerto: 23, numero_puerto: 3, id_caja_nap: 5, caja_nap: { identificador_unico: 'NAP-B' } },
              ]),
            },
            $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
              fn({
                cliente: { update: actualizarCliente },
                orden_trabajo: { create: crearOt },
                historial_ot: { create: historial },
                log_auditoria: { create: auditar },
              }),
            ),
          },
        },
      ],
    }).compile();
    service = mod.get(ClientesService);
  });

  it('el resumen trae lo que muestra el formulario: direccion, ONT, caja y puerto', async () => {
    await expect(service.resumenBaja(10, 1)).resolves.toEqual({
      id_cliente: 10,
      nombre_completo: 'Ana Soto',
      rut: '12345678-5',
      estado: 'ACTIVO',
      direccion: 'Av. Ejemplo 1234, La Pintana',
      onts: ['ZTEG1234'],
      puertos: [{ id_puerto: 23, numero_puerto: 3, id_caja_nap: 5, caja: 'NAP-B' }],
      motivos: ['VOLUNTARIA', 'MOROSIDAD', 'FUERZA_MAYOR', 'MUDANZA_SIN_COBERTURA'],
    });
  });

  it('pasa el cliente a BAJA y genera las dos OT pendientes', async () => {
    const r = await service.darDeBaja(10, { motivo: 'MUDANZA_SIN_COBERTURA', confirma_sin_deuda: true }, jefe);

    expect(actualizarCliente).toHaveBeenCalledWith({ where: { id_cliente: 10 }, data: { estado: 'BAJA' } });
    expect(crearOt).toHaveBeenCalledTimes(2);
    expect(crearOt.mock.calls[0][0].data).toMatchObject({
      id_empresa: 1, id_cliente: 10, id_direccion: 55, id_caja_nap: 5, tipo_ot: 'BAJA', estado: 'PENDIENTE', prioridad: 'MEDIA',
      observaciones: expect.stringMatching(/^OT-BAJA-PUERTO: desconectar el puerto 3 de la caja NAP-B/),
    });
    expect(crearOt.mock.calls[1][0].data).toMatchObject({
      id_cliente: 10, tipo_ot: 'BAJA', estado: 'PENDIENTE',
      observaciones: expect.stringMatching(/^OT-BAJA-EQUIPO: retirar la ONT ZTEG1234/),
    });
    expect(crearOt.mock.calls[1][0].data.id_caja_nap).toBeUndefined();
    expect(auditar).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accion: 'BAJA_SERVICIO', entidad_afectada: 'cliente', id_entidad_afectada: 10,
        valor_anterior: { estado: 'ACTIVO' },
        valor_nuevo: { estado: 'BAJA', motivo: 'MUDANZA_SIN_COBERTURA', ot_baja_puerto: 500, ot_baja_equipo: 501 },
      }),
    });
    expect(r).toEqual({ id_cliente: 10, estado: 'BAJA', ot_baja_puerto: 500, ot_baja_equipo: 501 });
  });

  it('sin confirmar que no hay deuda, no registra la baja', async () => {
    await expect(service.darDeBaja(10, { motivo: 'VOLUNTARIA', confirma_sin_deuda: false }, jefe)).rejects.toThrow('deuda');
    expect(actualizarCliente).not.toHaveBeenCalled();
  });

  it('un cliente ya dado de baja no se vuelve a dar de baja; uno de otra empresa no existe', async () => {
    cliente.estado = 'BAJA';
    await expect(service.darDeBaja(10, { motivo: 'VOLUNTARIA', confirma_sin_deuda: true }, jefe)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.darDeBaja(10, { motivo: 'VOLUNTARIA', confirma_sin_deuda: true }, { ...jefe, id_empresa: 2 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('es de ADMIN y JEFE_TECNICO', () => {
    expect(Reflect.getMetadata('roles', ClientesController.prototype.darDeBaja)).toEqual(['ADMIN', 'JEFE_TECNICO']);
    expect(Reflect.getMetadata('roles', ClientesController.prototype.resumenBaja)).toEqual(['ADMIN', 'JEFE_TECNICO']);
  });
});
