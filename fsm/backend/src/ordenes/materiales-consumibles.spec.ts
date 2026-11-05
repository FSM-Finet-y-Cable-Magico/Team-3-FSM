import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';
import { FAN_OUT_CIERRE } from './fan-out/fan-out-cierre.js';
import { MOMENTO_FAN_OUT } from './fan-out/momento-fan-out.js';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * El catalogo del paso "Materiales utilizados" del cierre lista SOLO
 * consumibles.
 *
 * Por el ACUERDO G1<->G3 los equipos individualizables (router, ONU) se
 * declaran aparte, por numero de serie, y G1 los mueve en su maquina de
 * estados. No tienen fila en `stock_consumible`, asi que mientras se listaban
 * aca salian con "Stock: 0" y el boton de sumar deshabilitado: visibles pero
 * inutilizables, que es peor que no mostrarlos.
 */
describe('catalogo de materiales del cierre: solo consumibles', () => {
  const findMany = jest.fn(async (_a: any) => [] as any[]);
  const prisma = { tipo_equipo: { findMany } };

  const servicio = async () => {
    const mod = await Test.createTestingModule({
      providers: [
        OrdenesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReparacionesRecurrentesService, useValue: { evaluar: jest.fn() } },
        { provide: SinReagendarService, useValue: {} },
        { provide: CloudinaryService, useValue: {} },
        { provide: DashboardGateway, useValue: { emitirActualizacion: jest.fn() } },
        { provide: FAN_OUT_CIERRE, useValue: { nombre: 'noop', notificar: jest.fn() } },
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
      ],
    }).compile();
    return mod.get(OrdenesService);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deja fuera los tipos individualizables, y conserva los que no traen el dato', async () => {
    await (await servicio()).obtenerMateriales(1);

    const where = findMany.mock.calls[0][0].where;
    expect(where.id_empresa).toBe(1);
    expect(where.activo).toBe(true);
    // `false` O nulo, no `NOT true`: la columna admite nulos y en SQL
    // `NOT (col = true)` tambien descarta los nulos.
    expect(where.OR).toEqual([
      { requiere_serie_individual: false },
      { requiere_serie_individual: null },
    ]);
  });

  it('el stock sigue acotado a bodegas de la empresa, o sin bodega', async () => {
    await (await servicio()).obtenerMateriales(2);

    const { where } = findMany.mock.calls[0][0].include.stock;
    expect(where.OR).toEqual([{ bodega: { id_empresa: 2 } }, { id_bodega: null }]);
  });

  it('un consumible sin fila de stock se informa con stock nulo, no se oculta', async () => {
    findMany.mockResolvedValueOnce([
      { id_tipo_equipo: 5, nombre: 'Cable de fibra optica', categoria: 'Fibra', requiere_serie_individual: null, stock: [] },
    ]);

    const [material] = await (await servicio()).obtenerMateriales(1);
    expect(material).toEqual({
      id_tipo_equipo: 5,
      nombre: 'Cable de fibra optica',
      categoria: 'Fibra',
      requiere_serie_individual: false,
      stock: null,
    });
  });
});
