import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';

// Verifica que llamar al servicio desde otro consumidor tampoco amplíe los roles.
// El doble solo devuelve la fila; no implementa la regla de autorización.
describe('autorización de OT desde el servicio', () => {
  const findFirst = jest.fn(async () => ({ id_ot: 1, id_empresa: 1, id_tecnico: 7, estado: 'EN_CURSO' }));
  const subirEvidencia = jest.fn();
  const notificar = jest.fn(async () => {});
  let service: OrdenesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({ providers: [
        {
          // Doble: estas pruebas no son de RF-08. La regla tiene su propio spec.
          provide: ReparacionesRecurrentesService,
          useValue: { evaluar: jest.fn(async () => ({ activa: false, total_reparaciones_30_dias: 0, ots: [] })) },
        },
      OrdenesService, { provide: PrismaService, useValue: { orden_trabajo: { findFirst } } },
      { provide: CloudinaryService, useValue: { subirEvidencia } },
      { provide: DashboardGateway, useValue: {} },
      // La rama de monitoreo le agrego al cierre un fan-out hacia los sistemas
      // de los otros grupos. Aca se dobla porque el test es sobre autorizacion:
      // las tres llamadas tienen que rebotar ANTES de llegar a notificar nada,
      // y el `not.toHaveBeenCalled` de abajo lo comprueba.
      { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar } },
    ] }).compile();
    service = moduleRef.get(OrdenesService);
  });
  it.each(['ADMIN', 'JEFE_TECNICO', 'DESCONOCIDO'])('no permite subir/cerrar a %s aunque coincida el usuario asignado', async rol => {
    const user = { userId: 7, id_empresa: 1, rol };
    await expect(service.subirFoto(1, undefined, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.cerrarOT(1, { fotos: [], materiales: [], potencia_optica_dbm: -21, resultado_llamada: 'CONFORME' }, user))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(subirEvidencia).not.toHaveBeenCalled();
    expect(notificar).not.toHaveBeenCalled();
  });
});

// Doble del Decimal de Prisma: no es un number y se entrega como string.
const decimal = (valor: string) => ({ toString: () => valor, valueOf: () => valor });

describe('detalle de OT para la vista', () => {
  let detalle: any;
  // comprobarAcceso consulta primero (solo id_tecnico) y obtenerDetalle despues.
  const findFirst = jest.fn(async (_args?: any) => detalle);
  let service: OrdenesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    detalle = {
      id_ot: 1,
      id_empresa: 1,
      id_tecnico: 7,
      potencia_optica_dbm: decimal('-21.50'),
      materiales: [{ id_uso: 1, cantidad: decimal('3.00'), tipo_equipo: { nombre: 'Roseta' } }],
      fotos: [],
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          // Doble: estas pruebas no son de RF-08. La regla tiene su propio spec.
          provide: ReparacionesRecurrentesService,
          useValue: { evaluar: jest.fn(async () => ({ activa: false, total_reparaciones_30_dias: 0, ots: [] })) },
        },
        OrdenesService,
        { provide: PrismaService, useValue: { orden_trabajo: { findFirst } } },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: {} },
        // El cierre notifica el uso de material a G1 (ver ACUERDO G1-G3 en
        // `cerrarOT`), asi que OrdenesService depende del fan-out aunque estas
        // pruebas solo lean el detalle. Se dobla para poder construirlo.
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar: async () => {} } },
      ],
    }).compile();
    service = moduleRef.get(OrdenesService);
  });

  it('entrega la potencia y las cantidades como numeros, no como Decimal', async () => {
    const ot = await service.obtenerOT(1, { userId: 1, id_empresa: 1, rol: 'ADMIN' });

    // Sin normalizar llegarian como "-21.50" y "3.00" a la vista.
    expect(ot.potencia_optica_dbm).toBe(-21.5);
    expect(ot.materiales[0].cantidad).toBe(3);
  });

  it('deja la potencia en null cuando la OT aun no tiene medicion', async () => {
    detalle.potencia_optica_dbm = null;

    const ot = await service.obtenerOT(1, { userId: 1, id_empresa: 1, rol: 'ADMIN' });

    expect(ot.potencia_optica_dbm).toBeNull();
  });

  it('acota las evidencias y los materiales que lee del detalle', async () => {
    await service.obtenerOT(1, { userId: 1, id_empresa: 1, rol: 'ADMIN' });
    const { fotos, materiales } = findFirst.mock.calls[1][0].include;

    expect(fotos.take).toBeGreaterThan(0);
    expect(materiales.take).toBeGreaterThan(0);
  });
});
