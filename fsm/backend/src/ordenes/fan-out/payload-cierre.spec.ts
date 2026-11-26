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
      { id_tipo_equipo: 7, cantidad: { toString: () => '2' }, tipo_equipo: { nombre: 'Cable drop 1 fibra' } },
      { id_tipo_equipo: null, cantidad: { toString: () => '1' }, tipo_equipo: null },
    ],
    tecnico: { nombre_usuario: 'mrojas' },
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
      usuario_tecnico: 'mrojas',
      cliente: null,
      direccion: { direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' },
      categoria_falla: null,
      categoria_falla_otro: null,
      materiales: [{ id_tipo_equipo: 7, nombre: 'Cable drop 1 fibra', cantidad: 2 }],
      equipos_instalados: [
        { numero_serie: 'ONT-123', accion: 'INSTALADO_EN_CLIENTE', estado_g1: 'Instalado en cliente' },
      ],
      equipos_retirados: [],
      // Siempre presente, vacia si no falto nada: una lista ausente y una vacia
      // significan lo mismo y G1 no tiene por que tratar dos casos.
      equipos_faltantes: [],
      falla_reportada: null,
      solucion_aplicada: null,
      resultado: null,
      request_id: null,
      trace_id: null,
      id_prospecto: null,
      id_contrato: null,
      id_plan: null,
      // Correlacion de una BAJA por morosidad: null en todo lo demas, igual que
      // los de instalacion, porque este payload tambien lo recibe G1.
      id_cliente_externo: null,
      id_servicio: null,
      id_solicitud_retiro: null,
      id_ticket_externo: null,
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
          direccion_completa: 'Los Alerces 455',
          comuna: 'Quilpué',
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

  it('la OT de G8 informa la direccion aunque no tenga fila propia', () => {
    // Desde que no escribimos `direccion_servicio` --tabla del CRM, sin
    // permiso en la base compartida-- la direccion sale de la solicitud.
    // Si esto se rompe, G1 recibe un cierre sin direccion y no se nota hasta
    // que reclaman.
    const p = construirPayloadCierre(
      fila({
        direccion: null,
        solicitud_integracion: {
          request_id: 'r', trace_id: 't',
          id_prospecto_externo: 1, id_contrato_externo: 2, id_plan_externo: null,
          direccion_completa: 'Los Alerces 455', comuna: 'Quilpué',
        },
      } as never),
    );
    expect(p.direccion).toEqual({ direccion_completa: 'Los Alerces 455', comuna: 'Quilpué' });
  });

  it('si la OT tiene direccion propia, la solicitud no la pisa', () => {
    const p = construirPayloadCierre(
      fila({
        direccion: { direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' },
        solicitud_integracion: {
          request_id: 'r', trace_id: 't',
          id_prospecto_externo: 1, id_contrato_externo: 2, id_plan_externo: null,
          direccion_completa: 'OTRA 999', comuna: 'Otra',
        },
      } as never),
    );
    expect(p.direccion).toEqual({ direccion_completa: 'Av. Ejemplo 1234', comuna: 'La Pintana' });
  });

  describe('datos de reparacion que pide G1', () => {
    it('viajan los tres cuando la OT es una reparacion', () => {
      const p = construirPayloadCierre(
        fila({
          tipo_ot: 'REPARACION',
          cierre_equipos: {
            reparacion: {
              falla_reportada: 'Fibra cortada en el poste',
              solucion_aplicada: 'Se empalmo la fibra',
              resultado: 'PARCIAL',
            },
          },
        } as never),
      );
      expect(p).toMatchObject({
        falla_reportada: 'Fibra cortada en el poste',
        solucion_aplicada: 'Se empalmo la fibra',
        resultado: 'PARCIAL',
      });
    });

    it('conviven con los equipos en la misma columna', () => {
      // Las dos secciones comparten `cierre_equipos`. Si una pisa a la otra,
      // G1 recibe el cierre a medias y no se nota hasta que reclaman.
      const p = construirPayloadCierre(
        fila({
          tipo_ot: 'REPARACION',
          cierre_equipos: {
            retirados: [{ numero_serie: 'ONT-9', accion: 'RETIRADO_PARA_DIAGNOSTICO', estado_g1: 'En revisión' }],
            reparacion: { falla_reportada: 'ONT quemada', solucion_aplicada: 'Se reemplazo', resultado: 'RESUELTO' },
          },
        } as never),
      );
      expect(p.equipos_retirados).toHaveLength(1);
      expect(p.falla_reportada).toBe('ONT quemada');
    });

    it('van en null en una OT sin seccion de reparacion', () => {
      // Parte del contrato: el mismo payload lo recibe G8, que no los usa.
      const p = construirPayloadCierre(fila({ cierre_equipos: null } as never));
      expect(p.falla_reportada).toBeNull();
      expect(p.solucion_aplicada).toBeNull();
      expect(p.resultado).toBeNull();
    });
  });

  it('con el cliente, lo informa con rut y nombre', () => {
    const p = construirPayloadCierre(fila({ cliente: { rut: '11111111-1', nombre_completo: 'Ana Soto' } } as never));
    expect(p.cliente).toEqual({ rut: '11111111-1', nombre: 'Ana Soto' });
  });

  it('sin tecnico asignado, la clave natural va en null y no rompe', () => {
    // No deberia pasar --sin tecnico no se puede cerrar-- pero la columna es
    // nullable y el payload no es lugar para caerse.
    const p = construirPayloadCierre(fila({ tecnico: null, id_tecnico: null } as never));
    expect(p.usuario_tecnico).toBeNull();
    expect(p.id_tecnico).toBeNull();
  });

  it('si el tipo de equipo quedo huerfano, el nombre va vacio y la fila igual viaja', () => {
    // Una fila de uso que apunta a un tipo borrado. Se informa la cantidad
    // igual: perder el consumo es peor que informarlo sin nombre.
    const p = construirPayloadCierre(
      fila({
        materiales: [{ id_tipo_equipo: 7, cantidad: { toString: () => '3' }, tipo_equipo: null }],
      } as never),
    );
    expect(p.materiales).toEqual([{ id_tipo_equipo: 7, nombre: '', cantidad: 3 }]);
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
