import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { OrdenesController } from './ordenes.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT, leerMomentoFanOut, type MomentoFanOut } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * MOD RF-04 y CU de aprobacion del cierre (acta con FiNet): el cierre del
 * tecnico ya no deja la OT COMPLETADA sino PENDIENTE_APROBACION, y el jefe
 * tecnico o el administrador la aprueba o la rechaza.
 *
 * D4 del plan: sin migracion. `PENDIENTE_APROBACION` mide 20 caracteres y
 * `orden_trabajo.estado` es VARCHAR(25); quien aprobo y por que queda en
 * `historial_ot`.
 */
describe('aprobacion del cierre de OT', () => {
  const tecnico = { userId: 7, id_empresa: 1, rol: 'TECNICO' };
  const jefe = { userId: 3, id_empresa: 1, rol: 'JEFE_TECNICO' };
  let fila: Record<string, any>;
  const notificar = jest.fn(async (_p: unknown) => {});
  const tx = {
    evidencia_foto: { createMany: jest.fn(async () => ({})) },
    uso_material_ot: { createMany: jest.fn(async () => ({})), deleteMany: jest.fn(async (_a: any) => ({})) },
    llamada_cortes: { create: jest.fn(async () => ({})), deleteMany: jest.fn(async (_a: any) => ({})) },
    orden_trabajo: {
      update: jest.fn(async (a: any) => {
        Object.assign(fila, a.data);
        return fila;
      }),
    },
    historial_ot: { create: jest.fn(async (_a: any) => ({})) },
    log_auditoria: { create: jest.fn(async (_a: any) => ({})) },
  };
  const prisma = {
    orden_trabajo: {
      // Con `include`, Prisma devuelve siempre las relaciones pedidas.
      findFirst: jest.fn(async (a: any) => {
        if (a.where.id_ot !== fila.id_ot || a.where.id_empresa !== fila.id_empresa) return null;
        return a.include ? { ...fila, materiales: [], fotos: [], historial: [] } : { ...fila };
      }),
      findUnique: jest.fn(async () => ({
        ...fila,
        fecha_creacion: new Date('2026-09-29T18:00:00Z'),
        cliente: null,
        direccion: null,
        categoria_falla: null,
        materiales: [],
        fotos: [],
        llamada: { resultado: 'CONFORME' },
        solicitud_integracion: null,
      })),
    },
    tipo_equipo: { count: jest.fn(async () => 0) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const construir = async (momento: MomentoFanOut) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdenesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReparacionesRecurrentesService, useValue: { evaluar: jest.fn() } },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: { emitirActualizacion: jest.fn() } },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar } },
        { provide: MOMENTO_FAN_OUT, useValue: momento },
      ],
    }).compile();
    return moduleRef.get(OrdenesService);
  };
  // Presencial: la evidencia es obligatoria (CU-56).
  const cierre = { fotos: [{ url_cloudinary: 'https://res.cloudinary.com/demo/image/upload/v1/e.jpg', formato: 'jpg', tamano_kb: 10 }], materiales: [], potencia_optica_dbm: -21, resultado_llamada: 'CONFORME' };
  const esperarFanOut = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    jest.clearAllMocks();
    fila = { id_ot: 781, id_empresa: 1, id_tecnico: 7, estado: 'EN_CURSO', tipo_ot: 'INSTALACION', id_cliente: null };
  });

  describe('el tecnico cierra', () => {
    it('la OT queda PENDIENTE_APROBACION, no COMPLETADA', async () => {
      const service = await construir('CIERRE');
      await service.cerrarOT(781, cierre, tecnico);

      expect(tx.orden_trabajo.update.mock.calls[0][0].data).toMatchObject({ estado: 'PENDIENTE_APROBACION' });
      expect(tx.orden_trabajo.update.mock.calls[0][0].data.fecha_completada).toBeInstanceOf(Date);
      expect(tx.historial_ot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ estado_anterior: 'EN_CURSO', estado_nuevo: 'PENDIENTE_APROBACION' }),
      });
    });
  });

  describe('aprobar', () => {
    beforeEach(() => {
      fila.estado = 'PENDIENTE_APROBACION';
    });

    it('deja la OT COMPLETADA y registra quien aprobo', async () => {
      const service = await construir('CIERRE');
      await service.aprobarCierre(781, { observaciones: 'Todo en orden' }, jefe);

      expect(fila.estado).toBe('COMPLETADA');
      expect(tx.historial_ot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_ot: 781,
          id_usuario: 3,
          estado_anterior: 'PENDIENTE_APROBACION',
          estado_nuevo: 'COMPLETADA',
          observaciones: 'Todo en orden',
        }),
      });
      expect(tx.log_auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id_usuario: 3, accion: 'APROBAR_CIERRE_OT', id_entidad_afectada: 781 }),
      });
    });

    it('solo se aprueba una OT que espera aprobacion', async () => {
      fila.estado = 'EN_CURSO';
      const service = await construir('CIERRE');
      await expect(service.aprobarCierre(781, {}, jefe)).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.orden_trabajo.update).not.toHaveBeenCalled();
    });

    it('404 si la OT es de otra empresa', async () => {
      const service = await construir('CIERRE');
      await expect(service.aprobarCierre(781, {}, { ...jefe, id_empresa: 2 })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('rechazar', () => {
    beforeEach(() => {
      fila.estado = 'PENDIENTE_APROBACION';
      fila.fecha_completada = new Date('2026-10-01T20:15:00Z');
    });

    it('exige un motivo', async () => {
      const service = await construir('CIERRE');
      await expect(service.rechazarCierre(781, { motivo: '  ' }, jefe)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('devuelve la OT al tecnico EN_CURSO y deshace la declaracion del cierre', async () => {
      // La llamada de cortesia es 1:1 con la OT (id_ot UNIQUE): si no se borra,
      // el segundo cierre del tecnico revienta. Los materiales se volverian a
      // sumar. Las fotos se conservan: son evidencia de lo que se rechazo.
      const service = await construir('CIERRE');
      await service.rechazarCierre(781, { motivo: 'Falta foto de la roseta' }, jefe);

      expect(fila.estado).toBe('EN_CURSO');
      expect(fila).toMatchObject({ fecha_completada: null, potencia_optica_dbm: null });
      expect(tx.uso_material_ot.deleteMany).toHaveBeenCalledWith({ where: { id_ot: 781 } });
      expect(tx.llamada_cortes.deleteMany).toHaveBeenCalledWith({ where: { id_ot: 781 } });
      expect(tx.evidencia_foto.createMany).not.toHaveBeenCalled();
      expect(tx.historial_ot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_usuario: 3,
          estado_anterior: 'PENDIENTE_APROBACION',
          estado_nuevo: 'EN_CURSO',
          observaciones: 'Cierre rechazado: Falta foto de la roseta',
        }),
      });
      expect(tx.log_auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ accion: 'RECHAZAR_CIERRE_OT', id_entidad_afectada: 781 }),
      });
    });

    it('el tecnico puede volver a cerrar despues de un rechazo', async () => {
      const service = await construir('CIERRE');
      await service.rechazarCierre(781, { motivo: 'Falta foto de la roseta' }, jefe);
      await service.cerrarOT(781, cierre, tecnico);
      expect(fila.estado).toBe('PENDIENTE_APROBACION');
    });
  });

  describe('momento del fan-out', () => {
    it('por defecto sigue avisando al cierre del tecnico, hasta el acuse de G1 y G8', async () => {
      const service = await construir('CIERRE');
      await service.cerrarOT(781, cierre, tecnico);
      await esperarFanOut();
      expect(notificar).toHaveBeenCalledTimes(1);

      notificar.mockClear();
      await service.aprobarCierre(781, {}, jefe);
      await esperarFanOut();
      expect(notificar).not.toHaveBeenCalled();
    });

    it('con CIERRE_FAN_OUT_MOMENTO=APROBACION avisa solo al aprobar', async () => {
      const service = await construir('APROBACION');
      await service.cerrarOT(781, cierre, tecnico);
      await esperarFanOut();
      expect(notificar).not.toHaveBeenCalled();

      await service.aprobarCierre(781, {}, jefe);
      await esperarFanOut();
      expect(notificar).toHaveBeenCalledTimes(1);
    });

    it('un rechazo nunca avisa', async () => {
      const service = await construir('APROBACION');
      fila.estado = 'PENDIENTE_APROBACION';
      await service.rechazarCierre(781, { motivo: 'Falta foto de la roseta' }, jefe);
      await esperarFanOut();
      expect(notificar).not.toHaveBeenCalled();
    });

    it.each([
      [undefined, 'CIERRE'],
      ['', 'CIERRE'],
      ['aprobacion', 'APROBACION'],
      [' APROBACION ', 'APROBACION'],
      ['otra-cosa', 'CIERRE'],
    ])('lee %p como %s', (valor, esperado) => {
      expect(leerMomentoFanOut(valor)).toBe(esperado);
    });
  });

  it('el estado generico ya no deja completar una OT salteando el cierre y la aprobacion', async () => {
    const service = await construir('CIERRE');
    await expect(service.actualizarEstado(781, { estado: 'COMPLETADA' }, jefe)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aprobar y rechazar son de ADMIN y JEFE_TECNICO', () => {
    const roles = (m: keyof OrdenesController) => Reflect.getMetadata('roles', OrdenesController.prototype[m]);
    expect(roles('aprobarCierre')).toEqual(['ADMIN', 'JEFE_TECNICO']);
    expect(roles('rechazarCierre')).toEqual(['ADMIN', 'JEFE_TECNICO']);
  });
});

/**
 * CU-30: el ticket derivado a una OT se resuelve solo cuando la OT se completa
 * (al aprobarse el cierre) y vuelve a ABIERTO si la OT se cancela, para que el
 * jefe tecnico decida de nuevo. Al cancelar se desvincula: `id_ticket` es
 * UNIQUE en la OT y, vinculado, el ticket no se podria volver a derivar.
 */
describe('el ticket sigue a su OT', () => {
  const jefe = { userId: 3, id_empresa: 1, rol: 'JEFE_TECNICO' };
  let fila: Record<string, any>;
  const ticketUpdateMany = jest.fn(async (_a: any) => ({ count: 1 }));
  const auditar = jest.fn(async (_a: any) => ({}));
  const otUpdate = jest.fn(async (a: any) => Object.assign(fila, a.data));
  const tx = {
    orden_trabajo: { update: otUpdate },
    historial_ot: { create: jest.fn(async () => ({})) },
    log_auditoria: { create: auditar },
    ticket: { updateMany: ticketUpdateMany },
  };
  const prisma = {
    orden_trabajo: {
      findFirst: jest.fn(async (a: any) => (a.include ? { ...fila, materiales: [], fotos: [], historial: [] } : { ...fila })),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  let service: OrdenesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    fila = { id_ot: 500, id_empresa: 1, id_tecnico: 14, estado: 'PENDIENTE_APROBACION', tipo_ot: 'REPARACION', id_ticket: 7 };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OrdenesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReparacionesRecurrentesService, useValue: {} },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: { emitirActualizacion: jest.fn() } },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'doble', notificar: jest.fn() } },
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
      ],
    }).compile();
    service = moduleRef.get(OrdenesService);
  });

  it('aprobar el cierre resuelve el ticket derivado, sin marcarlo remoto', async () => {
    await service.aprobarCierre(500, {}, jefe);

    expect(ticketUpdateMany).toHaveBeenCalledWith({
      where: { id_ticket: 7, estado: 'DERIVADO_OT' },
      data: { estado: 'RESUELTO', fecha_cierre: expect.any(Date), resuelto_remotamente: false },
    });
    expect(auditar).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accion: 'CAMBIAR_ESTADO_TICKET',
        entidad_afectada: 'ticket',
        id_entidad_afectada: 7,
        valor_nuevo: { estado: 'RESUELTO', id_ot: 500 },
      }),
    });
  });

  it('cancelar la OT reabre el ticket y lo desvincula', async () => {
    fila.estado = 'ASIGNADA';
    await service.actualizarEstado(500, { estado: 'CANCELADA', obs_cancelacion: 'El cliente ya no la necesita' }, jefe);

    expect(otUpdate.mock.calls[0][0].data).toMatchObject({ estado: 'CANCELADA', id_ticket: null });
    expect(ticketUpdateMany).toHaveBeenCalledWith({
      where: { id_ticket: 7, estado: 'DERIVADO_OT' },
      data: { estado: 'ABIERTO' },
    });
  });

  it('una OT sin ticket no toca tickets', async () => {
    fila.id_ticket = null;
    await service.aprobarCierre(500, {}, jefe);
    expect(ticketUpdateMany).not.toHaveBeenCalled();
  });
});
