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
});
