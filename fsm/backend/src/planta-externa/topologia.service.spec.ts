import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TopologiaService } from './topologia.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-18, CU-19 y CU-20. Se doblan las consultas y se afirma sobre las REGLAS,
 * que es donde estan las decisiones: que no se creen cajas duplicadas para el
 * ligado, que no se baje la capacidad por debajo de lo ocupado, y que un puerto
 * no quede en un estado que le mienta al conteo de disponibilidad.
 */
describe('topologia de planta externa', () => {
  let service: TopologiaService;
  let cajas: any[];
  let puertos: any[];

  const cajaFindMany = jest.fn(async (_a?: any) => cajas);
  const cajaFindFirst = jest.fn(async (_a?: any) => null as any);
  const cajaCreate = jest.fn(async ({ data }: any) => ({ id_caja_nap: 99, ...data }));
  const cajaUpdate = jest.fn(async ({ data }: any) => ({ id_caja_nap: 1, ...data }));
  const puertoCreateMany = jest.fn(async (_a?: any) => ({ count: 0 }));
  const puertoFindFirst = jest.fn(async (_a?: any) => null as any);
  const puertoUpdate = jest.fn(async ({ data }: any) => ({ id_puerto: 1, ...data }));
  const mufaFindUnique = jest.fn(async (_a?: any) => ({ id_mufa: 1 }));
  const clienteFindFirst = jest.fn(async (_a?: any) => ({ id_cliente: 5 }));
  const auditoriaCreate = jest.fn(async (_a?: any) => ({}));

  beforeEach(async () => {
    jest.clearAllMocks();
    cajas = [{ id_caja_nap: 1, identificador_unico: 'NAP 6' }];
    puertos = [];
    const mod = await Test.createTestingModule({
      providers: [
        TopologiaService,
        {
          provide: PrismaService,
          useValue: {
            caja_nap: {
              findMany: cajaFindMany,
              findFirst: cajaFindFirst,
              create: cajaCreate,
              update: cajaUpdate,
            },
            puerto_nap: {
              createMany: puertoCreateMany,
              findFirst: puertoFindFirst,
              update: puertoUpdate,
            },
            mufa: { findUnique: mufaFindUnique },
            cliente: { findFirst: clienteFindFirst },
            log_auditoria: { create: auditoriaCreate },
            $transaction: async (fn: any) =>
              fn({ caja_nap: { create: cajaCreate }, puerto_nap: { createMany: puertoCreateMany } }),
          },
        },
      ],
    }).compile();
    service = mod.get(TopologiaService);
  });

  describe('CU-18 · crear caja', () => {
    it('rechaza un nombre que colisiona SOLO al normalizar', async () => {
      // El @unique de la base deja pasar "NAP06" existiendo "NAP 6": son textos
      // distintos. Pero el ligado ONT->caja compara normalizado, asi que serian
      // dos cajas disputandose las mismas ONT.
      await expect(
        service.crearCaja({ identificador_unico: 'NAP06' } as any, 1, 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('acepta un nombre que no colisiona', async () => {
      await service.crearCaja({ identificador_unico: 'NAP 7' } as any, 1, 1);
      expect(cajaCreate).toHaveBeenCalled();
    });

    it('crea los puertos junto con la caja, no en un segundo paso', async () => {
      await service.crearCaja({ identificador_unico: 'NAP 8', capacidad_puertos: 8 } as any, 1, 1);

      const { data } = puertoCreateMany.mock.calls[0][0] as any;
      expect(data).toHaveLength(8);
      expect(data[0]).toMatchObject({ numero_puerto: 1, estado: 'LIBRE' });
      expect(data[7]).toMatchObject({ numero_puerto: 8 });
    });

    it('rechaza un identificador sin letras ni numeros', async () => {
      await expect(
        service.crearCaja({ identificador_unico: '---' } as any, 1, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deja la caja en la empresa de quien la crea, no suelta', async () => {
      // Una caja con id_empresa null la ve TODA empresa (asi lo hace
      // `listarCajas`), asi que crearla sin empresa la publicaria de mas.
      await service.crearCaja({ identificador_unico: 'NAP 9' } as any, 1, 7);
      expect((cajaCreate.mock.calls[0][0] as any).data.id_empresa).toBe(7);
    });
  });

  describe('CU-19 · editar', () => {
    it('no permite bajar la capacidad por debajo de los puertos ocupados', async () => {
      cajaFindFirst.mockImplementation(async () => ({
        id_caja_nap: 1,
        identificador_unico: 'NAP 6',
        puertos: [{ estado: 'OCUPADO' }, { estado: 'OCUPADO' }, { estado: 'LIBRE' }],
      }));

      await expect(
        service.editarCaja(1, { capacidad_puertos: 1 }, 1, 1),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechaza un PATCH vacío en vez de auditar un cambio que no ocurrió', async () => {
      // Se prueba con la FORMA REAL que entrega ValidationPipe, no con un {}.
      // Con `target: ES2023` un DTO transformado trae todas las claves de la
      // clase con valor `undefined`, asi que `Object.keys(dto).length === 0`
      // nunca se cumple. Con un `{}` literal el test pasaba y el endpoint
      // devolvia 200 igual: el doble era mas benevolo que la realidad.
      const cuerpoVacio = Object.fromEntries(
        ['id_mufa', 'identificador_unico', 'numero_poste', 'zona', 'capacidad_puertos', 'latitud', 'longitud']
          .map((k) => [k, undefined]),
      );

      await expect(service.editarCaja(1, cuerpoVacio, 1, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(auditoriaCreate).not.toHaveBeenCalled();
    });

    it('rechaza un PATCH de puerto vacío, con la misma forma real', async () => {
      const cuerpoVacio = { estado: undefined, id_cliente_asociado: undefined };
      await expect(service.editarPuerto(1, cuerpoVacio, 1, 1)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('audita la edición con el valor anterior y el nuevo', async () => {
      cajaFindFirst.mockImplementation(async () => ({
        id_caja_nap: 1,
        identificador_unico: 'NAP 6',
        zona: 'Centro',
        puertos: [],
      }));

      await service.editarCaja(1, { zona: 'Norte' }, 42, 1);

      const { data } = auditoriaCreate.mock.calls[0][0] as any;
      expect(data.accion).toBe('EDITAR_CAJA_NAP');
      expect(data.id_usuario).toBe(42);
      expect(data.valor_anterior.zona).toBe('Centro');
      expect(data.valor_nuevo.zona).toBe('Norte');
    });

    it('no deja un puerto OCUPADO sin cliente', async () => {
      puertoFindFirst.mockImplementation(async () => ({
        id_puerto: 1,
        estado: 'LIBRE',
        id_cliente_asociado: null,
      }));

      await expect(
        service.editarPuerto(1, { estado: 'OCUPADO' }, 1, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('no deja un cliente colgando de un puerto que se libera', async () => {
      // Ocupacion fantasma: el conteo de CU-20 lo veria libre y el cliente
      // seguiria apuntando ahi.
      puertoFindFirst.mockImplementation(async () => ({
        id_puerto: 1,
        estado: 'OCUPADO',
        id_cliente_asociado: 5,
      }));

      await expect(
        service.editarPuerto(1, { estado: 'LIBRE' }, 1, 1),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('libera bien cuando se sueltan estado y cliente a la vez', async () => {
      puertoFindFirst.mockImplementation(async () => ({
        id_puerto: 1,
        estado: 'OCUPADO',
        id_cliente_asociado: 5,
      }));

      await service.editarPuerto(1, { estado: 'LIBRE', id_cliente_asociado: null }, 1, 1);
      expect(puertoUpdate).toHaveBeenCalled();
    });

    it('no encuentra un puerto de otra empresa', async () => {
      puertoFindFirst.mockImplementation(async () => null);
      await expect(service.editarPuerto(1, { estado: 'LIBRE' }, 1, 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('CU-20 · disponibilidad', () => {
    it('ordena las cajas de la más holgada a la más justa', async () => {
      cajaFindMany.mockImplementation(async () => [
        { id_caja_nap: 1, identificador_unico: 'NAP 1', puertos: [{ estado: 'LIBRE' }] },
        {
          id_caja_nap: 2,
          identificador_unico: 'NAP 2',
          puertos: [{ estado: 'LIBRE' }, { estado: 'LIBRE' }, { estado: 'OCUPADO' }],
        },
      ]);

      const r = await service.cajasConDisponibilidad(1);

      expect(r.map((c) => c.identificador_unico)).toEqual(['NAP 2', 'NAP 1']);
      expect(r[0].libres).toBe(2);
    });

    it('separa lo confirmado ocupado de lo que solo no tiene registro', async () => {
      cajaFindFirst.mockImplementation(async () => ({
        id_caja_nap: 1,
        identificador_unico: 'NAP 6',
        capacidad_puertos: 4,
        puertos: [
          { id_puerto: 1, numero_puerto: 1, estado: 'LIBRE', id_cliente_asociado: null },
          { id_puerto: 2, numero_puerto: 2, estado: 'RESERVADO', id_cliente_asociado: null },
          { id_puerto: 3, numero_puerto: 3, estado: 'OCUPADO', id_cliente_asociado: 5 },
          { id_puerto: 4, numero_puerto: 4, estado: 'OCUPADO', id_cliente_asociado: 6 },
        ],
      }));

      const r = await service.puertosDeCaja(1, 1);

      // `sin_registro`, no `libres`: las cajas son de los postes y las comparten
      // varios operadores, asi que nadie puede afirmar que un puerto este libre
      // sin haberlo mirado. Lo unico duro es lo OCUPADO, que alguien confirmo.
      expect({ s: r.sin_registro, r: r.reservados, o: r.ocupados }).toEqual({ s: 1, r: 1, o: 2 });
      expect(r.puertos).toHaveLength(4);
    });
  });
});
