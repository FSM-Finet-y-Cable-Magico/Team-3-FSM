import { describe, expect, it, jest } from '@jest/globals';
import { AlertasService } from './alertas.service.js';
import { esInactiva, evaluar, type EstadoOnt } from './reglas-alerta.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const AHORA = new Date('2026-11-13T15:00:00Z');
const ont = (id: number, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
  id_registro_ont: id, numero_serie: `SN-${id}`, id_cliente: id, id_caja_nap: null,
  olt_externo: '2', board: 1, puerto_pon: 7, caja_normalizada: 'NAP 5',
  estado_conexion: 'OFFLINE', potencia_dbm: null, sin_senal_desde: new Date('2026-11-13T12:00:00Z'), ...extra,
});

describe('cliente suspendido por deuda', () => {
  it('cuenta como inactiva aunque este en linea', () => {
    expect(esInactiva({ estado_conexion: 'ONLINE', sin_senal_desde: null, suspendido: true }, AHORA)).toBe(true);
  });

  it('su ONT caida no genera SIN_SENAL', () => {
    const propuestas = evaluar([ont(1, { suspendido: true })], AHORA, 30);
    expect(propuestas.filter((p) => p.tipo === 'SIN_SENAL')).toHaveLength(0);
    // Control: la misma ONT sin suspender si alerta.
    expect(evaluar([ont(1)], AHORA, 30).filter((p) => p.tipo === 'SIN_SENAL')).toHaveLength(1);
  });

  it('cargarEstado marca las ONT de clientes suspendidos', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ ...ont(1), potencia_dbm: null }, { ...ont(2), potencia_dbm: null }]),
      contrato: { findMany: jest.fn(async () => [{ id_cliente: 1, estado: 'Suspendido' }]) },
    } as unknown as PrismaService;
    const r = await new AlertasService(prisma).cargarEstado(1);
    expect(r.map((o) => [o.id_cliente, o.suspendido])).toEqual([[1, true], [2, false]]);
  });

  it('si no puede leer contrato, cargarEstado sigue funcionando sin marcar a nadie', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ ...ont(1), potencia_dbm: null }]),
      contrato: { findMany: jest.fn(async () => { throw Object.assign(new Error('permission denied'), { code: '42501' }); }) },
    } as unknown as PrismaService;
    const r = await new AlertasService(prisma).cargarEstado(1);
    expect(r).toHaveLength(1);
    expect(r[0].suspendido).toBe(false);
  });
});
