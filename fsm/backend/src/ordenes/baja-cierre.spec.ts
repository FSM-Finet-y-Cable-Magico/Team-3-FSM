import { describe, expect, it } from '@jest/globals';
import { TIPO_OT_BAJA, momentoPara, estadosAvisados } from './fan-out/momento-fan-out.js';
import { cierreGuardado, construirPayloadCierre, type OtParaPayload } from './fan-out/payload-cierre.js';

/**
 * Las tres reglas nuevas del retiro por morosidad (acuerdo del 12-11-2026):
 * cuando se avisa, con que clave, y los dos campos que pidio G1.
 */

describe('momento del aviso por tipo de OT', () => {
  it('una BAJA avisa al aprobar aunque la variable diga CIERRE', () => {
    // Es el punto completo del cambio: avisar antes de la aprobacion significa
    // cortarle el internet a alguien por un cierre que todavia puede rechazarse.
    expect(momentoPara(TIPO_OT_BAJA, 'CIERRE')).toBe('APROBACION');
    expect(momentoPara(TIPO_OT_BAJA, 'APROBACION')).toBe('APROBACION');
  });

  it('los otros tipos siguen obedeciendo la variable', () => {
    // No se toca: el aviso al cierre es lo que G1 y G8 ya tienen en produccion
    // para instalaciones y reparaciones, y moverlo es un cambio coordinado.
    expect(momentoPara('INSTALACION', 'CIERRE')).toBe('CIERRE');
    expect(momentoPara('REPARACION', 'CIERRE')).toBe('CIERRE');
    expect(momentoPara('INSTALACION', 'APROBACION')).toBe('APROBACION');
  });

  it('una BAJA que espera aprobacion no cuenta como avisada', () => {
    // Lo usa el GET de reconciliacion: devolverla ahi le diria a G8 que el
    // retiro esta cerrado cuando el jefe tecnico todavia puede rechazarlo.
    expect(estadosAvisados(momentoPara(TIPO_OT_BAJA, 'CIERRE'))).toEqual(['COMPLETADA']);
    expect(estadosAvisados('CIERRE')).toContain('PENDIENTE_APROBACION');
  });
});

/** OT minima para el constructor del payload. */
const otBase = (over: Partial<OtParaPayload> = {}): OtParaPayload =>
  ({
    id_ot: 900,
    id_empresa: 1,
    tipo_ot: TIPO_OT_BAJA,
    estado: 'COMPLETADA',
    fecha_creacion: new Date('2026-11-12T10:00:00Z'),
    fecha_completada: new Date('2026-11-12T12:00:00Z'),
    potencia_optica_dbm: null,
    resuelto_remotamente: false,
    id_tecnico: 5,
    categoria_falla_otro: null,
    cierre_equipos: null,
    cliente: null,
    direccion: { direccion_completa: 'Av. Matta 123', comuna: 'Ñuñoa' },
    categoria_falla: null,
    materiales: [],
    tecnico: { nombre_usuario: 'tecnico.prueba1' },
    llamada: null,
    solicitud_integracion: null,
    solicitud_baja: null,
    ...over,
  }) as unknown as OtParaPayload;

const SOLICITUD_BAJA = {
  request_id: 'g8-retiro-1-123',
  trace_id: '550e8400-e29b-41d4-a716-446655440000',
  id_cliente_externo: 70,
  id_contrato_externo: 80,
  id_servicio_externo: 90001,
  id_solicitud_retiro_externa: 123,
  id_ticket_externo: 44,
};

describe('aviso de cierre de una BAJA', () => {
  it('lleva el request_id de G8 en la raiz, que es lo que G1 reenvia', () => {
    // Sin esto el request_id viajaba en null: G1 guardaba la recepcion sin clave
    // y G8 no podia encontrar su propia solicitud. No fallaba, devolvia vacio.
    const p = construirPayloadCierre(otBase({ solicitud_baja: SOLICITUD_BAJA } as never));

    expect(p.request_id).toBe('g8-retiro-1-123');
    expect(p.trace_id).toBe(SOLICITUD_BAJA.trace_id);
    expect(p.id_servicio).toBe(90001);
    expect(p.id_solicitud_retiro).toBe(123);
    expect(p.id_ticket_externo).toBe(44);
    expect(p.id_contrato).toBe(80);
  });

  it('usa una clave de idempotencia sin fecha', () => {
    // Se puede porque hay UN solo aviso por OT. Resuelve el choque que levanto
    // G8: `fecha_completada` se conserva tras un rechazo a proposito.
    const p = construirPayloadCierre(otBase({ solicitud_baja: SOLICITUD_BAJA } as never));
    expect(p.clave_idempotencia).toBe('baja:900');
  });

  it('los otros tipos de OT conservan la clave con fecha', () => {
    const p = construirPayloadCierre(otBase({ tipo_ot: 'REPARACION' }));
    expect(p.clave_idempotencia).toBe('900:2026-11-12T12:00:00.000Z');
  });

  it('una OT propia de G3 no inventa correlacion', () => {
    const p = construirPayloadCierre(otBase());
    expect(p.request_id).toBeNull();
    expect(p.id_servicio).toBeNull();
    expect(p.id_solicitud_retiro).toBeNull();
  });
});

describe('equipos faltantes y daño (pedido de G1 del 12-11-2026)', () => {
  it('los faltantes se guardan aunque no se haya movido ningun equipo', () => {
    // Es el caso real de una baja donde el cliente no entrego nada. Antes de
    // tener su propio `if`, una lista sin equipos movidos se perdia entera.
    const guardado = cierreGuardado([], [], null, [{ numero_serie: 'PRUEBA-ONT-F-0007', motivo: 'El cliente no abrio' }]);
    expect(guardado).toMatchObject({ faltantes: [{ numero_serie: 'PRUEBA-ONT-F-0007' }] });
  });

  it('sin faltantes la columna no se ensucia', () => {
    expect(cierreGuardado([], [], null, [])).not.toMatchObject({ faltantes: expect.anything() });
  });

  it('el payload siempre trae la lista, vacia si no falto nada', () => {
    // Una lista ausente y una vacia significan lo mismo; obligar a G1 y G8 a
    // tratar los dos casos no aporta nada.
    expect(construirPayloadCierre(otBase()).equipos_faltantes).toEqual([]);
  });

  it('el payload traslada los faltantes con su motivo', () => {
    const ot = otBase({
      cierre_equipos: { faltantes: [{ numero_serie: 'PRUEBA-RTR-F-0002', motivo: 'Dice haberlo devuelto antes' }] },
    } as never);
    expect(construirPayloadCierre(ot).equipos_faltantes).toEqual([
      { numero_serie: 'PRUEBA-RTR-F-0002', motivo: 'Dice haberlo devuelto antes' },
    ]);
  });

  it('con_dano viaja en el equipo retirado', () => {
    // Es el campo con el que G1 ramifica entre RECIBIDO y RECIBIDO_CON_DANO.
    // `observacion_estado_fisico` no sirve para eso: es texto libre.
    const ot = otBase({
      cierre_equipos: {
        instalados: [],
        retirados: [
          {
            numero_serie: 'PRUEBA-ONT-F-0007',
            accion: 'RETIRADO_PARA_DIAGNOSTICO',
            estado_g1: 'En revisión',
            con_dano: true,
            observacion_estado_fisico: 'Carcasa quebrada',
          },
        ],
      },
    } as never);
    expect(construirPayloadCierre(ot).equipos_retirados[0]).toMatchObject({
      con_dano: true,
      observacion_estado_fisico: 'Carcasa quebrada',
    });
  });
});
