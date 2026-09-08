import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlantaExternaService } from './planta-externa.service.js';

/**
 * Deriva la zona de una caja desde las ONT que cuelgan de ella.
 *
 * El KML de Tomodat no trae zona; la unica fuente es el campo que informa
 * SmartOLT por ONT. Lo que se fija aca es que no se pise dato existente y que
 * el desacuerdo entre ONT se resuelva de forma estable y visible.
 */
describe('derivar la zona de las cajas NAP', () => {
  let service: PlantaExternaService;
  let cajas: { id_caja_nap: number; identificador_unico: string | null }[];
  let onts: { id_caja_nap: number | null; zona: string | null }[];

  const cajaFindMany = jest.fn(async (_a: unknown) => cajas);
  const ontFindMany = jest.fn(async (_a: unknown) => onts);
  const cajaUpdate = jest.fn(async (a: unknown) => a);

  beforeEach(async () => {
    jest.clearAllMocks();
    cajas = [];
    onts = [];
    const mod = await Test.createTestingModule({
      providers: [
        PlantaExternaService,
        {
          provide: PrismaService,
          useValue: {
            caja_nap: { findMany: cajaFindMany, update: cajaUpdate },
            registro_ont: { findMany: ontFindMany },
          },
        },
      ],
    }).compile();
    service = mod.get(PlantaExternaService);
  });

  const zonaEscrita = (i = 0) => (cajaUpdate.mock.calls[i][0] as any).data.zona;

  it('solo mira las cajas que NO tienen zona', async () => {
    // Una zona ya puesta --por el KML o por una persona-- vale mas que una
    // deducida. Pisarla convertiria un dato sabido en una heuristica.
    await service.derivarZonas(1);

    expect((cajaFindMany.mock.calls[0][0] as any).where).toMatchObject({ id_empresa: 1, zona: null });
  });

  it('toma la zona cuando todas las ONT de la caja coinciden', async () => {
    cajas = [{ id_caja_nap: 1, identificador_unico: 'NAP 6' }];
    onts = [
      { id_caja_nap: 1, zona: 'ZONA 3' },
      { id_caja_nap: 1, zona: 'ZONA 3' },
    ];

    const r = await service.derivarZonas(1);

    expect(r.actualizadas).toBe(1);
    expect(zonaEscrita()).toBe('ZONA 3');
    expect(r.conflictos).toEqual([]);
  });

  it('cuando no coinciden toma la mayoria, pero lo informa', async () => {
    // Pasa en 12 de 262 cajas reales. Resolverlo en silencio esconderia justo
    // los casos que conviene mirar: una caja en el limite de dos zonas, o una
    // ONT mal ligada.
    cajas = [{ id_caja_nap: 1, identificador_unico: 'NAP 6' }];
    onts = [
      { id_caja_nap: 1, zona: 'ZONA 3' },
      { id_caja_nap: 1, zona: 'ZONA 3' },
      { id_caja_nap: 1, zona: 'ZONA 7' },
    ];

    const r = await service.derivarZonas(1);

    expect(zonaEscrita()).toBe('ZONA 3');
    expect(r.conflictos).toEqual([
      { caja: 'NAP 6', elegida: 'ZONA 3', descartadas: ['ZONA 7 (1)'] },
    ]);
  });

  it('a igual cantidad de votos elige siempre la misma, no una al azar', async () => {
    // Dos corridas sobre los mismos datos tienen que dar el mismo resultado; si
    // no, el dato cambiaria solo entre despliegues.
    cajas = [{ id_caja_nap: 1, identificador_unico: 'NAP 6' }];
    onts = [
      { id_caja_nap: 1, zona: 'ZONA 7' },
      { id_caja_nap: 1, zona: 'ZONA 3' },
    ];

    const primera = await service.derivarZonas(1);
    jest.clearAllMocks();
    const segunda = await service.derivarZonas(1);

    expect(primera.conflictos[0].elegida).toBe('ZONA 3');
    expect(segunda.conflictos[0].elegida).toBe('ZONA 3');
  });

  it('deja en null la caja sin ONT ligada, y la cuenta', async () => {
    // No hay de donde deducirla. Inventar una seria peor que dejarla vacia.
    cajas = [
      { id_caja_nap: 1, identificador_unico: 'NAP 6' },
      { id_caja_nap: 2, identificador_unico: 'NAP 9' },
    ];
    onts = [{ id_caja_nap: 1, zona: 'ZONA 3' }];

    const r = await service.derivarZonas(1);

    expect(r).toMatchObject({ cajas_sin_zona: 2, actualizadas: 1, sin_ont_ligada: 1 });
    expect(cajaUpdate).toHaveBeenCalledTimes(1);
  });

  it('normaliza los espacios de la zona', async () => {
    // SmartOLT devuelve "ZONA  3" y "ZONA 3 " indistintamente; sin normalizar
    // quedarian como dos zonas distintas en los filtros.
    cajas = [{ id_caja_nap: 1, identificador_unico: 'NAP 6' }];
    onts = [
      { id_caja_nap: 1, zona: '  ZONA   3 ' },
      { id_caja_nap: 1, zona: 'ZONA 3' },
    ];

    const r = await service.derivarZonas(1);

    expect(zonaEscrita()).toBe('ZONA 3');
    expect(r.conflictos).toEqual([]);
  });

  it('no consulta las ONT si no hay ninguna caja sin zona', async () => {
    // Correrlo de nuevo cuando ya esta todo derivado no cuesta una consulta.
    cajas = [];

    const r = await service.derivarZonas(1);

    expect(r).toMatchObject({ cajas_sin_zona: 0, actualizadas: 0 });
    expect(ontFindMany).not.toHaveBeenCalled();
    expect(cajaUpdate).not.toHaveBeenCalled();
  });
});
