import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';
import { ADVERTENCIA_DIRECCION, MENSAJE_SOLO_ADMIN, mensajeVetado } from '../clientes/lista-roja.js';

/**
 * CU-35 al crear la OT: un cliente en ROJO no recibe instalacion; el
 * administrador puede anular el bloqueo con una justificacion escrita, que
 * queda en la auditoria; y una direccion con antecedentes da una advertencia.
 */
describe('lista roja al crear una OT (CU-35)', () => {
  let cliente: any;
  let filasListaNegra: any[];
  const crearOt = jest.fn(async (a: any) => ({ id_ot: 900, ...a.data }));
  const auditar = jest.fn(async (_a: any) => ({}));
  let service: OrdenesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    filasListaNegra = [];
    cliente = {
      id_cliente: 10,
      es_conflictivo: true,
      obs_conflictivo: 'Deuda impaga de tres meses sin acuerdo',
      direcciones: [{ id_direccion: 55, direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' }],
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdenesService,
        {
          provide: PrismaService,
          useValue: {
            cliente: { findFirst: jest.fn(async () => cliente) },
            direccion_servicio: {
              findFirst: jest.fn(async (a: any) => (a.where.id_direccion === 56 && a.where.id_cliente === 10 ? { id_direccion: 56, direccion_completa: 'Otra 1', comuna: 'Maipú' } : null)),
            },
            lista_negra: { findMany: jest.fn(async () => filasListaNegra) },
            orden_trabajo: { findUnique: jest.fn(async () => ({ id_ot: 900 })) },
            $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
              fn({ orden_trabajo: { create: crearOt }, historial_ot: { create: jest.fn() }, log_auditoria: { create: auditar } }),
            ),
          },
        },
        { provide: ReparacionesRecurrentesService, useValue: {} },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: {} },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar: jest.fn() } },
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
      ],
    }).compile();
    service = moduleRef.get(OrdenesService);
  });

  const instalacion = (extra: Record<string, unknown> = {}) => ({ rut_cliente: '12345678-5', tipo_ot: 'INSTALACION', ...extra });
  const justificacion = 'Pagó la deuda completa ayer, comprobante 4471';

  it('bloquea la instalacion de un cliente vetado con el mensaje del CU', async () => {
    await expect(service.crearOT(instalacion(), 3, 1, { rol: 'ADMIN' })).rejects.toThrow(
      mensajeVetado('Deuda impaga de tres meses sin acuerdo'),
    );
    expect(crearOt).not.toHaveBeenCalled();
  });

  it('solo el administrador puede anular el bloqueo', async () => {
    await expect(
      service.crearOT(instalacion({ justificacion_lista_roja: justificacion }), 3, 1, { rol: 'JEFE_TECNICO' }),
    ).rejects.toThrow(MENSAJE_SOLO_ADMIN);
    await expect(
      service.crearOT(instalacion({ justificacion_lista_roja: justificacion }), 3, 1, { rol: 'JEFE_TECNICO' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(crearOt).not.toHaveBeenCalled();
  });

  it('la anulacion exige justificacion escrita y queda en la auditoria', async () => {
    await expect(
      service.crearOT(instalacion({ justificacion_lista_roja: 'porque si' }), 1, 1, { rol: 'ADMIN' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.crearOT(instalacion({ justificacion_lista_roja: justificacion }), 1, 1, { rol: 'ADMIN' });
    expect(crearOt).toHaveBeenCalled();
    expect(auditar).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_usuario: 1,
        accion: 'ANULAR_BLOQUEO_LISTA_ROJA',
        entidad_afectada: 'orden_trabajo',
        id_entidad_afectada: 900,
        valor_nuevo: { justificacion, motivo_bloqueo: 'Deuda impaga de tres meses sin acuerdo' },
      }),
    });
  });

  it('una reparacion para un cliente vetado sigue permitida', async () => {
    await service.crearOT(instalacion({ tipo_ot: 'REPARACION' }), 3, 1, { rol: 'JEFE_TECNICO' });
    expect(crearOt).toHaveBeenCalled();
  });

  it('una direccion con antecedentes no bloquea, pero la OT vuelve con la advertencia', async () => {
    cliente.es_conflictivo = false;
    const fila = { id_vetado: 1, id_cliente: 20, nivel: 'ROJO', direccion_vetada: 'AV EJEMPLO 1234, LA PINTANA' };
    filasListaNegra = [fila];
    const ot = await service.crearOT(instalacion(), 3, 1, { rol: 'JEFE_TECNICO' });
    expect(ot).toMatchObject({ advertencia_lista_roja: ADVERTENCIA_DIRECCION });
  });

  it('sin antecedentes la advertencia es null', async () => {
    cliente.es_conflictivo = false;
    const ot = await service.crearOT(instalacion(), 3, 1, { rol: 'JEFE_TECNICO' });
    expect(ot).toMatchObject({ advertencia_lista_roja: null });
  });

  it('una direccion que no es del cliente es 400, no una OT apuntando a otra casa', async () => {
    cliente.es_conflictivo = false;
    await expect(service.crearOT(instalacion({ id_direccion: 999 }), 3, 1, { rol: 'ADMIN' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.crearOT(instalacion({ id_direccion: 56 }), 3, 1, { rol: 'ADMIN' });
    expect(crearOt.mock.calls[0][0].data.id_direccion).toBe(56);
  });
});
