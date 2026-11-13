import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SaludCajasService } from './salud-cajas.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from '../monitoreo/alertas.service.js';
import type { EstadoOnt } from '../monitoreo/reglas-alerta.js';

const ont = (id_caja_nap: number, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
  id_registro_ont: 1,
  numero_serie: 'SN-1',
  id_cliente: null,
  id_caja_nap,
  olt_externo: '2',
  board: 1,
  puerto_pon: 7,
  caja_normalizada: 'NAP 5',
  estado_conexion: 'ONLINE',
  potencia_dbm: -21,
  sin_senal_desde: null,
  odb: 'NAP05',
  odb_puerto: 3,
  ...extra,
});

describe('SaludCajasService', () => {
  const cajaFindMany = jest.fn(async (_a?: any) => [] as any[]);
  const alertaFindMany = jest.fn(async (_a?: any) => [] as any[]);
  const otFindMany = jest.fn(async (_a?: any) => [] as any[]);
  const cargarEstado = jest.fn(async (_id: number) => [] as EstadoOnt[]);
  let service: SaludCajasService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        SaludCajasService,
        {
          provide: PrismaService,
          useValue: {
            caja_nap: { findMany: cajaFindMany },
            alerta_monitoreo: { findMany: alertaFindMany },
            orden_trabajo: { findMany: otFindMany },
          },
        },
        { provide: AlertasService, useValue: { cargarEstado } },
      ],
    }).compile();
    service = mod.get(SaludCajasService);
  });

  it('lee cajas, alertas, OT y ONT solo de la empresa pedida', async () => {
    await service.listar(1);

    // Las cajas sin empresa se ven igual que en el resto de la topologia: el
    // KML de Tomodat las importa sin dueño.
    expect(cajaFindMany.mock.calls[0][0].where).toEqual({ OR: [{ id_empresa: 1 }, { id_empresa: null }] });
    expect(alertaFindMany.mock.calls[0][0].where).toMatchObject({ id_empresa: 1, resuelta: false });
    expect(otFindMany.mock.calls[0][0].where).toMatchObject({
      id_empresa: 1,
      estado: { notIn: ['COMPLETADA', 'CANCELADA'] },
    });
    expect(cargarEstado).toHaveBeenCalledWith(1);
  });

  it('responde 404 por una caja que no es de la empresa', async () => {
    cajaFindMany.mockImplementation(async () => [
      { id_caja_nap: 7, identificador_unico: 'NAP 7', zona: null, numero_poste: null, latitud: null, longitud: null },
    ]);
    await expect(service.detalle(99, 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el detalle trae sus ONT, la clave SmartOLT mas usada y las cajas cercanas', async () => {
    cajaFindMany.mockImplementation(async () => [
      { id_caja_nap: 1, identificador_unico: 'NAP 5', zona: 'Z', numero_poste: null, latitud: -33.5, longitud: -71.6, mufa: null },
      { id_caja_nap: 2, identificador_unico: 'NAP 6', zona: 'Z', numero_poste: null, latitud: -33.501, longitud: -71.6, mufa: null },
      { id_caja_nap: 3, identificador_unico: 'NAP 9', zona: 'Z', numero_poste: null, latitud: -33.6, longitud: -71.6, mufa: null },
    ]);
    cargarEstado.mockImplementation(async () => [
      ont(1, { numero_serie: 'A' }),
      ont(1, { numero_serie: 'B' }),
      ont(1, { numero_serie: 'C', board: 2, caja_normalizada: 'NAP 5' }),
      ont(2, { numero_serie: 'D' }),
    ]);

    const d = await service.detalle(1, 1);

    expect(d.caja).toMatchObject({ id_caja_nap: 1, estado: 'OK', onts: { total: 3 } });
    expect(d.onts.map((o) => o.numero_serie)).toEqual(['A', 'B', 'C']);
    expect(d.onts[0]).toMatchObject({ odb: 'NAP05', odb_puerto: 3, posible_baja: false });
    expect(d.claves_smartolt).toEqual(['2/1/7|NAP 5', '2/2/7|NAP 5']);
    expect(d.cercanas.map((c) => c.id_caja_nap)).toEqual([2, 3]);
    expect(d.cercanas[0].distancia_m).toBeLessThan(200);
  });

  it('el detalle marca la ONT de un cliente suspendido, y no como posible baja', async () => {
    cajaFindMany.mockImplementation(async () => [
      { id_caja_nap: 1, identificador_unico: 'NAP 5', zona: 'Z', numero_poste: null, latitud: -33.5, longitud: -71.6, mufa: null },
    ]);
    cargarEstado.mockImplementation(async () => [ont(1, { numero_serie: 'S', estado_conexion: 'OFFLINE', suspendido: true })]);

    const d = await service.detalle(1, 1);

    expect(d.onts[0]).toMatchObject({ numero_serie: 'S', suspendido: true, posible_baja: false });
  });
});
