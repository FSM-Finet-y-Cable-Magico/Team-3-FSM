// En ESM, Jest no inyecta los globals: hay que importarlos.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CONSERVAR_POR_ONT_POR_DEFECTO,
  PurgaMonitoreoService,
} from './purga-monitoreo.service.js';

/**
 * La purga de monitoreo_ont, la tabla que llenó el disco y dejó produccion
 * caida nueve dias.
 *
 * El SQL se ensayó aparte contra el respaldo de produccion del 29-09: de
 * 394.799 filas saca 206.799 en 21 lotes con el tope en 200, quedan 188.000 y
 * la vista que lee el sistema --la ultima lectura de cada una de las 940
 * ONT-- queda identica, 0 filas cambiadas. Aca se fija el comportamiento del
 * servicio: que no borre sin que se lo pidan, que lotee y que ordene por
 * id_monitoreo.
 */
type Conteo = { filas_antes: bigint; filas_sobrantes: bigint };

describe('PurgaMonitoreoService', () => {
  let service: PurgaMonitoreoService;
  let queryRaw: jest.Mock<(...a: unknown[]) => Promise<Conteo[]>>;
  let executeRaw: jest.Mock<(...a: unknown[]) => Promise<number>>;

  const conteo = (antes: number, sobrantes: number): Conteo[] => [
    { filas_antes: BigInt(antes), filas_sobrantes: BigInt(sobrantes) },
  ];

  beforeEach(async () => {
    queryRaw = jest.fn(() => Promise.resolve(conteo(394_799, 206_799)));
    executeRaw = jest.fn(() => Promise.resolve(0));

    const mod = await Test.createTestingModule({
      providers: [
        PurgaMonitoreoService,
        {
          provide: PrismaService,
          useValue: { $queryRaw: queryRaw, $executeRaw: executeRaw },
        },
      ],
    }).compile();

    service = mod.get(PurgaMonitoreoService);
  });

  it('en seco informa lo que sobra y no borra nada', async () => {
    const r = await service.purgar();

    expect(r).toMatchObject({
      aplicado: false,
      conservar_por_ont: CONSERVAR_POR_ONT_POR_DEFECTO,
      filas_antes: 394_799,
      filas_sobrantes: 206_799,
      filas_borradas: 0,
      lotes: 0,
    });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('borra por lotes hasta que no queda nada sobre el tope', async () => {
    // Dos lotes llenos y uno corto: la tercera sentencia cierra la corrida.
    executeRaw
      .mockResolvedValueOnce(10_000)
      .mockResolvedValueOnce(10_000)
      .mockResolvedValueOnce(3_412)
      .mockResolvedValue(0);

    const r = await service.purgar({ aplicar: true });

    expect(r.aplicado).toBe(true);
    expect(r.filas_borradas).toBe(23_412);
    expect(r.lotes).toBe(3);
    expect(r.incompleta).toBe(false);
    expect(executeRaw).toHaveBeenCalledTimes(4);
  });

  it('con nada sobre el tope no emite ni una sentencia de borrado', async () => {
    queryRaw.mockResolvedValue(conteo(188_000, 0));

    const r = await service.purgar({ aplicar: true });

    expect(r.filas_sobrantes).toBe(0);
    expect(r.filas_borradas).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('acepta otro tope y nunca baja de 1', async () => {
    await service.purgar({ conservarPorOnt: 50 });
    expect(queryRaw.mock.calls[0].slice(1)).toContain(50);

    // Un 0 dejaria a las ONT sin su ultima lectura y el panel de alertas se
    // quedaria en blanco: el tope se recorta a 1.
    const r = await service.purgar({ conservarPorOnt: 0 });
    expect(r.conservar_por_ont).toBe(1);
  });

  it('ordena por id_monitoreo y no por timestamp_medicion', async () => {
    // Es la trampa de esta tabla. timestamp_medicion guarda el
    // last_status_change de SmartOLT, no la hora de lectura: en el respaldo de
    // produccion habia filas fechadas en marzo de 2024 que eran la lectura
    // VIGENTE de las ONT mas estables. Purgar por ese campo borraria justo lo
    // que el sistema necesita.
    executeRaw.mockResolvedValueOnce(10).mockResolvedValue(0);
    await service.purgar({ aplicar: true });

    const sql = (executeRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('ORDER BY id_monitoreo DESC');
    expect(sql).not.toContain('timestamp_medicion');
    expect(sql).toContain('LIMIT');
  });

  it('avisa cuando se agota el tope de lotes y quedan filas', async () => {
    executeRaw.mockResolvedValue(10_000);

    const r = await service.purgar({ aplicar: true });

    expect(r.incompleta).toBe(true);
    expect(r.lotes).toBe(200);
  });
});
