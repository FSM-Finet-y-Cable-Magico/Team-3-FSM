import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SmartOltClient } from './smartolt.client.js';

/**
 * `odb_port` es la posición de la ONT dentro de su caja. SmartOLT lo manda
 * como número o como texto, y vacío cuando el instalador no lo cargó (258 de
 * 940 ONT en la muestra del 28-09). Lo que no es un entero positivo no es un
 * puerto: se guarda null en vez de inventar uno.
 */
describe('SmartOltClient · puerto de la ONT en su caja', () => {
  const fetchOriginal = globalThis.fetch;
  let onus: unknown[];

  beforeEach(() => {
    globalThis.fetch = jest.fn(
      async () => new Response(JSON.stringify({ status: true, onus }), { status: 200 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  const onu = (sn: string, odb_port: unknown) => ({
    sn,
    olt_id: '3',
    board: '12',
    port: '1',
    odb_name: 'NAP203',
    odb_port,
  });

  it('lee odb_port como número, venga como texto o como número', async () => {
    onus = [onu('A', '3'), onu('B', 5)];

    const d = await new SmartOltClient('https://smartolt.test', 'tok').listarOntDetalles();

    expect(d.map((o) => o.odb_puerto)).toEqual([3, 5]);
  });

  it('deja en null lo que no es un puerto valido', async () => {
    onus = [
      onu('A', ''),
      onu('B', null),
      onu('C', '0'),
      onu('D', 'abc'),
      onu('E', '2.5'),
      onu('F', '-1'),
      onu('G', undefined),
    ];

    const d = await new SmartOltClient('https://smartolt.test', 'tok').listarOntDetalles();

    expect(d.map((o) => o.odb_puerto)).toEqual([null, null, null, null, null, null, null]);
  });

  it('un puerto absurdo de grande es un error de tipeo, no un puerto', async () => {
    // La columna es SMALLINT: "99999" no cabe y tumbaria la transaccion de la
    // ingesta entera, no solo esta ONT.
    onus = [onu('A', '99999'), onu('B', '129'), onu('C', '64')];

    const d = await new SmartOltClient('https://smartolt.test', 'tok').listarOntDetalles();

    expect(d.map((o) => o.odb_puerto)).toEqual([null, null, 64]);
  });
});

/**
 * `last_status_change` dice DESDE CUANDO la ONT esta en su estado. Hay ONT que
 * SmartOLT manda sin el dato (en la base de FiNet, equipos dados de baja en
 * 2021 y 2023). Rellenarlo con "ahora" las hacia parecer recien caidas en cada
 * sondeo, para siempre: nunca llegaban a la regla de baja de 7 dias.
 */
describe('SmartOltClient · desde cuando esta la ONT en su estado', () => {
  const fetchOriginal = globalThis.fetch;
  let onus: unknown[];

  beforeEach(() => {
    globalThis.fetch = jest.fn(
      async () => new Response(JSON.stringify({ status: true, onus }), { status: 200 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it('lee last_status_change y, si no viene, deja la fecha en null en vez de inventar "ahora"', async () => {
    onus = [
      { sn: 'A', status: 'Offline', last_status_change: '2026-11-01 10:00:00' },
      { sn: 'B', status: 'Offline', last_status_change: '' },
      { sn: 'C', status: 'Offline' },
      { sn: 'D', status: 'Offline', last_status_change: 'no es fecha' },
    ];

    const l = await new SmartOltClient('https://smartolt.test', 'tok').listarLecturas();

    // Hora de pared de Chile (verano, UTC-3), sin importar la zona del servidor.
    expect(l[0].medido_en).toEqual(new Date('2026-11-01T13:00:00.000Z'));
    expect(l.slice(1).map((x) => x.medido_en)).toEqual([null, null, null]);
  });
});
