import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';

/**
 * RF-08: "3 o mas OT de tipo REPARACION cerradas en 30 dias corridos".
 *
 * No habia ninguna prueba sobre este criterio, y por eso paso desapercibido que
 * la implementacion contaba otra cosa: ordenes abiertas, y ancladas en la fecha
 * de creacion en vez de la de cierre. Lo que se fija aca es el FILTRO, que es
 * donde estaba el error.
 */
describe('RF-08 · reparaciones recurrentes', () => {
  let service: ReparacionesRecurrentesService;
  const findMany = jest.fn(async (_args: unknown) => [] as unknown[]);

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ReparacionesRecurrentesService,
        { provide: PrismaService, useValue: { orden_trabajo: { findMany } } },
      ],
    }).compile();
    service = mod.get(ReparacionesRecurrentesService);
  });

  const filtro = () => (findMany.mock.calls[0][0] as any).where;

  it('cuenta solo las COMPLETADAS, no las que siguen abiertas', async () => {
    // El error original: `estado: { not: 'CANCELADA' }` dejaba entrar PENDIENTE,
    // ASIGNADA y EN_CURSO. Sobre los datos de FiNet eso daba 7 donde el RF
    // cuenta 4; las tres de diferencia estaban EN_CURSO.
    await service.evaluar(1, 1);

    expect(filtro().estado).toBe('COMPLETADA');
  });

  it('ancla la ventana en la fecha de CIERRE, no en la de creacion', async () => {
    // Con `fecha_creacion`, una OT creada hace 40 dias y cerrada ayer no
    // contaba, y una creada hace 29 y todavia abierta si.
    await service.evaluar(1, 1);

    expect(filtro().fecha_completada).toBeDefined();
    expect(filtro().fecha_creacion).toBeUndefined();
  });

  it('acota la ventana por arriba y por abajo', async () => {
    // El tope superior es lo que permite evaluar un momento historico (CU-60).
    // Sin el, contaria tambien reparaciones cerradas DESPUES del momento
    // evaluado, y diria que el cliente ya era recurrente cuando todavia no.
    const hasta = new Date('2026-06-15T12:00:00Z');

    await service.evaluar(1, 1, hasta);

    const { gte, lte } = filtro().fecha_completada;
    expect(lte).toEqual(hasta);
    expect(gte).toEqual(new Date('2026-05-16T12:00:00Z'));
  });

  it('la ventana por defecto termina ahora y abarca 30 dias de calendario', async () => {
    // Se compara por fecha de calendario y no por milisegundos a proposito:
    // Chile cambia la hora, y en una ventana que cruza el cambio los 30 dias
    // duran 719 u 721 horas, no 720. "30 dias corridos" es calendario, asi que
    // `setDate` --misma hora, 30 dias antes-- es la semantica correcta; medir
    // 30 x 24 h correria la ventana una hora dos veces al ano.
    const antes = Date.now();
    const r = await service.evaluar(1, 1);

    expect(r.hasta.getTime()).toBeGreaterThanOrEqual(antes);
    const esperado = new Date(r.hasta);
    esperado.setDate(esperado.getDate() - 30);
    expect(r.desde).toEqual(esperado);
  });

  it('se activa con 3 y no con 2', async () => {
    const ot = (id: number) => ({ id_ot: id, fecha_completada: new Date(), categoria_falla: null });

    findMany.mockResolvedValueOnce([ot(1), ot(2)]);
    expect((await service.evaluar(1, 1)).activa).toBe(false);

    findMany.mockResolvedValueOnce([ot(1), ot(2), ot(3)]);
    expect((await service.evaluar(1, 1)).activa).toBe(true);
  });

  it('devuelve la lista de OT, no solo el total', async () => {
    // El RF la pide explicitamente ("la lista de OT asociadas") y antes solo se
    // devolvia el numero: el jefe tecnico veia "5 reparaciones" sin poder ver
    // cuales.
    findMany.mockResolvedValueOnce([
      { id_ot: 12, fecha_completada: new Date('2026-06-01'), categoria_falla: { nombre: 'Internet lento' } },
      { id_ot: 15, fecha_completada: new Date('2026-06-10'), categoria_falla: null },
    ]);

    const r = await service.evaluar(1, 1);

    expect(r.total_reparaciones_30_dias).toBe(2);
    expect(r.ots).toEqual([
      { id_ot: 12, fecha_completada: new Date('2026-06-01'), categoria_falla: 'Internet lento' },
      { id_ot: 15, fecha_completada: new Date('2026-06-10'), categoria_falla: null },
    ]);
  });

  it('aisla por cliente y por empresa', async () => {
    await service.evaluar(7, 2);

    expect(filtro()).toMatchObject({ id_cliente: 7, id_empresa: 2, tipo_ot: 'REPARACION' });
  });
});
