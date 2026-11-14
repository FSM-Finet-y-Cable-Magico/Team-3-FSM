import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CerrarOtDto } from './dto/cerrar-ot.dto.js';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT, type MomentoFanOut } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';
import { LARGO_MAX_COMENTARIO_CIERRE } from './comentario-cierre.constants.js';

/**
 * Comentario libre del tecnico al cerrar una OT, en cualquier tipo de OT.
 *
 * Lo que se protege aca:
 *   - que se guarde en `cierre_equipos`, aunque la visita no haya movido
 *     equipos ni sea una reparacion;
 *   - que un texto vacio o de puros espacios no deje rastro;
 *   - que NO viaje en el aviso a G1/G8: G8 rechaza con 400 cualquier propiedad
 *     que no conozca (forbidNonWhitelisted), y el comentario no esta acordado.
 */
describe('comentario del tecnico al cerrar', () => {
  const tecnico = { userId: 7, id_empresa: 1, rol: 'TECNICO' };
  let fila: Record<string, any>;
  const notificar = jest.fn(async (_p: unknown) => {});
  const tx = {
    evidencia_foto: { createMany: jest.fn(async () => ({})) },
    uso_material_ot: { createMany: jest.fn(async () => ({})) },
    orden_trabajo: { update: jest.fn(async (a: any) => Object.assign(fila, a.data)) },
    historial_ot: { create: jest.fn(async () => ({})) },
    log_auditoria: { create: jest.fn(async () => ({})) },
    ticket: { updateMany: jest.fn(async () => ({ count: 0 })) },
    puerto_nap: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const prisma = {
    orden_trabajo: {
      findFirst: jest.fn(async () => ({ ...fila })),
      findUnique: jest.fn(async () => ({
        ...fila,
        fecha_creacion: new Date('2026-11-14T12:00:00Z'),
        cliente: null,
        direccion: null,
        categoria_falla: null,
        materiales: [],
        fotos: [],
        llamada: null,
        tecnico: { nombre_usuario: 'tecnico.prueba2' },
        solicitud_integracion: null,
      })),
    },
    categoria_falla: { findUnique: jest.fn(async () => null) },
    tipo_equipo: { count: jest.fn(async () => 0) },
    unidad_equipo: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const construir = async (momento: MomentoFanOut = 'APROBACION') => {
    const mod = await Test.createTestingModule({
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
    return mod.get(OrdenesService);
  };
  const esperar = () => new Promise((r) => setImmediate(r));

  const foto = { url_cloudinary: 'https://res.cloudinary.com/x/y.jpg', formato: 'jpg', tamano_kb: 10 };
  /** Una instalacion sin equipos: el caso donde antes la columna quedaba nula. */
  const cierre = (extra: Record<string, unknown> = {}) =>
    ({ fotos: [foto], materiales: [], potencia_optica_dbm: -21, ...extra }) as any;
  const guardado = () => tx.orden_trabajo.update.mock.calls[0][0].data.cierre_equipos;

  beforeEach(() => {
    jest.clearAllMocks();
    fila = {
      id_ot: 1,
      id_empresa: 1,
      id_tecnico: 7,
      estado: 'EN_CURSO',
      // Sin `id_caja_nap` ni puerto reservado: moverPuerto no tiene nada que hacer.
      tipo_ot: 'INSTALACION',
      id_ticket: null,
      id_cliente: null,
      id_caja_nap: null,
      fecha_completada: null,
    };
  });

  describe('se guarda', () => {
    it('recortado, en la columna del cierre', async () => {
      const service = await construir();
      await service.cerrarOT(1, cierre({ comentario_tecnico: '  Cliente pidio dejar el router en el living  ' }), tecnico);
      expect(guardado()).toMatchObject({ comentario: 'Cliente pidio dejar el router en el living' });
    });

    it('aunque la visita no haya movido equipos ni sea una reparacion', async () => {
      // Con solo el comentario la columna no puede quedar en null: se perderia
      // lo unico que el tecnico dejo escrito.
      const service = await construir();
      await service.cerrarOT(1, cierre({ comentario_tecnico: 'Todo ok' }), tecnico);
      expect(guardado()).toEqual({ comentario: 'Todo ok' });
    });

    it('convive con los datos de una reparacion', async () => {
      fila.tipo_ot = 'REPARACION';
      prisma.categoria_falla.findUnique.mockResolvedValueOnce({ id_categoria: 2, nombre: 'Internet lento', sla_horas: 4 } as never);
      const service = await construir();
      await service.cerrarOT(
        1,
        cierre({
          id_categoria_falla: 2,
          falla_reportada: 'Conector sucio en la roseta',
          solucion_aplicada: 'Se limpio y se volvio a medir',
          resultado_reparacion: 'RESUELTO',
          comentario_tecnico: 'Volver a revisar en una semana',
        }),
        tecnico,
      );
      expect(guardado()).toMatchObject({
        reparacion: { resultado: 'RESUELTO' },
        comentario: 'Volver a revisar en una semana',
      });
    });
  });

  describe('no deja rastro si viene vacio', () => {
    it('ausente', async () => {
      const service = await construir();
      await service.cerrarOT(1, cierre(), tecnico);
      expect(guardado()).not.toMatchObject({ comentario: expect.anything() });
    });

    it('de puros espacios', async () => {
      const service = await construir();
      await service.cerrarOT(1, cierre({ comentario_tecnico: '    ' }), tecnico);
      expect(guardado()).not.toMatchObject({ comentario: expect.anything() });
    });
  });

  it('NO viaja en el aviso a G1/G8', async () => {
    const service = await construir('CIERRE');
    await service.cerrarOT(1, cierre({ comentario_tecnico: 'Nota interna' }), tecnico);
    await esperar();
    expect(notificar).toHaveBeenCalled();
    const payload = notificar.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.values(payload)).not.toContain('Nota interna');
    expect(payload).not.toHaveProperty('comentario');
    expect(payload).not.toHaveProperty('comentario_tecnico');
  });

  describe('el DTO', () => {
    const errores = async (extra: Record<string, unknown>) => {
      const dto = plainToInstance(CerrarOtDto, { fotos: [], materiales: [], potencia_optica_dbm: -21, ...extra });
      return (await validate(dto)).map((e) => e.property);
    };

    it('lo deja opcional', async () => {
      expect(await errores({})).toEqual([]);
    });

    it('acepta el largo maximo', async () => {
      expect(await errores({ comentario_tecnico: 'x'.repeat(LARGO_MAX_COMENTARIO_CIERRE) })).toEqual([]);
    });

    it('rechaza un texto mas largo que el maximo', async () => {
      expect(await errores({ comentario_tecnico: 'x'.repeat(LARGO_MAX_COMENTARIO_CIERRE + 1) })).toContain(
        'comentario_tecnico',
      );
    });

    it('mide el largo despues de recortar', async () => {
      expect(await errores({ comentario_tecnico: ` ${'x'.repeat(LARGO_MAX_COMENTARIO_CIERRE)} ` })).toEqual([]);
    });
  });
});
