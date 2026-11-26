import { describe, expect, it, jest } from '@jest/globals';
import { AlertasService } from './alertas.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * `listar` con `resuelta=true` traia TODO el historial de alertas cerradas
 * (con cuatro relaciones) y recien en memoria cortaba a 200. La tabla no se
 * purga y el motor cierra alertas solas en cada corrida, asi que el costo de
 * "Ver resueltas" crecia sin techo. Las abiertas son pocas y se siguen
 * ordenando en memoria por severidad (ver el comentario de `listar`).
 */
const alerta = (id: number, severidad: string, creada: string) => ({
  id_alerta: id,
  severidad,
  creada_en: new Date(creada),
  registro: null,
});

function servicioCon(filas: ReturnType<typeof alerta>[]) {
  const findMany = jest.fn(async (_args: unknown) => filas);
  const prisma = { alerta_monitoreo: { findMany } } as unknown as PrismaService;
  return { service: new AlertasService(prisma), findMany };
}

const argumentos = (findMany: jest.Mock<(a: unknown) => unknown>) =>
  findMany.mock.calls[0][0] as { take?: number };

describe('listar alertas', () => {
  it('las resueltas se acotan en la base, no en memoria', async () => {
    const { service, findMany } = servicioCon([]);
    await service.listar(1, true, undefined, 200);
    expect(argumentos(findMany).take).toBe(200);
  });

  it('el tope de las resueltas respeta el maximo de 200 aunque pidan mas', async () => {
    const { service, findMany } = servicioCon([]);
    await service.listar(1, true, undefined, 5000);
    expect(argumentos(findMany).take).toBe(200);
  });

  it('un limit que no es numero no llega como NaN a la base', async () => {
    // El controlador hace `+limit`: "?limit=abc" llega como NaN, y Prisma
    // rechaza `take: NaN`.
    const { service, findMany } = servicioCon([]);
    await service.listar(1, true, undefined, Number('abc'));
    expect(argumentos(findMany).take).toBe(100);
  });

  it('las abiertas no se cortan en la base: una CRITICA vieja no puede quedar fuera', async () => {
    const { service, findMany } = servicioCon([]);
    await service.listar(1, false, undefined, 200);
    expect(argumentos(findMany).take).toBeUndefined();
  });

  it('las resueltas siguen ordenadas por severidad dentro de la ventana', async () => {
    const { service } = servicioCon([
      alerta(1, 'BAJA', '2026-11-20T10:00:00Z'),
      alerta(2, 'CRITICA', '2026-11-19T10:00:00Z'),
      alerta(3, 'MEDIA', '2026-11-21T10:00:00Z'),
    ]);
    const r = await service.listar(1, true, undefined, 200);
    expect(r.map((a) => a.id_alerta)).toEqual([2, 3, 1]);
  });
});
