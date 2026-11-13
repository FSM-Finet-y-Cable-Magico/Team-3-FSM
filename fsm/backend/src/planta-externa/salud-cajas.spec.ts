import { describe, expect, it } from '@jest/globals';
import type { EstadoOnt } from '../monitoreo/reglas-alerta.js';
import { armarSaludCajas, clasificarCaja, resumirOnts } from './salud-cajas.js';

const AHORA = new Date('2026-11-13T12:00:00Z');
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

const ont = (id_caja_nap: number | null, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
  id_registro_ont: 1,
  numero_serie: 'SN',
  id_cliente: null,
  id_caja_nap,
  olt_externo: '2',
  board: 1,
  puerto_pon: 7,
  caja_normalizada: 'NAP 5',
  estado_conexion: 'ONLINE',
  potencia_dbm: -21,
  sin_senal_desde: null,
  ...extra,
});
const caida = (id: number | null) => ont(id, { estado_conexion: 'LOS', potencia_dbm: null, sin_senal_desde: hace(0.1) });

const caja = (id_caja_nap: number, extra: Record<string, unknown> = {}) => ({
  id_caja_nap,
  identificador_unico: `NAP ${id_caja_nap}`,
  zona: 'ZONA 3',
  numero_poste: null,
  latitud: -33.5,
  longitud: -71.6,
  ...extra,
});

describe('resumirOnts', () => {
  it('cuenta en linea, caidas, potencia fuera de rango y promedia la potencia de las que tienen lectura', () => {
    const r = resumirOnts([ont(1, { potencia_dbm: -20 }), ont(1, { potencia_dbm: -26 }), caida(1)], AHORA);
    expect(r).toEqual({ total: 3, en_linea: 2, caidas: 1, potencia_fuera: 1, afectadas: 2, potencia_promedio: -23 });
  });

  it('no cuenta los equipos dados de baja (caidos hace meses)', () => {
    const baja = ont(1, { estado_conexion: 'OFFLINE', sin_senal_desde: hace(200), potencia_dbm: null });
    expect(resumirOnts([ont(1), baja], AHORA)).toMatchObject({ total: 1, caidas: 0 });
  });

  it('sin ONT deja la potencia promedio en null', () => {
    expect(resumirOnts([], AHORA)).toMatchObject({ total: 0, potencia_promedio: null });
  });
});

describe('clasificarCaja', () => {
  const base = { total: 10, afectadas: 0, caidas: 0, potencia_fuera: 0, alertas_abiertas: 0, falla_caja_abierta: false };

  it('SIN_ONT si no tiene ONT ligadas', () => {
    expect(clasificarCaja({ ...base, total: 0 })).toBe('SIN_ONT');
  });

  it('CAIDA si el 70 % o mas esta afectado y hay padron suficiente', () => {
    expect(clasificarCaja({ ...base, afectadas: 7, caidas: 7 })).toBe('CAIDA');
  });

  it('no declara caida una caja con padron chico aunque este al 100 %', () => {
    expect(clasificarCaja({ ...base, total: 2, afectadas: 2, caidas: 2 })).toBe('DEGRADADA');
  });

  it('CAIDA si tiene una alerta de falla de caja abierta, aunque el porcentaje no llegue', () => {
    expect(clasificarCaja({ ...base, caidas: 1, afectadas: 1, falla_caja_abierta: true })).toBe('CAIDA');
  });

  it('DEGRADADA con una ONT caida, con potencia fuera de rango o con una alerta abierta', () => {
    expect(clasificarCaja({ ...base, caidas: 1, afectadas: 1 })).toBe('DEGRADADA');
    expect(clasificarCaja({ ...base, potencia_fuera: 1, afectadas: 1 })).toBe('DEGRADADA');
    expect(clasificarCaja({ ...base, alertas_abiertas: 1 })).toBe('DEGRADADA');
  });

  it('OK si tiene ONT y ningun problema', () => {
    expect(clasificarCaja(base)).toBe('OK');
  });
});

describe('armarSaludCajas', () => {
  it('reparte las ONT por caja, suma alertas y OT, y ordena de la mas grave a la mas sana', () => {
    const onts = [
      ont(1), ont(1),
      ont(2), caida(2),
      ...Array.from({ length: 5 }, () => caida(3)),
      ont(null), // sin caja: no entra a ninguna
    ];
    const r = armarSaludCajas(
      [caja(1), caja(2), caja(3), caja(4, { latitud: null, longitud: null })],
      onts,
      [{ id_caja_nap: 2, tipo: 'SIN_SENAL' }],
      [{ id_caja_nap: 1 }, { id_caja_nap: 1 }],
      AHORA,
    );

    expect(r.cajas.map((c) => [c.id_caja_nap, c.estado])).toEqual([
      [3, 'CAIDA'],
      [2, 'DEGRADADA'],
      [1, 'OK'],
      [4, 'SIN_ONT'],
    ]);
    expect(r.cajas.find((c) => c.id_caja_nap === 1)).toMatchObject({ ots_abiertas: 2, onts: { total: 2 } });
    expect(r.cajas.find((c) => c.id_caja_nap === 2)).toMatchObject({ alertas_abiertas: 1 });
    expect(r.resumen).toEqual({
      cajas: 4,
      por_estado: { CAIDA: 1, DEGRADADA: 1, OK: 1, SIN_ONT: 1 },
      con_alerta_u_ot: 2,
      sin_ubicacion: 1,
      clientes_afectados: 6,
    });
  });

  it('entre dos cajas del mismo estado va primero la que tiene mas ONT afectadas', () => {
    const r = armarSaludCajas(
      [caja(1), caja(2)],
      [ont(1), caida(1), ont(2), caida(2), caida(2)],
      [],
      [],
      AHORA,
    );
    expect(r.cajas.map((c) => c.id_caja_nap)).toEqual([2, 1]);
  });
});
