import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DIAS_ALERTA_SIN_REAGENDAR,
  SinReagendarService,
  superaElUmbral,
} from './sin-reagendar.service.js';

/**
 * RF-09: "alertando cuando lleven mas de 30 dias sin reagendarse".
 *
 * Lo que se fija aca son las dos decisiones que el RF deja escritas y el codigo
 * se saltaba: desde cuando se cuenta, y a partir de que numero se alerta.
 */
describe('RF-09 · OT sin reagendar', () => {
  let service: SinReagendarService;
  const groupBy = jest.fn(async (_a: unknown) => [] as any[]);
  const findMany = jest.fn(async (_a: unknown) => [] as any[]);

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        SinReagendarService,
        {
          provide: PrismaService,
          useValue: { historial_ot: { groupBy }, orden_trabajo: { findMany } },
        },
      ],
    }).compile();
    service = mod.get(SinReagendarService);
  });

  const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

  it('alerta con mas de 30 dias, no con 30 justos', () => {
    // "Mas de 30" es estricto. A los 30 exactos todavia no se alerta.
    expect(superaElUmbral(DIAS_ALERTA_SIN_REAGENDAR)).toBe(false);
    expect(superaElUmbral(DIAS_ALERTA_SIN_REAGENDAR + 1)).toBe(true);
  });

  it('cuenta desde que la OT entro al estado, no desde que se creo', async () => {
    // El caso que hacia falso el numero anterior: una OT vieja que el tecnico
    // marco ausente ayer lleva un dia sin reagendar, no sesenta.
    groupBy.mockResolvedValue([{ id_ot: 1, _max: { fecha_hora: hace(1) } }]);
    findMany.mockResolvedValue([{ id_ot: 1, fecha_creacion: hace(60) }]);

    expect(await service.contarVencidas(1)).toBe(0);
  });

  it('alerta cuando la entrada al estado ya paso los 30 dias', async () => {
    groupBy.mockResolvedValue([{ id_ot: 1, _max: { fecha_hora: hace(31) } }]);
    findMany.mockResolvedValue([{ id_ot: 1, fecha_creacion: hace(31) }]);

    expect(await service.contarVencidas(1)).toBe(1);
  });

  it('sin historial se cae a la fecha de creacion en vez de perder la OT', async () => {
    // Datos migrados o sembrados directo en la base: es lo unico que queda.
    groupBy.mockResolvedValue([]);
    findMany.mockResolvedValue([{ id_ot: 9, fecha_creacion: hace(45) }]);

    expect(await service.contarVencidas(1)).toBe(1);
  });

  it('solo mira las OT en el estado de la propia empresa', async () => {
    findMany.mockResolvedValue([]);
    await service.contarVencidas(7);

    const where = (findMany.mock.calls[0][0] as any).where;
    expect(where.id_empresa).toBe(7);
    expect(where.estado).toBe('PENDIENTE_CLIENTE_AUSENTE');
  });

  it('resuelve toda la pagina con una sola consulta, no una por OT', async () => {
    groupBy.mockResolvedValue([]);
    await service.marcasDeEntrada([1, 2, 3, 4, 5]);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect((groupBy.mock.calls[0][0] as any).where.id_ot).toEqual({ in: [1, 2, 3, 4, 5] });
  });

  it('no consulta nada si no hay OT en el estado', async () => {
    expect(await service.marcasDeEntrada([])).toEqual(new Map());
    expect(groupBy).not.toHaveBeenCalled();
  });
});
