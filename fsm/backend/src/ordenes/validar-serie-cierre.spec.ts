import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { OrdenesController } from './ordenes.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * La serie de cada equipo se valida contra `unidad_equipo` al cerrar, no
 * despues de que G1 procese el cierre (las reglas finas estan en
 * validar-equipos.spec.ts). Aca se protege el cableado: que `cerrarOT` consulte
 * el inventario, que un problema corte el cierre ANTES de escribir nada, y que
 * el tecnico pueda pedir la lista de lo que lleva encima.
 */
describe('cierre · validacion de la serie contra el inventario', () => {
  const tecnico = { userId: 5, id_empresa: 1, rol: 'TECNICO' };
  let inventario: Record<string, unknown>[];
  const tx = {
    evidencia_foto: { createMany: jest.fn(async () => ({})) },
    uso_material_ot: { createMany: jest.fn(async () => ({})) },
    orden_trabajo: {
      update: jest.fn(async (a: any) => ({ id_ot: 40, ...a.data })),
    },
    historial_ot: { create: jest.fn(async () => ({})) },
    log_auditoria: { create: jest.fn(async () => ({})) },
    ticket: { updateMany: jest.fn(async () => ({ count: 0 })) },
    puerto_nap: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const findMany = jest.fn(async (_a: any) => inventario);
  const prisma = {
    orden_trabajo: {
      findFirst: jest.fn(async () => ({
        id_ot: 40,
        id_empresa: 1,
        id_tecnico: 5,
        estado: 'EN_CURSO',
        tipo_ot: 'REPARACION',
        id_ticket: null,
        id_cliente: null,
        id_caja_nap: null,
        fecha_completada: null,
      })),
      findUnique: jest.fn(async () => null),
    },
    categoria_falla: {
      findUnique: jest.fn(async () => ({
        id_categoria: 3,
        nombre: 'Internet lento',
        sla_horas: 4,
      })),
    },
    tipo_equipo: { count: jest.fn(async () => 0) },
    unidad_equipo: { findMany },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };

  let service: OrdenesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    inventario = [];
    const mod = await Test.createTestingModule({
      providers: [
        OrdenesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ReparacionesRecurrentesService,
          useValue: { evaluar: jest.fn() },
        },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        {
          provide: DashboardGateway,
          useValue: { emitirActualizacion: jest.fn() },
        },
        {
          provide: FAN_OUT_CIERRE,
          useValue: { nombre: 'doble', notificar: jest.fn(async () => {}) },
        },
        { provide: MOMENTO_FAN_OUT, useValue: 'APROBACION' },
      ],
    }).compile();
    service = mod.get(OrdenesService);
  });

  const cierre = (extra: Record<string, unknown> = {}) =>
    ({
      fotos: [
        {
          url_cloudinary: 'https://res.cloudinary.com/x/y.jpg',
          formato: 'jpg',
          tamano_kb: 10,
        },
      ],
      materiales: [],
      potencia_optica_dbm: -21,
      id_categoria_falla: 3,
      falla_reportada: 'Fibra cortada en el poste',
      solucion_aplicada: 'Se empalmo la fibra',
      resultado_reparacion: 'RESUELTO',
      ...extra,
    }) as any;
  const instalar = (serie: string) => ({
    equipos_instalados: [
      { numero_serie: serie, accion: 'INSTALADO_EN_CLIENTE' },
    ],
  });
  const retirar = (serie: string) => ({
    equipos_retirados: [
      {
        numero_serie: serie,
        accion: 'RETIRADO_PARA_DIAGNOSTICO',
        diagnostico: 'No enciende',
      },
    ],
  });

  it('busca en el inventario las series declaradas, instaladas y retiradas', async () => {
    inventario = [
      {
        numero_serie: 'ONT-1',
        estado: 'Asignado a técnico',
        id_empresa: 1,
        id_tecnico_asignado: 5,
      },
    ];

    await service.cerrarOT(
      40,
      cierre({ ...instalar('ONT-1'), ...retirar('ONT-VIEJA') }),
      tecnico,
    );

    expect(findMany.mock.calls[0][0].where).toEqual({
      numero_serie: { in: ['ONT-1', 'ONT-VIEJA'] },
    });
    expect(tx.orden_trabajo.update).toHaveBeenCalled();
  });

  it('instalar un equipo que no lleva el tecnico corta el cierre antes de escribir nada', async () => {
    inventario = [
      {
        numero_serie: 'ONT-9',
        estado: 'En bodega',
        id_empresa: 1,
        id_tecnico_asignado: null,
      },
    ];

    const intento = service.cerrarOT(40, cierre(instalar('ONT-9')), tecnico);

    await expect(intento).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.cerrarOT(40, cierre(instalar('ONT-9')), tecnico),
    ).rejects.toThrow('El equipo ONT-9 no se puede instalar: está "En bodega"');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('junta los problemas de todos los equipos en un solo mensaje', async () => {
    inventario = [
      {
        numero_serie: 'ONT-2',
        estado: 'Asignado a técnico',
        id_empresa: 1,
        id_tecnico_asignado: 6,
      },
    ];

    await expect(
      service.cerrarOT(
        40,
        cierre({
          equipos_instalados: [
            { numero_serie: 'ONT-2', accion: 'INSTALADO_EN_CLIENTE' },
            { numero_serie: 'NO-EXISTE', accion: 'INSTALADO_EN_CLIENTE' },
          ],
        }),
        tecnico,
      ),
    ).rejects.toThrow(
      'El equipo ONT-2 no está asignado a usted. El equipo NO-EXISTE no existe en el inventario de la empresa',
    );
  });

  it('retirar una serie que no esta en el inventario no bloquea el cierre', async () => {
    await service.cerrarOT(40, cierre(retirar('ONT-SIN-ETIQUETA')), tecnico);

    expect(tx.orden_trabajo.update).toHaveBeenCalled();
  });

  it('sin equipos declarados no consulta el inventario', async () => {
    await service.cerrarOT(40, cierre(), tecnico);

    expect(findMany).not.toHaveBeenCalled();
  });

  describe('los equipos que lleva el tecnico', () => {
    it('son los asignados a el, de su empresa, en "Asignado a técnico"', async () => {
      inventario = [
        {
          numero_serie: 'ONT-1',
          modelo: 'HG8145',
          tipo_equipo: { nombre: 'ONT' },
        },
      ];

      const r = await service.misEquipos(tecnico);

      expect(findMany.mock.calls[0][0].where).toEqual({
        id_empresa: 1,
        id_tecnico_asignado: 5,
        estado: 'Asignado a técnico',
      });
      expect(r).toEqual([
        { numero_serie: 'ONT-1', modelo: 'HG8145', tipo: 'ONT' },
      ]);
    });

    it('el endpoint es solo del tecnico', () => {
      expect(
        Reflect.getMetadata('roles', OrdenesController.prototype.misEquipos),
      ).toEqual(['TECNICO']);
    });
  });
});
