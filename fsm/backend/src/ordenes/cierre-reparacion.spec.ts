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

/**
 * Datos de cierre de REPARACION que pide G1 (8-nov-2026): que fallaba, que se
 * hizo y como quedo. Sin ellos G1 no registra el cierre y lo anota como la
 * discrepancia DATOS_REPARACION_INCOMPLETOS.
 *
 * Lo que se protege aca:
 *   - que no se pueda cerrar una reparacion sin los tres;
 *   - que NO se le exijan a los demas tipos de OT;
 *   - que sobrevivan al guardado aunque la visita no haya movido equipos, que
 *     es donde estaba el agujero facil (comparten la columna `cierre_equipos`);
 *   - que lleguen al aviso que recibe G1.
 */
describe('datos de cierre de reparacion (G1)', () => {
  const tecnico = { userId: 7, id_empresa: 1, rol: 'TECNICO' };
  let fila: Record<string, any>;
  const notificar = jest.fn(async (_p: unknown) => {});
  const tx = {
    evidencia_foto: { createMany: jest.fn(async () => ({})) },
    uso_material_ot: { createMany: jest.fn(async () => ({})) },
    llamada_cortes: { create: jest.fn(async () => ({})) },
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
        fecha_creacion: new Date('2026-11-07T12:00:00Z'),
        cliente: null,
        direccion: null,
        categoria_falla: null,
        materiales: [],
        fotos: [],
        llamada: null,
        tecnico: { nombre_usuario: 'mrojas' },
        solicitud_integracion: null,
      })),
    },
    categoria_falla: {
      findUnique: jest.fn(async () => ({ id_categoria: 3, nombre: 'Internet lento', sla_horas: 4 })),
    },
    tipo_equipo: { count: jest.fn(async () => 0) },
    // Inventario vacio: un retiro de una serie desconocida no bloquea el cierre
    // (ver validar-equipos.ts), que es lo unico que estas pruebas necesitan.
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

  /** Un cierre de reparacion completo. Cada prueba le saca lo que quiere probar. */
  const cierre = (extra: Record<string, unknown> = {}) =>
    ({
      fotos: [foto],
      materiales: [],
      potencia_optica_dbm: -21,
      id_categoria_falla: 3,
      falla_reportada: 'Fibra cortada en el poste',
      solucion_aplicada: 'Se empalmo la fibra y se midio potencia',
      resultado_reparacion: 'RESUELTO',
      ...extra,
    }) as any;

  /** Un cierre de otro tipo de OT, sin ninguno de los tres datos. */
  const cierreSinReparacion = () =>
    ({ fotos: [foto], materiales: [], potencia_optica_dbm: -21 }) as any;

  /** Lo que la transaccion dejo en la columna JSON. */
  const guardado = () => tx.orden_trabajo.update.mock.calls[0][0].data.cierre_equipos;

  beforeEach(() => {
    jest.clearAllMocks();
    fila = {
      id_ot: 40,
      id_empresa: 1,
      id_tecnico: 7,
      estado: 'EN_CURSO',
      tipo_ot: 'REPARACION',
      id_ticket: null,
      id_cliente: null,
      id_caja_nap: null,
      fecha_completada: null,
    };
  });

  describe('son obligatorios al cerrar una reparacion', () => {
    it('sin la falla encontrada no cierra', async () => {
      const service = await construir();
      await expect(
        service.cerrarOT(40, cierre({ falla_reportada: undefined }), tecnico),
      ).rejects.toThrow('qué falla encontró');
      expect(tx.orden_trabajo.update).not.toHaveBeenCalled();
    });

    it('sin la solucion aplicada no cierra', async () => {
      const service = await construir();
      await expect(
        service.cerrarOT(40, cierre({ solucion_aplicada: undefined }), tecnico),
      ).rejects.toThrow('qué hizo para resolverla');
      expect(tx.orden_trabajo.update).not.toHaveBeenCalled();
    });

    it('sin el resultado no cierra', async () => {
      const service = await construir();
      await expect(
        service.cerrarOT(40, cierre({ resultado_reparacion: undefined }), tecnico),
      ).rejects.toThrow('cómo quedó la reparación');
      expect(tx.orden_trabajo.update).not.toHaveBeenCalled();
    });

    it('un texto de puros espacios cuenta como ausente', async () => {
      // El DTO recorta antes de medir el largo, pero el servicio no puede
      // confiar en eso: tambien lo llaman las pruebas, y el pipe de validacion
      // es una capa que se puede desconfigurar sin que nadie se entere.
      const service = await construir();
      await expect(
        service.cerrarOT(40, cierre({ falla_reportada: '     ' }), tecnico),
      ).rejects.toThrow('qué falla encontró');
    });
  });

  describe('NO se le exigen a los demas tipos de OT', () => {
    it('una instalacion cierra sin ellos', async () => {
      fila.tipo_ot = 'INSTALACION';
      const service = await construir();
      await service.cerrarOT(40, cierreSinReparacion(), tecnico);
      expect(tx.orden_trabajo.update).toHaveBeenCalled();
    });

    it('y no deja seccion de reparacion en la columna', async () => {
      fila.tipo_ot = 'BAJA';
      const service = await construir();
      await service.cerrarOT(40, cierreSinReparacion(), tecnico);
      // Sin equipos ni reparacion la columna queda nula, como siempre.
      expect(guardado()).not.toMatchObject({ reparacion: expect.anything() });
    });
  });

  describe('sobreviven al guardado', () => {
    it('se guardan recortados en la columna del cierre', async () => {
      const service = await construir();
      await service.cerrarOT(40, cierre({ falla_reportada: '  Fibra cortada  ' }), tecnico);
      expect(guardado()).toMatchObject({
        reparacion: {
          falla_reportada: 'Fibra cortada',
          solucion_aplicada: 'Se empalmo la fibra y se midio potencia',
          resultado: 'RESUELTO',
        },
      });
    });

    it('se guardan aunque la visita no haya movido ningun equipo', async () => {
      // La regresion que importa: `cierre_equipos` se comparte con los equipos
      // declarados, y cuando el guardado dependia de que hubiera equipos, una
      // reparacion sin equipos perdia los tres datos entre el cierre y la
      // aprobacion, que es cuando se leen para avisarle a G1.
      const service = await construir();
      await service.cerrarOT(40, cierre(), tecnico);
      expect(guardado()).toMatchObject({ reparacion: { resultado: 'RESUELTO' } });
    });

    it('conviven con los equipos declarados, sin pisarse', async () => {
      const service = await construir();
      await service.cerrarOT(
        40,
        cierre({ equipos_retirados: [{ numero_serie: 'ONT-9', accion: 'RETIRADO_PARA_DIAGNOSTICO' }] }),
        tecnico,
      );
      expect(guardado()).toMatchObject({
        retirados: [{ numero_serie: 'ONT-9' }],
        reparacion: { falla_reportada: 'Fibra cortada en el poste' },
      });
    });
  });

  describe('el DTO valida largos y valores permitidos', () => {
    // El servicio comprueba que los tres ESTEN; el largo y la lista de
    // resultados los impone el pipe de validacion, antes de llegar al
    // servicio. Son dos capas distintas y se prueban por separado.
    const errores = async (extra: Record<string, unknown>) => {
      const dto = plainToInstance(CerrarOtDto, {
        fotos: [],
        materiales: [],
        potencia_optica_dbm: -21,
        ...extra,
      });
      return (await validate(dto)).map((e) => e.property);
    };

    it('acepta el largo minimo que exige G1', async () => {
      expect(await errores({ falla_reportada: 'cinco' })).toEqual([]);
    });

    it('rechaza un texto mas corto que el minimo', async () => {
      expect(await errores({ falla_reportada: 'ok' })).toContain('falla_reportada');
    });

    it('rechaza un texto mas largo que el maximo', async () => {
      expect(await errores({ solucion_aplicada: 'x'.repeat(301) })).toContain('solucion_aplicada');
    });

    it('mide el largo DESPUES de recortar los espacios', async () => {
      // Sin el recorte previo, '  ok  ' tiene seis caracteres y pasaria el
      // minimo de cinco, dejando pasar un texto de dos letras.
      expect(await errores({ falla_reportada: '  ok  ' })).toContain('falla_reportada');
    });

    it('rechaza un resultado que no esta en la lista de G1', async () => {
      expect(await errores({ resultado_reparacion: 'MAS_O_MENOS' })).toContain('resultado_reparacion');
    });

    it('acepta los tres resultados de la lista', async () => {
      for (const r of ['RESUELTO', 'PARCIAL', 'SIN_SOLUCION']) {
        expect(await errores({ resultado_reparacion: r })).toEqual([]);
      }
    });

    it('los deja ausentes: la obligatoriedad depende del tipo de OT', async () => {
      // Por eso son opcionales aca y el servicio los exige segun `tipo_ot`:
      // el DTO no sabe si la OT es una reparacion.
      expect(await errores({})).toEqual([]);
    });
  });

  describe('llegan al aviso de G1', () => {
    it('viajan en el payload del cierre', async () => {
      const service = await construir('CIERRE');
      await service.cerrarOT(40, cierre(), tecnico);
      await esperar();
      expect(notificar).toHaveBeenCalledWith(
        expect.objectContaining({
          falla_reportada: 'Fibra cortada en el poste',
          solucion_aplicada: 'Se empalmo la fibra y se midio potencia',
          resultado: 'RESUELTO',
        }),
      );
    });

    it('viajan en null cuando la OT no es una reparacion', async () => {
      fila.tipo_ot = 'INSTALACION';
      const service = await construir('CIERRE');
      await service.cerrarOT(40, cierreSinReparacion(), tecnico);
      await esperar();
      expect(notificar).toHaveBeenCalledWith(
        expect.objectContaining({
          falla_reportada: null,
          solucion_aplicada: null,
          resultado: null,
        }),
      );
    });
  });
});
