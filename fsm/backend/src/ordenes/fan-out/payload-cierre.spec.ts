import { describe, expect, it } from '@jest/globals';
import { construirPayloadCierre, type OtParaPayload } from './payload-cierre.js';

/**
 * El payload del cierre sale de UN solo lugar. Lo consumen el webhook
 * (`OrdenesService`) y el GET de reconciliacion (`IntegracionesService`), y el
 * acuerdo con G1 y G8 exige que sean identicos (caso 5 de las pruebas de
 * aceptacion). Armarlo a mano en los dos lados es como se desincronizan.
 */
const fila = (extra: Partial<OtParaPayload> = {}): OtParaPayload =>
  ({
    id_ot: 781,
    id_empresa: 1,
    tipo_ot: 'INSTALACION',
    id_tecnico: 14,
    fecha_completada: new Date('2026-10-01T20:15:00.000Z'),
    fecha_creacion: new Date('2026-09-29T18:00:00.000Z'),
    potencia_optica_dbm: { toString: () => '-21.5' },
    resuelto_remotamente: false,
    categoria_falla_otro: null,
    cierre_equipos: {
      instalados: [{ numero_serie: 'ONT-123', accion: 'INSTALADO_EN_CLIENTE', estado_g1: 'Instalado en cliente' }],
    },
    cliente: null,
    direccion: { direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' },
    categoria_falla: null,
    materiales: [
      { id_tipo_equipo: 7, cantidad: { toString: () => '2' } },
      { id_tipo_equipo: null, cantidad: { toString: () => '1' } },
    ],
    llamada: { resultado: 'CONFORME' },
    solicitud_integracion: null,
    ...extra,
  }) as unknown as OtParaPayload;

describe('construirPayloadCierre', () => {
  it('arma el cierre desde la fila guardada', () => {
    expect(construirPayloadCierre(fila())).toEqual({
      clave_idempotencia: '781:2026-10-01T20:15:00.000Z',
      id_ot: 781,
      id_empresa: 1,
      tipo_ot: 'INSTALACION',
      fecha_completada: '2026-10-01T20:15:00.000Z',
      resultado_llamada: 'CONFORME',
      potencia_optica_dbm: -21.5,
      resuelto_remotamente: false,
      id_tecnico: 14,
      cliente: null,
      direccion: { direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' },
      categoria_falla: null,
      categoria_falla_otro: null,
      materiales: [{ id_tipo_equipo: 7, cantidad: 2 }],
      equipos_instalados: [
        { numero_serie: 'ONT-123', accion: 'INSTALADO_EN_CLIENTE', estado_g1: 'Instalado en cliente' },
      ],
      equipos_retirados: [],
      request_id: null,
      trace_id: null,
      id_prospecto: null,
      id_contrato: null,
      id_plan: null,
    });
  });

  it('una OT pedida por G8 lleva su correlacion (P0-c)', () => {
    const p = construirPayloadCierre(
      fila({
        solicitud_integracion: {
          request_id: '550e8400-e29b-41d4-a716-446655440000',
          trace_id: '6f1d7d17-3f7d-4db8-93a8-87e8d7ce0031',
          id_prospecto_externo: 45,
          id_contrato_externo: 92,
          id_plan_externo: 15,
        },
      }),
    );

    expect(p).toMatchObject({
      request_id: '550e8400-e29b-41d4-a716-446655440000',
      trace_id: '6f1d7d17-3f7d-4db8-93a8-87e8d7ce0031',
      id_prospecto: 45,
      id_contrato: 92,
      id_plan: 15,
    });
  });

  it('con el cliente, lo informa con rut y nombre', () => {
    const p = construirPayloadCierre(fila({ cliente: { rut: '11111111-1', nombre_completo: 'Ana Soto' } } as never));
    expect(p.cliente).toEqual({ rut: '11111111-1', nombre: 'Ana Soto' });
  });
});

describe('el RUT que sale hacia G1 y G8', () => {
  // El §3 del acuerdo con G8 fija `12345678-5`. Desde que el alta guarda
  // canonico (#110), tomar el valor crudo de la columna mandaria "123456785"
  // para los clientes nuevos y "12345678-5" para los viejos: dos formatos por
  // el mismo canal, decididos por la fecha de alta del cliente.
  it('viaja con guion aunque la base lo guarde sin guion', () => {
    const ot = fila({ cliente: { rut: '123456785', nombre_completo: 'Ana Soto' } } as never);
    const p = construirPayloadCierre(ot);
    expect(p.cliente?.rut).toBe('12345678-5');
    expect(p.cliente?.rut).toMatch(/^\d{7,8}-[\dK]$/);
  });

  it('tambien normaliza las filas antiguas, que ya traian guion', () => {
    const ot = fila({ cliente: { rut: '12.345.678-5', nombre_completo: 'Ana Soto' } } as never);
    expect(construirPayloadCierre(ot).cliente?.rut).toBe('12345678-5');
  });
});
