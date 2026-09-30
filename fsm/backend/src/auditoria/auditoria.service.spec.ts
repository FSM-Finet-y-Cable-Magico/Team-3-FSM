import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-41. Las dos primeras pruebas cubren las dos trampas que el plan pedia
 * decidir al escribir y no al depurar: el BigInt y las filas sin usuario.
 */
describe('CU-41 · consulta del log de auditoría', () => {
  const EMPRESA = 1;

  const FILA = {
    id_log: 9007199254740993n, // mas alla de Number.MAX_SAFE_INTEGER a proposito
    id_usuario: 3,
    accion: 'CERRAR_OT',
    entidad_afectada: 'orden_trabajo',
    id_entidad_afectada: 41,
    valor_anterior: { estado: 'EN_CURSO' },
    valor_nuevo: { estado: 'COMPLETADA' },
    ip_origen: '10.0.0.5',
    fecha_hora: new Date('2026-09-28T15:00:00.000Z'),
    usuario: { id_usuario: 3, nombre_completo: 'Ana Soto', nombre_usuario: 'ana.soto' },
  };

  let findMany: any;
  let count: any;
  let groupBy: any;
  let service: AuditoriaService;

  beforeEach(async () => {
    jest.restoreAllMocks();
    findMany = jest.fn(async () => [FILA]);
    // El primer count es el del filtro; el segundo, el de las filas sin usuario.
    count = jest.fn().mockResolvedValueOnce(1 as never).mockResolvedValueOnce(15 as never);
    groupBy = jest.fn(async () => [{ accion: 'LOGIN_EXITOSO', _count: { accion: 96 } }]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditoriaService,
        { provide: PrismaService, useValue: { log_auditoria: { findMany, count, groupBy } } },
      ],
    }).compile();
    service = moduleRef.get(AuditoriaService);
  });

  // -------------------------------------------------------------- trampa 1
  describe('el BigInt de id_log', () => {
    it('sale como string, no como numero', async () => {
      const r = await service.listar(EMPRESA);

      expect(r.data[0].id_log).toBe('9007199254740993');
      expect(typeof r.data[0].id_log).toBe('string');
    });

    it('la respuesta se puede serializar a JSON', async () => {
      // Sin la conversion, `JSON.stringify` lanza TypeError y el endpoint
      // entero responde 500 en cuanto devuelve una sola fila.
      const r = await service.listar(EMPRESA);

      expect(() => JSON.stringify(r)).not.toThrow();
    });

    it('no pierde precision en el camino', async () => {
      // 9007199254740993 no es representable como `number`: pasarlo por Number
      // lo redondearia a ...992 y el id dejaria de identificar la fila.
      const r = await service.listar(EMPRESA);

      expect(r.data[0].id_log).not.toBe(String(Number(FILA.id_log)));
    });
  });

  // -------------------------------------------------------------- trampa 2
  describe('las filas sin usuario', () => {
    it('el aislamiento va por la relacion, porque no hay columna de empresa', async () => {
      await service.listar(EMPRESA);

      expect(findMany.mock.calls[0][0].where).toMatchObject({ usuario: { id_empresa: EMPRESA } });
    });

    it('informa cuantas filas quedaron fuera', async () => {
      // El join descarta en silencio las filas con id_usuario nulo. Esconderlas
      // sin decirlo convierte un registro de auditoria en uno incompleto que se
      // ve completo, que es peor que no tenerlo.
      const r = await service.listar(EMPRESA);

      expect(r.excluidas_sin_usuario).toBe(15);
    });

    it('ese conteo NO filtra por empresa, porque esas filas no tienen ninguna', async () => {
      await service.listar(EMPRESA);

      expect(count.mock.calls[1][0]).toEqual({ where: { id_usuario: null } });
    });
  });

  // -------------------------------------------------------------- filtros
  describe('filtros', () => {
    it('la accion busca por coincidencia parcial', async () => {
      await service.listar(EMPRESA, 1, 20, { accion: 'cerrar' });

      expect(findMany.mock.calls[0][0].where.accion).toEqual({
        contains: 'cerrar',
        mode: 'insensitive',
      });
    });

    it('la entidad se compara completa', async () => {
      // Parcial haria que "ot" trajera tambien `orden_trabajo` y `puerto_nap`.
      await service.listar(EMPRESA, 1, 20, { entidad: 'ticket' });

      expect(findMany.mock.calls[0][0].where.entidad_afectada).toEqual({
        equals: 'ticket',
        mode: 'insensitive',
      });
    });

    it('hasta es inclusivo: el limite es el dia siguiente', async () => {
      // Con `lte` sobre la medianoche del propio dia se perderia todo lo
      // ocurrido despues de las 00:00, o sea el dia entero.
      await service.listar(EMPRESA, 1, 20, { desde: '2026-09-01', hasta: '2026-09-01' });

      const rango = findMany.mock.calls[0][0].where.fecha_hora;
      expect(rango.gte).toEqual(new Date('2026-09-01T00:00:00.000Z'));
      expect(rango.lt).toEqual(new Date('2026-09-02T00:00:00.000Z'));
    });

    it.each([
      ['formato', { desde: '01-09-2026', hasta: '2026-09-02' }],
      ['hasta antes que desde', { desde: '2026-09-10', hasta: '2026-09-01' }],
    ])('rechaza fechas invalidas: %s', async (_caso, filtros) => {
      await expect(service.listar(EMPRESA, 1, 20, filtros)).rejects.toThrow(BadRequestException);
    });

    it('sin fechas no filtra por fecha', async () => {
      await service.listar(EMPRESA);

      expect(findMany.mock.calls[0][0].where).not.toHaveProperty('fecha_hora');
    });

    it('recorta un limite desmedido', async () => {
      const r = await service.listar(EMPRESA, 1, 5000);

      expect(r.limit).toBe(100);
      expect(findMany.mock.calls[0][0].take).toBe(100);
    });

    it('ordena por fecha descendente', async () => {
      await service.listar(EMPRESA);

      expect(findMany.mock.calls[0][0].orderBy).toEqual({ fecha_hora: 'desc' });
    });
  });

  // ------------------------------------------------------------- acciones
  describe('catálogo de acciones', () => {
    it('se calcula de los datos y no de una lista fija', async () => {
      // La tabla la escriben los tres grupos: una lista escrita a mano queda
      // incompleta en cuanto G1 o G8 agregan una accion.
      const r = await service.acciones(EMPRESA);

      expect(r).toEqual([{ accion: 'LOGIN_EXITOSO', veces: 96 }]);
      expect(groupBy.mock.calls[0][0].where).toMatchObject({ usuario: { id_empresa: EMPRESA } });
    });
  });

  // -------------------------------------------------------------- la vista
  describe('forma de la respuesta', () => {
    it('trae el antes, el despues y quien lo hizo', async () => {
      const r = await service.listar(EMPRESA);

      expect(r.data[0]).toMatchObject({
        accion: 'CERRAR_OT',
        entidad_afectada: 'orden_trabajo',
        id_entidad_afectada: 41,
        valor_anterior: { estado: 'EN_CURSO' },
        valor_nuevo: { estado: 'COMPLETADA' },
        usuario: { id_usuario: 3, nombre_completo: 'Ana Soto' },
      });
    });

    it('no expone el hash ni nada mas del usuario', async () => {
      findMany.mockResolvedValueOnce([
        { ...FILA, usuario: { ...FILA.usuario, password_hash: 'no-debe-salir', email: 'a@b.cl' } },
      ] as never);

      const r = await service.listar(EMPRESA);

      expect(Object.keys(r.data[0].usuario!)).toEqual([
        'id_usuario',
        'nombre_completo',
        'nombre_usuario',
      ]);
    });
  });
});
