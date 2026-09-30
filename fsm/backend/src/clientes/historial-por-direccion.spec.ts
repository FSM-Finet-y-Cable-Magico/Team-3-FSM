import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ClientesService } from './clientes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

/**
 * CU-07 "Consultando el historial de un cliente por direccion".
 *
 * Lo que hace util al CU no es listar las OT --eso ya existia-- sino separar
 * QUE PASO EN CADA CASA: si una direccion lleva tres reparaciones en dos meses
 * y la otra ninguna, el problema es del domicilio y no del cliente.
 */
describe('CU-07 · historial por dirección', () => {
  const EMPRESA = 1;

  const DIRECCIONES = [
    { id_direccion: 10, direccion_completa: 'Quilvo Norte 4013', comuna: 'La Pintana', ciudad: 'Santiago', es_principal: true },
    { id_direccion: 11, direccion_completa: 'Lincay 01190', comuna: 'La Pintana', ciudad: 'Santiago', es_principal: false },
    // Sin ninguna OT: tiene que salir igual, con total 0.
    { id_direccion: 12, direccion_completa: 'Quenui 4009', comuna: 'La Pintana', ciudad: 'Santiago', es_principal: false },
  ];

  const ot = (id: number, id_direccion: number | null, extra: Record<string, unknown> = {}) => ({
    id_ot: id,
    id_direccion,
    tipo_ot: 'REPARACION',
    estado: 'COMPLETADA',
    prioridad: 'MEDIA',
    fecha_creacion: new Date(`2026-09-${String(id).padStart(2, '0')}T10:00:00.000Z`),
    fecha_completada: null,
    categoria_falla: { id_categoria: 8, nombre: 'Falla de internet' },
    ...extra,
  });

  let ordenes: any[];
  let findFirst: any;
  let findMany: any;
  let service: ClientesService;

  beforeEach(async () => {
    jest.restoreAllMocks();
    ordenes = [
      ot(28, 10),
      ot(27, 10, { tipo_ot: 'INSTALACION', estado: 'PENDIENTE' }),
      ot(26, 10, { categoria_falla: { id_categoria: 4, nombre: 'Falla de planta externa' } }),
      ot(25, 11),
      ot(24, null), // OT del cliente sin direccion
    ];
    findFirst = jest.fn(async ({ where }: any) =>
      where.id_cliente === 5 && where.id_empresa === EMPRESA
        ? { id_cliente: 5, rut: '11111111-1', nombre_completo: 'Ana Soto', direcciones: DIRECCIONES }
        : null,
    );
    findMany = jest.fn(async () => ordenes);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientesService,
        { provide: ReparacionesRecurrentesService, useValue: { evaluar: jest.fn(async () => null) } },
        {
          provide: PrismaService,
          useValue: { cliente: { findFirst }, orden_trabajo: { findMany } },
        },
      ],
    }).compile();
    service = moduleRef.get(ClientesService);
  });

  it('agrupa las OT por direccion', async () => {
    const r = await service.historialPorDireccion(5, EMPRESA);

    expect(r.direcciones.map((d) => [d.id_direccion, d.total_ot])).toEqual([
      [10, 3],
      [11, 1],
      [12, 0],
    ]);
  });

  it('una direccion sin OT aparece igual, con total 0', async () => {
    // Saber que en esa casa nunca paso nada es informacion. Omitirla la haria
    // parecer inexistente.
    const r = await service.historialPorDireccion(5, EMPRESA);

    expect(r.direcciones.find((d) => d.id_direccion === 12)).toMatchObject({
      total_ot: 0,
      ultima_ot: null,
      categoria_mas_frecuente: null,
      ordenes: [],
    });
  });

  it('la principal va primero', async () => {
    const r = await service.historialPorDireccion(5, EMPRESA);

    expect(r.direcciones[0].es_principal).toBe(true);
  });

  it('cuenta por tipo y por estado', async () => {
    const r = await service.historialPorDireccion(5, EMPRESA);
    const principal = r.direcciones[0];

    expect(principal.por_tipo).toEqual({ REPARACION: 2, INSTALACION: 1 });
    expect(principal.por_estado).toEqual({ COMPLETADA: 2, PENDIENTE: 1 });
  });

  it('senala la categoria mas repetida de esa direccion', async () => {
    // Es la senal que hace util al CU: dos fallas de internet en la misma casa
    // no es lo mismo que dos fallas distintas.
    const r = await service.historialPorDireccion(5, EMPRESA);

    expect(r.direcciones[0].categoria_mas_frecuente).toEqual({
      nombre: 'Falla de internet',
      veces: 2,
    });
  });

  it('la ultima OT es la mas reciente', async () => {
    const r = await service.historialPorDireccion(5, EMPRESA);

    expect(r.direcciones[0].ultima_ot).toEqual(new Date('2026-09-28T10:00:00.000Z'));
  });

  it('declara las OT que no apuntan a ninguna direccion', async () => {
    // `id_direccion` es opcional en el modelo, asi que existen. Sin declararlas,
    // la suma de `total_ot` no cuadraria con el total y alguien saldria a
    // buscar OT perdidas.
    const r = await service.historialPorDireccion(5, EMPRESA);

    const sumadas = r.direcciones.reduce((a, d) => a + d.total_ot, 0);
    expect(r.ot_sin_direccion).toBe(1);
    expect(sumadas + r.ot_sin_direccion).toBe(r.total_ot);
  });

  // ------------------------------------------------------------ rendimiento
  describe('la consulta va por cliente, no por direccion', () => {
    it('filtra por id_cliente, que es el campo indexado', async () => {
      // `orden_trabajo` tiene @@index([id_cliente]) pero NO sobre id_direccion:
      // consultar por direccion haria un scan de la tabla. El indice que
      // faltaria es aditivo pero va sobre tabla compartida con G1 y G8, o sea
      // ventana coordinada. Si alguien "optimiza" esto filtrando por direccion,
      // esta prueba cae.
      await service.historialPorDireccion(5, EMPRESA);

      const where = findMany.mock.calls[0][0].where;
      expect(where).toEqual({ id_cliente: 5, id_empresa: EMPRESA });
      expect(where).not.toHaveProperty('id_direccion');
    });

    it('hace UNA sola consulta de OT, no una por direccion', async () => {
      // Tres direcciones no pueden ser tres consultas: con un cliente de diez
      // direcciones serian diez viajes a la base para el mismo dato.
      await service.historialPorDireccion(5, EMPRESA);

      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('trae un tope y avisa si lo supero', async () => {
      ordenes = Array.from({ length: 501 }, (_, i) => ot(i + 1, 10));

      const r = await service.historialPorDireccion(5, EMPRESA);

      expect(findMany.mock.calls[0][0].take).toBe(501);
      expect(r.truncado).toBe(true);
      expect(r.total_ot).toBe(500);
    });

    it('sin superar el tope, no dice que trunco', async () => {
      const r = await service.historialPorDireccion(5, EMPRESA);

      expect(r.truncado).toBe(false);
    });

    it('detalla como maximo 20 OT por direccion, pero el conteo es completo', async () => {
      ordenes = Array.from({ length: 30 }, (_, i) => ot(i + 1, 10));

      const r = await service.historialPorDireccion(5, EMPRESA);

      expect(r.direcciones[0].total_ot).toBe(30);
      expect(r.direcciones[0].ordenes).toHaveLength(20);
    });
  });

  // ------------------------------------------------------------ aislamiento
  it('un cliente de otra empresa no existe para este endpoint', async () => {
    await expect(service.historialPorDireccion(5, 2)).rejects.toThrow(NotFoundException);
  });

  it('un cliente inexistente responde 404 y no consulta OT', async () => {
    await expect(service.historialPorDireccion(999, EMPRESA)).rejects.toThrow(NotFoundException);

    expect(findMany).not.toHaveBeenCalled();
  });
});
