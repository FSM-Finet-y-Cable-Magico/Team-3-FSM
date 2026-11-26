import { describe, expect, it } from '@jest/globals';
import { ejecutarEnLotes } from './lotes.js';

describe('escrituras masivas en lotes', () => {
  it('ejecuta todas las operaciones, con a lo sumo N en vuelo a la vez', async () => {
    let enVuelo = 0;
    let maximo = 0;
    const hechas: number[] = [];
    const op = (i: number) =>
      new Promise<void>((resolve) => {
        enVuelo++;
        maximo = Math.max(maximo, enVuelo);
        setTimeout(() => {
          enVuelo--;
          hechas.push(i);
          resolve();
        }, 1);
      });

    // Las operaciones de Prisma son perezosas: arrancan al esperarlas. Aca se
    // imita eso con funciones que el helper dispara por lote.
    await ejecutarEnLotes(Array.from({ length: 23 }, (_, i) => () => op(i)), 10);

    expect(hechas.sort((a, b) => a - b)).toEqual(Array.from({ length: 23 }, (_, i) => i));
    expect(maximo).toBe(10);
  });
});
