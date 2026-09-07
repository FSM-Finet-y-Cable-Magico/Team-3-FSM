import { describe, expect, it } from '@jest/globals';
import { normalizarPaginacion } from './paginacion.util.js';

describe('paginación de clientes y OT', () => {
  it.each([
    [undefined, undefined, 1, 20], ['2', '100000', 2, 100],
    ['abc', 'abc', 1, 20], [Infinity, Infinity, 1, 20],
    ['Infinity', '-Infinity', 1, 20], [NaN, NaN, 1, 20],
    [0, 0, 1, 20], [-3, -5, 1, 1], [2.9, 20.9, 2, 20],
    [Number.MAX_SAFE_INTEGER, 100, 1, 100], ['1e300', 20, 1, 20],
    [['2', '3'], {}, 1, 20],
  ])('normaliza %p / %p sin enviar offsets inválidos', (page, limit, expectedPage, expectedLimit) => {
    expect(normalizarPaginacion(page, limit)).toEqual({
      page: expectedPage, limit: expectedLimit, skip: (expectedPage - 1) * expectedLimit,
    });
  });
});
