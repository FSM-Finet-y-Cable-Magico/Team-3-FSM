// En ESM, Jest no inyecta los globals: hay que importarlos.
import { describe, expect, it } from '@jest/globals';
import { IntegracionesService } from './integraciones.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ApiScope } from '../common/guards/api-key.guard.js';

/**
 * El RUT que sale por `/api/integraciones/*` va en la grafia del contrato.
 *
 * G8 pidio por escrito que el webhook de cierre y el GET de reconciliacion
 * produzcan el mismo resultado. El webhook ya normalizaba; estos GET devolvian
 * el valor crudo de la columna, asi que el mismo cierre llegaba con dos
 * formatos segun por donde se consultara.
 *
 * Importa porque desde que el alta guarda canonico, el valor crudo depende de
 * cuando se dio de alta el cliente: "123456785" para los nuevos y "12345678-5"
 * para los anteriores.
 */
describe('el RUT que sale por la API de integraciones', () => {
  const scope: ApiScope = { grupo: 'G8', empresas: [1] };
  const CRUDO = '123456785';
  const CONTRATO = '12345678-5';

  const servicio = (prisma: unknown) =>
    new IntegracionesService(prisma as PrismaService, 'APROBACION');

  it('la reconciliacion de cierres lo normaliza', async () => {
    const fila = {
      id_ot: 46,
      fecha_completada: new Date('2026-09-14T17:23:01.068Z'),
      cliente: { rut: CRUDO, nombre_completo: 'Ana Soto' },
    };
    const svc = servicio({
      orden_trabajo: {
        findMany: () => Promise.resolve([fila]),
        count: () => Promise.resolve(1),
      },
    });
    const r = await svc.cierres(scope, {
      id_empresa: 1,
      desde: '2026-09-01',
      hasta: '2026-10-01',
    });
    expect(r.data[0].cliente?.rut).toBe(CONTRATO);
  });

  it('el listado de ordenes lo normaliza', async () => {
    const svc = servicio({
      orden_trabajo: {
        findMany: () =>
          Promise.resolve([
            { id_ot: 1, cliente: { rut: CRUDO, nombre_completo: 'Ana' } },
          ]),
        count: () => Promise.resolve(1),
      },
    });
    const r = await svc.ordenes(scope, { id_empresa: 1 });
    expect(r.data[0].cliente?.rut).toBe(CONTRATO);
  });

  it('la consulta de cliente por RUT lo normaliza', async () => {
    const svc = servicio({
      cliente: {
        findFirst: () =>
          Promise.resolve({
            id_cliente: 1,
            rut: CRUDO,
            nombre_completo: 'Ana',
          }),
      },
    });
    const c = await svc.clientePorRut(scope, 1, CRUDO);
    expect(c.rut).toBe(CONTRATO);
  });

  it('la busqueda de clientes lo normaliza', async () => {
    const svc = servicio({
      cliente: {
        findMany: () =>
          Promise.resolve([
            { id_cliente: 1, rut: CRUDO, nombre_completo: 'Ana' },
          ]),
      },
    });
    const r = await svc.buscarClientes(scope, 1, 'Ana');
    expect(r[0].rut).toBe(CONTRATO);
  });

  it('una fila sin cliente no rompe nada', async () => {
    const svc = servicio({
      orden_trabajo: {
        findMany: () => Promise.resolve([{ id_ot: 9, cliente: null }]),
        count: () => Promise.resolve(1),
      },
    });
    const r = await svc.cierres(scope, {
      id_empresa: 1,
      desde: '2026-09-01',
      hasta: '2026-10-01',
    });
    expect(r.data[0].cliente).toBeNull();
  });
});
