import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * CU-20: al crear la OT de instalacion, el jefe tecnico elige un puerto LIBRE
 * de la caja. Queda RESERVADO para el cliente hasta que el tecnico confirma la
 * instalacion al cerrar la OT, y ahi pasa a OCUPADO. Si la OT se cancela, el
 * puerto vuelve a LIBRE.
 */
describe('reserva de puerto NAP en la OT de instalacion (CU-20)', () => {
  const jefe = { userId: 3, id_empresa: 1, rol: 'JEFE_TECNICO' };
  const tecnico = { userId: 7, id_empresa: 1, rol: 'TECNICO' };
  let puerto: any;
  let ot: any;
  const puertoUpdate = jest.fn(async (_a: any) => ({}));
  const puertoUpdateMany = jest.fn(async (_a: any) => ({ count: 1 }));
  const crearOt = jest.fn(async (a: any) => ({ id_ot: 900, ...a.data }));
  let service: OrdenesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    puerto = { id_puerto: 23, id_caja_nap: 5, estado: 'LIBRE', id_cliente_asociado: null };
    ot = { id_ot: 900, id_empresa: 1, id_cliente: 10, id_tecnico: 7, id_caja_nap: 5, estado: 'EN_CURSO', tipo_ot: 'INSTALACION', id_ticket: null };
    const tx = {
      orden_trabajo: { create: crearOt, update: jest.fn(async () => ({})) },
      historial_ot: { create: jest.fn(async () => ({})) },
      log_auditoria: { create: jest.fn(async () => ({})) },
      puerto_nap: { update: puertoUpdate, updateMany: puertoUpdateMany },
      evidencia_foto: { createMany: jest.fn(async () => ({})) },
      uso_material_ot: { createMany: jest.fn(async () => ({})) },
      llamada_cortes: { create: jest.fn(async () => ({})) },
    };
    const mod = await Test.createTestingModule({
      providers: [
        OrdenesService,
        {
          provide: PrismaService,
          useValue: {
            cliente: {
              findFirst: jest.fn(async () => ({ id_cliente: 10, es_conflictivo: false, direcciones: [] })),
            },
            puerto_nap: {
              findFirst: jest.fn(async (a: any) =>
                a.where.id_puerto === 23 && a.where.caja_nap?.id_empresa === 1 ? puerto : null,
              ),
            },
            lista_negra: { findMany: jest.fn(async () => []) },
            orden_trabajo: {
              findFirst: jest.fn(async (a: any) => (a.include ? { ...ot, materiales: [], fotos: [], historial: [] } : { ...ot })),
              findUnique: jest.fn(async () => ({ ...ot, fecha_creacion: new Date(), cliente: null, direccion: null, categoria_falla: null, materiales: [], fotos: [], llamada: null, solicitud_integracion: null })),
            },
            tipo_equipo: { count: jest.fn(async () => 0) },
            $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
          },
        },
        { provide: ReparacionesRecurrentesService, useValue: { evaluar: jest.fn() } },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: { emitirActualizacion: jest.fn() } },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar: jest.fn() } },
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
      ],
    }).compile();
    service = mod.get(OrdenesService);
  });

  const instalacion = (extra: Record<string, unknown> = {}) => ({ rut_cliente: '12345678-5', tipo_ot: 'INSTALACION', ...extra });

  it('crear la instalacion con un puerto LIBRE lo reserva para el cliente y liga la caja a la OT', async () => {
    await service.crearOT(instalacion({ id_puerto: 23 }), 3, 1, { rol: 'JEFE_TECNICO' });

    expect(crearOt.mock.calls[0][0].data).toMatchObject({ id_caja_nap: 5 });
    expect(puertoUpdate).toHaveBeenCalledWith({ where: { id_puerto: 23 }, data: { estado: 'RESERVADO', id_cliente_asociado: 10 } });
  });

  it('un puerto que no esta LIBRE no se reserva', async () => {
    puerto.estado = 'OCUPADO';
    await expect(service.crearOT(instalacion({ id_puerto: 23 }), 3, 1, {})).rejects.toThrow('no está libre');
    expect(crearOt).not.toHaveBeenCalled();
  });

  it('un puerto de otra empresa no existe', async () => {
    await expect(service.crearOT(instalacion({ id_puerto: 99 }), 3, 1, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo una instalacion reserva puerto', async () => {
    await expect(service.crearOT(instalacion({ tipo_ot: 'REPARACION', id_puerto: 23 }), 3, 1, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('al cerrar la instalacion, el puerto reservado del cliente pasa a OCUPADO', async () => {
    const foto = { url_cloudinary: 'https://res.cloudinary.com/x/y.jpg', formato: 'jpg', tamano_kb: 1 };
    await service.cerrarOT(900, { fotos: [foto], materiales: [], potencia_optica_dbm: -21 }, tecnico);

    expect(puertoUpdateMany).toHaveBeenCalledWith({
      where: { id_caja_nap: 5, estado: 'RESERVADO', id_cliente_asociado: 10 },
      data: { estado: 'OCUPADO' },
    });
  });

  it('cancelar la instalacion libera el puerto reservado', async () => {
    ot.estado = 'ASIGNADA';
    await service.actualizarEstado(900, { estado: 'CANCELADA', obs_cancelacion: 'El cliente se arrepintio' }, jefe);

    expect(puertoUpdateMany).toHaveBeenCalledWith({
      where: { id_caja_nap: 5, estado: 'RESERVADO', id_cliente_asociado: 10 },
      data: { estado: 'LIBRE', id_cliente_asociado: null },
    });
  });

  it('CU-25: cerrar la OT-BAJA-PUERTO deja LIBRE el puerto ocupado por el cliente', async () => {
    ot.tipo_ot = 'BAJA';
    const foto = { url_cloudinary: 'https://res.cloudinary.com/x/y.jpg', formato: 'jpg', tamano_kb: 1 };
    await service.cerrarOT(900, { fotos: [foto], materiales: [], potencia_optica_dbm: -21 }, tecnico);

    expect(puertoUpdateMany).toHaveBeenCalledWith({
      where: { id_caja_nap: 5, estado: 'OCUPADO', id_cliente_asociado: 10 },
      data: { estado: 'LIBRE', id_cliente_asociado: null },
    });
  });
});
