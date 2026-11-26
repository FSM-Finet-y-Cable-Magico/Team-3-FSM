import { describe, expect, it } from '@jest/globals';
import { evaluar, type EstadoOnt } from './reglas-alerta.js';
import { TIPO_ALERTA } from './monitoreo.constants.js';

/**
 * Una placa o una OLT "caida" es que sus ONT se quedaron sin servicio. El 13-11,
 * en la base real, el motor levanto tres "Placa caida" al 25-39 % que eran casi
 * todas ONT EN LINEA con potencia fuera de -24/-19 dBm (OLT 2/placa 1: 7 caidas
 * y 52 por potencia). Eso no es una placa caida, es fibra con problemas en cada
 * casa, y ya tiene sus alertas individuales. Sobre la base real, "avisar a
 * clientes" de esa alerta le escribia a 120 personas por una falla inexistente.
 *
 * La caja NAP (RF-15) SI sigue contando la potencia: el requisito lo pide asi.
 */
const AHORA = new Date('2026-11-13T20:00:00Z');
let id = 0;
const ont = (board: number, caja: string, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
  id_registro_ont: ++id, numero_serie: `SN-${id}`, id_cliente: null, id_caja_nap: null,
  olt_externo: '2', board, puerto_pon: 1, caja_normalizada: caja,
  estado_conexion: 'ONLINE', potencia_dbm: -21, sin_senal_desde: null, ...extra,
});
const caida = (board: number, caja: string) =>
  ont(board, caja, { estado_conexion: 'LOS', potencia_dbm: null, sin_senal_desde: new Date('2026-11-13T18:00:00Z') });
/** Cuarenta ONT repartidas en cajas de 5, todas sanas, en la placa `board`. */
const placa = (board: number) => Array.from({ length: 40 }, (_, i) => ont(board, `NAP ${board}-${Math.floor(i / 5)}`));
const tipos = (onts: EstadoOnt[]) => evaluar(onts, AHORA, 30).map((p) => p.tipo);

describe('placa y OLT caidas cuentan solo ONT sin servicio', () => {
  it('una placa con muchas ONT con potencia fuera de rango pero en linea no es una placa caida', () => {
    const onts = placa(1);
    // 12 de 40 (30 %) en linea con -26 dBm, y solo 2 caidas.
    for (let i = 0; i < 12; i++) onts[i] = { ...onts[i], potencia_dbm: -26 };
    onts[38] = caida(1, onts[38].caja_normalizada!);
    onts[39] = caida(1, onts[39].caja_normalizada!);

    const t = tipos(onts);

    expect(t).not.toContain(TIPO_ALERTA.FALLA_PLACA_OLT);
    expect(t).not.toContain(TIPO_ALERTA.FALLA_OLT);
    // Las de potencia siguen apareciendo, una por ONT.
    expect(t.filter((x) => x === TIPO_ALERTA.POTENCIA_BAJA)).toHaveLength(12);
  });

  it('una placa con el 25 % de sus ONT sin servicio si es una placa caida', () => {
    const onts = placa(1);
    for (let i = 0; i < 10; i++) onts[i * 4] = caida(1, onts[i * 4].caja_normalizada!);

    const propuestas = evaluar(onts, AHORA, 30);
    const falla = propuestas.find((p) => p.tipo === TIPO_ALERTA.FALLA_PLACA_OLT);

    expect(falla).toBeDefined();
    expect(falla!.afectados).toBe(10);
    expect(falla!.mensaje).toContain('sin servicio');
  });

  it('una OLT con la mitad de sus ONT en linea pero con potencia fuera de rango no es una OLT caida', () => {
    const onts = [...placa(1), ...placa(2)].map((o, i) => (i % 2 === 0 ? { ...o, potencia_dbm: -26 } : o));
    expect(tipos(onts)).not.toContain(TIPO_ALERTA.FALLA_OLT);
  });

  it('la caja NAP (RF-15) sigue contando la potencia fuera de rango', () => {
    const onts = [ont(5, 'NAP 9'), ...Array.from({ length: 4 }, () => ont(5, 'NAP 9', { potencia_dbm: -26 }))];
    expect(tipos(onts)).toContain(TIPO_ALERTA.FALLA_CAJA_NAP);
  });
});
