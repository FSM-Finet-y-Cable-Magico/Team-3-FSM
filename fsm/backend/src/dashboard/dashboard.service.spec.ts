import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardService } from './dashboard.service.js';
import {
  DIAS_VENTANA_RECURRENCIA,
  UMBRAL_REPARACIONES_RECURRENTES,
} from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * RF-08 tenia tres copias de la misma regla. Dos se unificaron en
 * ReparacionesRecurrentesService; la tercera vivia aca, en el contador del
 * dashboard, y habia quedado con el criterio viejo: contaba `not CANCELADA`
 * --o sea tambien las reparaciones todavia abiertas-- y anclaba la ventana en
 * `fecha_creacion` en vez de `fecha_completada`.
 *
 * El efecto era que el dashboard y la ficha del cliente mostraban cifras
 * distintas del mismo cliente. Sobre los datos actuales, 8 contra 5.
 *
 * El dashboard no puede llamar al servicio: necesita un agregado sobre todos
 * los clientes y evaluar uno por uno seria una consulta por cliente. Lo que se
 * comparte es la regla, y eso es justo lo que fijan estas pruebas.
 */
describe('dashboard · contador de clientes con reparaciones recurrentes', () => {
  let service: DashboardService;
  const groupBy = jest.fn(async (_args: unknown) => [] as unknown[]);
  const count = jest.fn(async () => 0);
  const findMany = jest.fn(async () => [] as unknown[]);

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: PrismaService,
          useValue: {
            orden_trabajo: { groupBy, count, findMany },
            usuario: { findMany },
            cliente: { count },
            $queryRaw: jest.fn(async () => [] as unknown[]),
          },
        },
      ],
    }).compile();
    service = mod.get(DashboardService);
  });

  // De los groupBy que hace el dashboard, el de recurrencia es el que agrupa
  // por cliente.
  const filtroRecurrencia = () => {
    const llamada = groupBy.mock.calls
      .map((c) => c[0] as any)
      .find((a) => Array.isArray(a?.by) && a.by.includes('id_cliente'));
    // Si esto falla es que el groupBy por cliente dejo de existir o cambio de forma.
    expect(llamada).toBeDefined();
    return llamada.where;
  };

  it('cuenta solo reparaciones CERRADAS, no las que siguen abiertas', async () => {
    await service.indicadoresDelDia(1);

    const where = filtroRecurrencia();
    expect(where.estado).toBe('COMPLETADA');
    expect(where.tipo_ot).toBe('REPARACION');
  });

  it('ancla la ventana en la fecha de cierre, no en la de creacion', async () => {
    await service.indicadoresDelDia(1);

    const where = filtroRecurrencia();
    expect(where.fecha_completada).toBeDefined();
    expect(where.fecha_creacion).toBeUndefined();
  });

  it('usa la ventana de la regla compartida y no un 30 escrito aparte', async () => {
    const antes = Date.now();
    await service.indicadoresDelDia(1);

    const desde: Date = filtroRecurrencia().fecha_completada.gte;
    const esperado = new Date(antes);
    esperado.setDate(esperado.getDate() - DIAS_VENTANA_RECURRENCIA);
    // Dias de calendario, no 720 horas: en Chile una ventana que cruza el
    // cambio de hora dura 719 o 721, y el RF dice "30 dias corridos".
    expect(Math.abs(desde.getTime() - esperado.getTime())).toBeLessThan(5000);
  });

  it('no mezcla clientes de otra empresa', async () => {
    await service.indicadoresDelDia(7);

    expect(filtroRecurrencia().id_empresa).toBe(7);
  });

  it('aplica el umbral de la regla compartida', async () => {
    const bajoUmbral = UMBRAL_REPARACIONES_RECURRENTES - 1;
    groupBy.mockImplementation(async (args: any) => {
      if (Array.isArray(args?.by) && args.by.includes('id_cliente')) {
        return [
          { id_cliente: 1, _count: { id_cliente: UMBRAL_REPARACIONES_RECURRENTES } },
          { id_cliente: 2, _count: { id_cliente: UMBRAL_REPARACIONES_RECURRENTES + 4 } },
          { id_cliente: 3, _count: { id_cliente: bajoUmbral } },
        ];
      }
      return [];
    });

    const r = await service.indicadoresDelDia(1);

    // El que esta justo en el umbral cuenta: el RF dice "3 o mas".
    expect(r.clientes_reparacion_recurrente).toBe(2);
  });
});
