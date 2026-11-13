import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { FUENTE_MONITOREO, type OdbInfo } from './fuente/fuente-monitoreo.js';
import { CatalogoOdbService, VIGENCIA_CATALOGO_MS } from './catalogo-odb.service.js';

/**
 * El catalogo de cajas de SmartOLT trae la capacidad (`nr_of_ports`), que el
 * censo de ONT no dice. Se guarda una copia y se refresca a lo sumo una vez al
 * dia: pedirlo al abrir cada caja gastaria la cuota de la API.
 */
describe('catalogo de cajas de SmartOLT', () => {
  let service: CatalogoOdbService;
  let odbs: OdbInfo[];
  let ultimo: { actualizado_en: Date } | null;
  let fuente: any;
  const upsert = jest.fn((a: unknown) => a);
  const findFirst = jest.fn(async (_a: unknown) => ultimo);
  const $transaction = jest.fn(async (ops: unknown[]) => ops);

  const odb = (id: string, nombre: string, capacidad: number | null): OdbInfo => ({
    id_externo: id, nombre, capacidad, zona: 'ZONA 6', lat: null, lon: null,
  });

  async function armar(conCatalogo = true) {
    fuente = { nombre: 'test', ...(conCatalogo ? { listarOdbs: jest.fn(async () => odbs) } : {}) };
    const mod = await Test.createTestingModule({
      providers: [
        CatalogoOdbService,
        { provide: PrismaService, useValue: { odb_smartolt: { upsert, findFirst }, $transaction } },
        // La empresa de la fuente es la 7: el catalogo es de ella, no de quien lo pida.
        { provide: RegistroOntService, useValue: { idEmpresaFuente: 7 } },
        { provide: FUENTE_MONITOREO, useValue: fuente },
      ],
    }).compile();
    service = mod.get(CatalogoOdbService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    odbs = [odb('11', 'NAP53', 16), odb('12', 'NAP203', 8)];
    ultimo = null;
    await armar();
  });

  it('guarda cada caja por id externo, bajo la empresa duena de la fuente', async () => {
    const r = await service.refrescar();

    expect(r).toEqual({ disponible: true, cajas: 2 });
    const primera = upsert.mock.calls[0][0] as any;
    expect(primera.where).toEqual({ id_empresa_id_externo: { id_empresa: 7, id_externo: '11' } });
    expect(primera.create).toMatchObject({ id_empresa: 7, id_externo: '11', nombre: 'NAP53', capacidad: 16 });
    expect(primera.update).toMatchObject({ nombre: 'NAP53', capacidad: 16 });
  });

  it('descarta entradas sin id o sin nombre', async () => {
    odbs = [odb('', 'NAP1', 8), odb('13', '', 8), odb('14', 'NAP2', 16)];

    const r = await service.refrescar();

    expect(r.cajas).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('sanea lo que no cabe en la tabla en vez de tumbar el refresco entero', async () => {
    // Una sola fila invalida hacia fallar la transaccion completa: el catalogo
    // no se refrescaba nunca mas.
    odbs = [odb('15', 'N'.repeat(100), 70000), odb('16', 'NAP9', 16.5), odb('17', 'NAP10', -1)];

    await service.refrescar();

    const filas = upsert.mock.calls.map((c) => (c[0] as any).create);
    expect(filas[0].nombre).toHaveLength(80);
    expect(filas.map((f) => f.capacidad)).toEqual([null, null, null]);
  });

  it('no usa una transaccion: cientos de upserts no entran en los 5 s de Prisma', async () => {
    // Medido contra Railway desde fuera de su red (~200 ms por ida y vuelta): un
    // lote de 50 upserts tardo 6,4 s, paso el limite (P2028) y no se guardaba nada.
    odbs = Array.from({ length: 120 }, (_, i) => odb(String(i + 1), `NAP${i + 1}`, 16));

    const r = await service.refrescar();

    expect(r.cajas).toBe(120);
    expect($transaction).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(120);
  });

  it('no pide el catalogo si se refresco hace menos de 24 h', async () => {
    const ahora = new Date('2026-11-13T12:00:00Z');
    ultimo = { actualizado_en: new Date(ahora.getTime() - VIGENCIA_CATALOGO_MS + 60_000) };

    expect(await service.refrescarSiVencido(ahora)).toBe(false);
    expect(fuente.listarOdbs).not.toHaveBeenCalled();
    expect((findFirst.mock.calls[0][0] as any).where).toEqual({ id_empresa: 7 });
  });

  it('lo pide si el ultimo refresco tiene mas de 24 h, o si nunca se pidio', async () => {
    const ahora = new Date('2026-11-13T12:00:00Z');
    ultimo = { actualizado_en: new Date(ahora.getTime() - VIGENCIA_CATALOGO_MS - 60_000) };
    expect(await service.refrescarSiVencido(ahora)).toBe(true);

    ultimo = null;
    expect(await service.refrescarSiVencido(ahora)).toBe(true);
    expect(fuente.listarOdbs).toHaveBeenCalledTimes(2);
  });

  it('un fallo de SmartOLT no se propaga: el sondeo sigue', async () => {
    fuente.listarOdbs.mockRejectedValueOnce(new Error('HTTP 429'));

    await expect(service.refrescarSiVencido()).resolves.toBe(false);
  });

  it('con una fuente sin catalogo (CSV, mock) no hace nada', async () => {
    await armar(false);

    expect(await service.refrescar()).toEqual({ disponible: false, cajas: 0 });
    expect(await service.refrescarSiVencido()).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
