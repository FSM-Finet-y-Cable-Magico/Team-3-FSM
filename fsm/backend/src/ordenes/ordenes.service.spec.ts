import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OrdenesService } from './ordenes.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CloudinaryService } from '../cloudinary/cloudinary.service.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';

// Verifica que llamar al servicio desde otro consumidor tampoco amplíe los roles.
// El doble solo devuelve la fila; no implementa la regla de autorización.
describe('autorización de OT desde el servicio', () => {
  const findFirst = jest.fn(async () => ({ id_ot: 1, id_empresa: 1, id_tecnico: 7, estado: 'EN_CURSO' }));
  const subirEvidencia = jest.fn();
  let service: OrdenesService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({ providers: [
      OrdenesService, { provide: PrismaService, useValue: { orden_trabajo: { findFirst } } },
      { provide: CloudinaryService, useValue: { subirEvidencia } },
      { provide: DashboardGateway, useValue: {} },
    ] }).compile();
    service = moduleRef.get(OrdenesService);
  });
  it.each(['ADMIN', 'JEFE_TECNICO', 'DESCONOCIDO'])('no permite subir/cerrar a %s aunque coincida el usuario asignado', async rol => {
    const user = { userId: 7, id_empresa: 1, rol };
    await expect(service.subirFoto(1, undefined, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.cerrarOT(1, { fotos: [], materiales: [], potencia_optica_dbm: -21, resultado_llamada: 'CONFORME' }, user))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(subirEvidencia).not.toHaveBeenCalled();
  });
});
