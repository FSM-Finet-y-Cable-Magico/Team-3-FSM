import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';
import { construirPayloadCierre, INCLUDE_PAYLOAD_CIERRE } from './fan-out/payload-cierre.js';

/**
 * Lo que se notifica a G1 y G8 al cerrar tiene que ser exactamente lo que
 * despues devuelve el GET de reconciliacion. La unica forma de garantizarlo es
 * que los dos lean la misma fila y la pasen por el mismo constructor.
 */
describe('fan-out del cierre', () => {
  const guardada = {
    id_ot: 781,
    id_empresa: 1,
    tipo_ot: 'INSTALACION',
    id_tecnico: 7,
    estado: 'COMPLETADA',
    id_cliente: null,
    fecha_completada: new Date('2026-10-01T20:15:00.000Z'),
    fecha_creacion: new Date('2026-09-29T18:00:00.000Z'),
    potencia_optica_dbm: { toString: () => '-21' },
    resuelto_remotamente: false,
    categoria_falla_otro: null,
    cierre_equipos: null,
    cliente: null,
    direccion: { direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' },
    categoria_falla: null,
    materiales: [],
    fotos: [],
    llamada: { resultado: 'CONFORME' },
    solicitud_integracion: {
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      trace_id: '6f1d7d17-3f7d-4db8-93a8-87e8d7ce0031',
      id_prospecto_externo: 45,
      id_contrato_externo: 92,
      id_plan_externo: 15,
    },
  };
  const notificar = jest.fn(async (_p: unknown) => {});
  const findUnique = jest.fn(async (_a: any): Promise<any> => guardada);
  const tx = {
    evidencia_foto: { createMany: jest.fn(async () => ({})) },
    uso_material_ot: { createMany: jest.fn(async () => ({})) },
    llamada_cortes: { create: jest.fn(async () => ({})) },
    orden_trabajo: { update: jest.fn(async () => ({})) },
    historial_ot: { create: jest.fn(async () => ({})) },
    log_auditoria: { create: jest.fn(async () => ({})) },
  };
  let service: OrdenesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdenesService,
        {
          provide: PrismaService,
          useValue: {
            orden_trabajo: {
              findFirst: jest.fn(async () => ({ id_ot: 781, id_empresa: 1, id_tecnico: 7, estado: 'EN_CURSO', tipo_ot: 'INSTALACION' })),
              findUnique,
            },
            tipo_equipo: { count: jest.fn(async () => 0) },
            $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
          },
        },
        { provide: ReparacionesRecurrentesService, useValue: { evaluar: jest.fn() } },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: { emitirActualizacion: jest.fn() } },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar } },
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
      ],
    }).compile();
    service = moduleRef.get(OrdenesService);
  });

  const cerrar = () =>
    service.cerrarOT(
      781,
      { fotos: [], materiales: [], potencia_optica_dbm: -21, resultado_llamada: 'CONFORME' },
      { userId: 7, id_empresa: 1, rol: 'TECNICO' },
    );

  it('notifica el payload armado desde la fila guardada, con la correlacion de G8', async () => {
    await cerrar();
    await new Promise((r) => setImmediate(r));

    expect(findUnique).toHaveBeenCalledWith({ where: { id_ot: 781 }, include: INCLUDE_PAYLOAD_CIERRE });
    expect(notificar).toHaveBeenCalledWith(construirPayloadCierre(guardada as never));
    expect(notificar.mock.calls[0][0]).toMatchObject({ request_id: '550e8400-e29b-41d4-a716-446655440000', id_contrato: 92 });
  });

  it('si armar el payload falla, el cierre ya guardado no se cae', async () => {
    // El fan-out es best-effort: el cierre se comprometio antes. Un error aca
    // se registra y G1/G8 reconcilian por GET.
    findUnique.mockImplementation(async (a: any) => (a.include === INCLUDE_PAYLOAD_CIERRE ? null : guardada));

    await expect(cerrar()).resolves.toMatchObject({ id_ot: 781 });
    await new Promise((r) => setImmediate(r));
    expect(notificar).not.toHaveBeenCalled();
    findUnique.mockImplementation(async () => guardada);
  });
});
