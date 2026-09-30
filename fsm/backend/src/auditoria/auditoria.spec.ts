import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditoriaService } from './auditoria.service.js';
import { AuditoriaController } from './auditoria.controller.js';

/**
 * CU-41: consulta del log de auditoria. `log_auditoria` se escribe en todo el
 * sistema y no tenia ningun endpoint de lectura.
 *
 * Dos trampas que el plan pidio decidir al escribirlo:
 *  - `id_log` es BigInt y JSON.stringify no lo sabe serializar: se entrega
 *    como string.
 *  - la tabla no tiene `id_empresa`: el aislamiento sale del usuario que
 *    actuo. Las filas sin usuario (integraciones, poller) no se pueden
 *    atribuir a una empresa sin revisar cada entidad, asi que NO se muestran.
 */
describe('CU-41: log de auditoria', () => {
  const fila = {
    id_log: 123456789012345678n,
    id_usuario: 3,
    accion: 'RECLASIFICAR_TICKET',
    entidad_afectada: 'ticket',
    id_entidad_afectada: 7,
    valor_anterior: { id_categoria: 1 },
    valor_nuevo: { id_categoria: 2 },
    ip_origen: null,
    fecha_hora: new Date('2026-09-29T15:00:00.000Z'),
    usuario: { nombre_completo: 'Jefe Técnico', nombre_usuario: 'jefe.tecnico' },
  };
  const findMany = jest.fn(async (_a: any): Promise<any[]> => [fila]);
  const count = jest.fn(async (_a: any) => 1);
  const groupBy = jest.fn(async (_a: any): Promise<any[]> => [{ accion: 'CREAR_OT' }, { accion: 'RECLASIFICAR_TICKET' }]);
  let service: AuditoriaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [AuditoriaService, { provide: PrismaService, useValue: { log_auditoria: { findMany, count, groupBy } } }],
    }).compile();
    service = mod.get(AuditoriaService);
  });

  it('solo muestra lo que hicieron usuarios de la empresa, del mas reciente al mas antiguo', async () => {
    const r = await service.buscar(1, {});

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { usuario: { id_empresa: 1 } },
      orderBy: [{ fecha_hora: 'desc' }, { id_log: 'desc' }],
      skip: 0,
      take: 50,
    });
    expect(r).toMatchObject({ total: 1, page: 1, limit: 50 });
  });

  it('entrega el id como string, que JSON si sabe serializar', async () => {
    const r = await service.buscar(1, {});
    expect(r.data[0].id_log).toBe('123456789012345678');
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r.data[0]).toMatchObject({
      usuario: 'Jefe Técnico',
      accion: 'RECLASIFICAR_TICKET',
      entidad_afectada: 'ticket',
      valor_anterior: { id_categoria: 1 },
      valor_nuevo: { id_categoria: 2 },
    });
  });

  it('filtra por usuario, entidad, accion y rango de dias en hora de Chile', async () => {
    await service.buscar(1, { id_usuario: '3', entidad: 'ticket', accion: 'RECLASIFICAR_TICKET', desde: '2026-09-29', hasta: '2026-09-29' });
    expect(findMany.mock.calls[0][0].where).toEqual({
      usuario: { id_empresa: 1 },
      id_usuario: 3,
      entidad_afectada: 'ticket',
      accion: 'RECLASIFICAR_TICKET',
      fecha_hora: { gte: new Date('2026-09-29T03:00:00.000Z'), lt: new Date('2026-09-30T03:00:00.000Z') },
    });
  });

  it.each([
    ['CREACION', { accion: { startsWith: 'CREAR' } }],
    ['ELIMINACION', { OR: [{ accion: { startsWith: 'DESACTIVAR' } }, { accion: { startsWith: 'ELIMINAR' } }] }],
    ['MODIFICACION', { NOT: [{ accion: { startsWith: 'CREAR' } }, { accion: { startsWith: 'DESACTIVAR' } }, { accion: { startsWith: 'ELIMINAR' } }] }],
  ])('el tipo %s se traduce a las acciones que lo son', async (tipo, esperado) => {
    await service.buscar(1, { tipo });
    expect(findMany.mock.calls[0][0].where).toMatchObject(esperado);
  });

  it('rechaza fechas mal escritas y un tipo desconocido', async () => {
    await expect(service.buscar(1, { desde: '29-09-2026' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.buscar(1, { tipo: 'OTRA' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lista las acciones que existen, para el filtro', async () => {
    await expect(service.acciones(1)).resolves.toEqual(['CREAR_OT', 'RECLASIFICAR_TICKET']);
    expect(groupBy.mock.calls[0][0]).toMatchObject({ by: ['accion'], where: { usuario: { id_empresa: 1 } } });
  });

  it('exporta a Excel todo lo filtrado, con los valores legibles', async () => {
    const archivo = await service.exportar(1, { entidad: 'ticket' });
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { entidad_afectada: 'ticket' }, take: 10000 });
    expect(archivo.nombre).toMatch(/^Auditoria_FSM_\d{4}-\d{2}-\d{2}\.xlsx$/);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(archivo.contenido as any);
    const hoja = libro.worksheets[0];
    expect(hoja.getRow(1).values).toEqual([undefined, 'Fecha y hora', 'Usuario', 'Acción', 'Entidad', 'Id', 'Valor anterior', 'Valor nuevo']);
    expect(hoja.getRow(2).getCell(3).value).toBe('RECLASIFICAR_TICKET');
    expect(hoja.getRow(2).getCell(6).value).toBe('{"id_categoria":1}');
  });

  it('es solo del ADMIN', () => {
    for (const m of ['buscar', 'acciones', 'exportar'] as const) {
      expect(Reflect.getMetadata('roles', AuditoriaController.prototype[m])).toEqual(['ADMIN']);
    }
  });
});
