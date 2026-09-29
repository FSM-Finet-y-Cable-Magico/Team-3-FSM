import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { IntegracionesService } from './integraciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MOMENTO_FAN_OUT, type MomentoFanOut } from '../ordenes/fan-out/momento-fan-out.js';

/**
 * El GET de reconciliacion tiene que devolver todo cierre que ya se aviso por
 * webhook, y nada que no. Con la aprobacion del cierre (MOD RF-04) eso depende
 * de cuando se avisa:
 *
 *  - al cierre del tecnico (por defecto): una OT PENDIENTE_APROBACION ya se
 *    aviso, asi que G1 y G8 tienen que poder recuperarla;
 *  - a la aprobacion: solo las COMPLETADA.
 */
describe('reconciliacion segun el momento del aviso', () => {
  const scope = { grupo: 'G1', empresas: [1] };
  const findFirst = jest.fn(async (_a?: any) => null as unknown);
  const findMany = jest.fn(async (_a?: any) => [] as unknown[]);
  const count = jest.fn(async (_a?: any) => 0);

  const construir = async (momento: MomentoFanOut) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegracionesService,
        { provide: PrismaService, useValue: { orden_trabajo: { findFirst, findMany, count } } },
        { provide: MOMENTO_FAN_OUT, useValue: momento },
      ],
    }).compile();
    return moduleRef.get(IntegracionesService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('con el aviso al cierre, una OT que espera aprobacion se puede reconciliar', async () => {
    const service = await construir('CIERRE');
    await service.cierre(scope, 41, 1).catch(() => undefined);
    await service.cierres(scope, { id_empresa: 1, desde: '2026-09-01', hasta: '2026-09-02' });

    const estados = { in: ['COMPLETADA', 'PENDIENTE_APROBACION'] };
    expect(findFirst.mock.calls[0][0].where.estado).toEqual(estados);
    expect(findMany.mock.calls[0][0].where.estado).toEqual(estados);
  });

  it('con el aviso a la aprobacion, solo las COMPLETADA', async () => {
    const service = await construir('APROBACION');
    await service.cierre(scope, 41, 1).catch(() => undefined);
    await service.cierres(scope, { id_empresa: 1, desde: '2026-09-01', hasta: '2026-09-02' });

    expect(findFirst.mock.calls[0][0].where.estado).toEqual({ in: ['COMPLETADA'] });
    expect(findMany.mock.calls[0][0].where.estado).toEqual({ in: ['COMPLETADA'] });
  });
});
