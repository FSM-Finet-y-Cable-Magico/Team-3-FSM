import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { completarSolicitudBaja, INCLUDE_PAYLOAD_CIERRE } from './payload-cierre.js';
import { IntegracionesService } from '../../integraciones/integraciones.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MOMENTO_FAN_OUT } from './momento-fan-out.js';

/**
 * En la base global (`finet_global_validacion`) la tabla
 * `solicitud_baja_integracion` todavia no existe: la tiene que crear el admin.
 * Antes, el `include` del payload la juntaba en CADA cierre, asi que el aviso a
 * G1/G8 y la reconciliacion fallaban para TODAS las OT, no solo para los retiros.
 * Ahora se lee aparte, solo para las OT de BAJA, y su falta no rompe nada.
 */
const SOLICITUD = {
  request_id: 'g8-retiro-1-123',
  trace_id: '550e8400-e29b-41d4-a716-446655440000',
  id_cliente_externo: 70,
  id_contrato_externo: 80,
  id_servicio_externo: 90001,
  id_solicitud_retiro_externa: 123,
  id_ticket_externo: 44,
};
const tablaInexistente = () => {
  throw new Error('The table `public.solicitud_baja_integracion` does not exist in the current database.');
};

describe('completarSolicitudBaja', () => {
  it('el include comun ya no junta la tabla de retiros', () => {
    expect(INCLUDE_PAYLOAD_CIERRE).not.toHaveProperty('solicitud_baja');
  });

  it('una OT que no es de retiro no consulta la tabla', async () => {
    const findUnique = jest.fn(async () => SOLICITUD);
    const ot = await completarSolicitudBaja({ solicitud_baja_integracion: { findUnique } } as any, { id_ot: 1, tipo_ot: 'REPARACION' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(ot.solicitud_baja).toBeNull();
  });

  it('una OT de retiro trae su solicitud', async () => {
    const findUnique = jest.fn(async (_a?: any) => SOLICITUD);
    const ot = await completarSolicitudBaja({ solicitud_baja_integracion: { findUnique } } as any, { id_ot: 9, tipo_ot: 'BAJA' });
    expect(findUnique.mock.calls[0][0]).toMatchObject({ where: { id_ot: 9 } });
    expect(ot.solicitud_baja).toEqual(SOLICITUD);
  });

  it('si la tabla no existe, la OT de retiro sigue sin solicitud y avisa en el log', async () => {
    const warn = jest.fn();
    const ot = await completarSolicitudBaja(
      { solicitud_baja_integracion: { findUnique: jest.fn(tablaInexistente) } } as any,
      { id_ot: 9, tipo_ot: 'BAJA' },
      { warn },
    );
    expect(ot.solicitud_baja).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('reconciliacion sin la tabla de retiros', () => {
  it('el GET de cierre responde para una OT normal aunque la tabla no exista', async () => {
    const OT = {
      id_ot: 41, id_empresa: 1, tipo_ot: 'REPARACION', estado: 'COMPLETADA', id_tecnico: 35,
      fecha_completada: new Date('2026-09-28T12:00:00.000Z'), fecha_creacion: new Date('2026-09-27T09:00:00.000Z'),
      potencia_optica_dbm: null, resuelto_remotamente: false, categoria_falla_otro: null, cierre_equipos: null,
      cliente: { rut: '11111111-1', nombre_completo: 'Ana Soto' },
      direccion: { direccion_completa: 'Av. Ejemplo 123', comuna: 'La Pintana' },
      categoria_falla: null, materiales: [], tecnico: { nombre_usuario: 'jperez' }, llamada: null,
      solicitud_integracion: null,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegracionesService,
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
        {
          provide: PrismaService,
          useValue: {
            orden_trabajo: { findFirst: jest.fn(async () => OT) },
            solicitud_baja_integracion: { findUnique: jest.fn(tablaInexistente) },
          },
        },
      ],
    }).compile();

    const payload = await moduleRef.get(IntegracionesService).cierre({ grupo: 'G8', empresas: [1] } as any, 41, 1);

    expect(payload).toMatchObject({ id_ot: 41, request_id: null });
  });
});
