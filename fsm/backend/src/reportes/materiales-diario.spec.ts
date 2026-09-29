import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ReportesService } from './reportes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-23, resumen diario de materiales: que se uso en terreno un dia, por
 * material y por tecnico. La agrupacion ya existia dentro del reporte diario;
 * esto le da su propio flujo.
 *
 * Diferencia con el reporte: cuenta tambien los cierres que esperan aprobacion
 * (MOD RF-04). El material ya se gasto en terreno aunque el jefe tecnico
 * todavia no apruebe; si rechaza, el cierre se deshace y su material sale solo.
 */
describe('CU-23: resumen diario de materiales', () => {
  const findMany = jest.fn(async (_a: any): Promise<any[]> => [
    {
      estado: 'COMPLETADA',
      tecnico: { nombre_completo: 'Pedro Rojas' },
      materiales: [
        { cantidad: '2', tipo_equipo: { nombre: 'Conector SC/APC' } },
        { cantidad: '1', tipo_equipo: { nombre: 'ONT' } },
      ],
    },
    {
      estado: 'PENDIENTE_APROBACION',
      tecnico: { nombre_completo: 'Ana Díaz' },
      materiales: [{ cantidad: '3', tipo_equipo: { nombre: 'Conector SC/APC' } }],
    },
  ]);
  let service: ReportesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [ReportesService, { provide: PrismaService, useValue: { orden_trabajo: { findMany } } }],
    }).compile();
    service = mod.get(ReportesService);
  });

  it('cuenta el dia de operacion en Chile, cerradas y por aprobar', async () => {
    await service.resumenMateriales(1, '2026-09-29');

    expect(findMany.mock.calls[0][0].where).toEqual({
      id_empresa: 1,
      estado: { in: ['COMPLETADA', 'PENDIENTE_APROBACION'] },
      // 29-09 en Santiago (UTC-3) va de 03:00Z a 03:00Z del dia siguiente.
      fecha_completada: { gte: new Date('2026-09-29T03:00:00.000Z'), lt: new Date('2026-09-30T03:00:00.000Z') },
    });
  });

  it('suma por material y por tecnico, y dice cuanto espera aprobacion', async () => {
    const r = await service.resumenMateriales(1, '2026-09-29');

    expect(r).toMatchObject({ fecha: '2026-09-29', total_ot: 2, pendientes_aprobacion: 1 });
    expect(r.materiales).toEqual([
      {
        material: 'Conector SC/APC',
        cantidad: 5,
        por_tecnico: [
          { tecnico: 'Ana Díaz', cantidad: 3 },
          { tecnico: 'Pedro Rojas', cantidad: 2 },
        ],
      },
      { material: 'ONT', cantidad: 1, por_tecnico: [{ tecnico: 'Pedro Rojas', cantidad: 1 }] },
    ]);
  });

  it('rechaza una fecha mal escrita', async () => {
    await expect(service.resumenMateriales(1, '29-09-2026')).rejects.toThrow('YYYY-MM-DD');
  });
});
