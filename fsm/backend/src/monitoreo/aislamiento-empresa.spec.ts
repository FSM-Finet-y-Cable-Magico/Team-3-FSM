import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MonitoreoService } from './monitoreo.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { LigadoCajaService } from './ligado-caja.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FUENTE_MONITOREO } from './fuente/fuente-monitoreo.js';

/**
 * Fija el aislamiento entre empresas del modulo de monitoreo.
 *
 * Los tres casos de abajo fueron fugas reales de esta rama, encontradas en una
 * auditoria. Comparten la misma causa: `registro_ont` gano una columna
 * `id_empresa` para poder aislar sin depender del cliente, y despues varias
 * consultas siguieron sin usarla.
 *
 * Importa mas que en otros modulos porque `registro_ont.nombre_cliente_ext`
 * trae, en 118 de las 940 filas reales, el nombre, el RUT, el telefono y la
 * direccion del cliente todos juntos: SmartOLT no separa esos campos.
 */
describe('aislamiento entre empresas del monitoreo', () => {
  describe('lectura de ONT', () => {
    const findMany = jest.fn(async (_args?: any) => []);
    const findUnique = jest.fn(async (_args?: any) => null as any);
    let service: MonitoreoService;

    beforeEach(async () => {
      jest.clearAllMocks();
      const mod = await Test.createTestingModule({
        providers: [
          MonitoreoService,
          { provide: PrismaService, useValue: { registro_ont: { findMany, findUnique } } },
          { provide: RegistroOntService, useValue: {} },
          { provide: FUENTE_MONITOREO, useValue: { nombre: 'test' } },
        ],
      }).compile();
      service = mod.get(MonitoreoService);
    });

    it('filtra el listado por id_empresa, no por la lista de clientes', async () => {
      await service.lecturasRecientes(1);

      // La version anterior mandaba
      //   OR: [{ id_cliente: { in: [...] } }, { id_cliente: null }]
      // y esa rama del null dejaba ver TODAS las ONT de la otra empresa,
      // porque id_cliente esta en null en casi todas las filas ingestadas.
      expect(findMany.mock.calls[0][0].where).toEqual({ id_empresa: 1 });
      expect(findMany.mock.calls[0][0].where.OR).toBeUndefined();
    });

    it('no entrega el detalle de una ONT de otra empresa', async () => {
      findUnique.mockImplementation(async () => ({
        numero_serie: 'SN-1',
        id_empresa: 2, // de la otra empresa
        id_cliente: null, // como llega de SmartOLT: sin cliente resuelto
        nombre_cliente_ext: 'JUAN PEREZ / 13.452.352-2 / 9 3263 3835',
        monitoreos: [],
        historial: [],
      }));

      await expect(service.detalleOnt('SN-1', 1)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('si id_empresa quedo en null, la fila es invisible y no publica', async () => {
      // Fallar del lado seguro: una fila vieja sin empresa no se le muestra a
      // nadie, en vez de mostrarsele a todos.
      findUnique.mockImplementation(async () => ({
        numero_serie: 'SN-2',
        id_empresa: null,
        id_cliente: null,
        monitoreos: [],
        historial: [],
      }));

      await expect(service.detalleOnt('SN-2', 1)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ligado de ONT a caja', () => {
    it('solo considera las ONT de la empresa que pidio el ligado', async () => {
      const registroFindMany = jest.fn(async (_args?: any) => []);
      const cajaFindMany = jest.fn(async (_args?: any) => []);

      const mod = await Test.createTestingModule({
        providers: [
          LigadoCajaService,
          {
            provide: PrismaService,
            useValue: {
              caja_nap: { findMany: cajaFindMany },
              registro_ont: { findMany: registroFindMany },
              $transaction: async (ops: unknown[]) => ops,
            },
          },
        ],
      }).compile();

      await mod.get(LigadoCajaService).ligarCajas(1);

      // Sin este filtro, una ONT de la otra empresa podia quedarse con una caja
      // de esta por exclusividad, y ademas recibir un id_caja_nap ajeno.
      expect(registroFindMany.mock.calls[0][0].where).toEqual({ id_empresa: 1 });
    });
  });
});
