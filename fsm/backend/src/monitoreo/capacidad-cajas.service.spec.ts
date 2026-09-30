import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CapacidadCajasService } from './capacidad-cajas.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FUENTE_MONITOREO } from './fuente/fuente-monitoreo.js';

/**
 * Llenar `caja_nap.capacidad_puertos` desde el catalogo de SmartOLT.
 *
 * Lo que estas pruebas cuidan no es que copie un numero, sino que NO lo copie
 * cuando no esta seguro: emparejar cajas por nombre entre Tomodat y SmartOLT es
 * justamente lo que no funciona, y una capacidad equivocada crea puertos que no
 * existen.
 */
describe('capacidad de cajas desde el catálogo', () => {
  const EMPRESA = 1;

  let cajas: any[];
  let registros: any[];
  let catalogo: any[];
  let updateMany: any;
  let listarOdbs: any;
  let service: CapacidadCajasService;

  const armar = async (conCatalogo = true) => {
    updateMany = jest.fn(async () => ({ count: 1 }));
    listarOdbs = jest.fn(async () => catalogo);
    const prisma: any = {
      caja_nap: { findMany: jest.fn(async () => cajas), updateMany },
      registro_ont: { findMany: jest.fn(async () => registros) },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    };
    const fuente: any = { nombre: 'doble' };
    if (conCatalogo) fuente.listarOdbs = listarOdbs;

    const moduleRef = await Test.createTestingModule({
      providers: [
        CapacidadCajasService,
        { provide: PrismaService, useValue: prisma },
        { provide: FUENTE_MONITOREO, useValue: fuente },
      ],
    }).compile();
    service = moduleRef.get(CapacidadCajasService);
  };

  beforeEach(async () => {
    jest.restoreAllMocks();
    cajas = [
      { id_caja_nap: 15, identificador_unico: 'NAP 7' },
      { id_caja_nap: 316, identificador_unico: 'nap7' },
      { id_caja_nap: 999, identificador_unico: 'NAP 999' }, // sin ONT ligada
    ];
    registros = [
      { id_caja_nap: 15, odb: 'NAP 7' },
      { id_caja_nap: 15, odb: ' nap 7 ' }, // misma, solo caja y espacios
      { id_caja_nap: 316, odb: 'NAP-07' },
    ];
    catalogo = [
      { id_externo: '1', nombre: 'NAP 7', capacidad: 16, zona: 'ZONA 3', lat: null, lon: null },
      { id_externo: '2', nombre: 'NAP-07', capacidad: 8, zona: 'ZONA 4', lat: null, lon: null },
    ];
    await armar();
  });

  it('resuelve la capacidad por el nombre que reportan sus propias ONT', async () => {
    const r = await service.completarCapacidades(EMPRESA);

    expect(r.resueltas).toBe(2);
    expect(r.puertos_declarados).toBe(24); // 16 + 8
  });

  it('la clave tolera caja y espacios, y nada mas', async () => {
    // " nap 7 " y "NAP 7" son el mismo nombre escrito distinto por la misma
    // persona; no hace falta mas que eso porque los dos lados son de SmartOLT.
    const r = await service.completarCapacidades(EMPRESA);

    expect(r.ont_no_coinciden).toBe(0);
  });

  it('NAP 7, NAP-07 y NAP07 son cajas DISTINTAS', async () => {
    // En SmartOLT son tres, en tres zonas y tres puertos PON distintos. El
    // normalizador del ligado las colapsa; este no, y por eso no se reusa: darle
    // a una la capacidad de otra crea puertos que no existen.
    catalogo = [
      { id_externo: '1', nombre: 'NAP 7', capacidad: 16, zona: 'ZONA 3', lat: null, lon: null },
      { id_externo: '2', nombre: 'NAP-07', capacidad: 8, zona: 'ZONA 4', lat: null, lon: null },
      { id_externo: '3', nombre: 'NAP07', capacidad: 32, zona: 'ZONA 5', lat: null, lon: null },
    ];
    await armar();

    const r = await service.completarCapacidades(EMPRESA);

    // Cada caja se lleva la capacidad de SU nombre, no una mezcla.
    expect(r.homonimas_que_diferen).toBe(0);
    expect(r.puertos_declarados).toBe(24); // 16 de la 15 + 8 de la 316
  });

  it('NO escribe por defecto', async () => {
    const r = await service.completarCapacidades(EMPRESA);

    expect(r.aplicado).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('escribe solo con aplicar en true', async () => {
    const r = await service.completarCapacidades(EMPRESA, true);

    expect(r.aplicado).toBe(true);
    expect(updateMany).toHaveBeenCalled();
  });

  it('agrupa las escrituras por capacidad', async () => {
    // Son dos o tres valores distintos en todo el parque: dos updateMany en vez
    // de una escritura por caja.
    await service.completarCapacidades(EMPRESA, true);

    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('no pisa una capacidad cargada entre la lectura y la escritura', async () => {
    await service.completarCapacidades(EMPRESA, true);

    for (const llamada of updateMany.mock.calls as any[][]) {
      expect(llamada[0].where.capacidad_puertos).toBeNull();
    }
  });

  // -------------------------------------------------------- lo que NO resuelve
  describe('cuando no está seguro, no adivina', () => {
    it('una caja sin ONT ligada queda fuera', async () => {
      const r = await service.completarCapacidades(EMPRESA);

      expect(r.sin_ont_ligada).toBe(1);
    });

    it('si sus ONT dicen nombres distintos, no resuelve', async () => {
      // Discrepar significa que el ligado metio en la misma caja ONT de cajas
      // diferentes. Elegir una arrastraria ese error a la capacidad.
      registros.push({ id_caja_nap: 15, odb: 'NAP 48' });
      await armar();

      const r = await service.completarCapacidades(EMPRESA);

      expect(r.ont_no_coinciden).toBe(1);
      expect(r.resueltas).toBe(1);
    });

    it('si el nombre no está en el catálogo, no resuelve', async () => {
      catalogo = catalogo.filter((c) => c.nombre !== 'NAP-07');
      await armar();

      const r = await service.completarCapacidades(EMPRESA);

      expect(r.sin_entrada_en_catalogo).toBe(1);
    });

    it('homónimas del catálogo con capacidades distintas: no resuelve', async () => {
      catalogo.push({ id_externo: '3', nombre: 'NAP 7', capacidad: 8, zona: null, lat: null, lon: null });
      await armar();

      const r = await service.completarCapacidades(EMPRESA);

      expect(r.homonimas_que_diferen).toBe(1);
    });

    it('homónimas que coinciden en capacidad SÍ resuelven', async () => {
      // El nombre es ambiguo pero la respuesta no: las dos dicen 16.
      catalogo.push({ id_externo: '3', nombre: 'NAP 7', capacidad: 16, zona: null, lat: null, lon: null });
      await armar();

      const r = await service.completarCapacidades(EMPRESA);

      expect(r.homonimas_que_diferen).toBe(0);
      expect(r.resueltas).toBe(2);
    });

    it('una entrada del catálogo sin capacidad no cuenta', async () => {
      catalogo = [{ id_externo: '1', nombre: 'NAP 7', capacidad: null, zona: null, lat: null, lon: null }];
      await armar();

      const r = await service.completarCapacidades(EMPRESA);

      expect(r.resueltas).toBe(0);
      expect(r.sin_entrada_en_catalogo).toBe(2);
    });
  });

  it('una fuente sin catálogo lo dice, en vez de responder cero', async () => {
    // El CSV y el mock no tienen catalogo. Devolver 0 resueltas haria creer que
    // el catalogo esta vacio, que es distinto de no poder consultarlo.
    await armar(false);

    await expect(service.completarCapacidades(EMPRESA)).rejects.toThrow(BadRequestException);
  });

  it('solo mira cajas que hoy no tienen capacidad', async () => {
    const prisma = (service as any).prisma;
    await service.completarCapacidades(EMPRESA);

    expect(prisma.caja_nap.findMany.mock.calls[0][0].where).toMatchObject({
      id_empresa: EMPRESA,
      capacidad_puertos: null,
    });
  });

  it('trae ejemplos para poder revisar antes de aplicar', async () => {
    const r = await service.completarCapacidades(EMPRESA);

    expect(r.ejemplos[0]).toMatchObject({ id_caja_nap: 15, odb: expect.any(String), capacidad: 16 });
    expect(r.ejemplos.length).toBeLessThanOrEqual(10);
  });
});
