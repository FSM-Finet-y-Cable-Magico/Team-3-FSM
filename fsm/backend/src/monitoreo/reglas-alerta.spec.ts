import { describe, expect, it } from '@jest/globals';
import { evaluar, afectaAlGrupo, type EstadoOnt } from './reglas-alerta.js';
import {
  MIN_ONT_PARA_FALLA_CAJA,
  TIPO_ALERTA,
  UMBRAL_FALLA_CAJA_PCT,
} from './monitoreo.constants.js';

/**
 * El motor que decide que alertas se levantan no tenia ninguna prueba directa.
 * Lo que se fija aca es el criterio de RF-15, que es donde el codigo decia una
 * cosa distinta del RF.
 *
 * RF-15: "cuando el 70 % o mas de los clientes de una misma caja NAP presenten
 * POTENCIA FUERA DE RANGO simultaneamente". El motor contaba solo las ONT
 * caidas, que es otro criterio y no se solapa con ese.
 */
describe('RF-15 · cuando se declara caida una caja NAP', () => {
  const ahora = new Date('2026-09-08T12:00:00Z');

  let n = 0;
  const ont = (estado: string | null, potencia: number | null): EstadoOnt => ({
    id_registro_ont: ++n,
    numero_serie: `SN${n}`,
    id_cliente: n,
    id_caja_nap: 1,
    olt_externo: 'OLT1',
    board: 1,
    puerto_pon: 1,
    caja_normalizada: 'CTO 15',
    estado_conexion: estado,
    potencia_dbm: potencia,
    // Sin esto una ONT caida se toma por baja vieja y sale del padron.
    sin_senal_desde: estado && estado !== 'ONLINE' ? new Date('2026-09-08T11:00:00Z') : null,
  });

  const sana = () => ont('ONLINE', -21);
  const caida = () => ont('LOS', null);
  /** ONLINE, o sea con servicio, pero con la senal fuera del rango operativo. */
  const fueraDeRango = () => ont('ONLINE', -30);

  const cajaCaida = (onts: EstadoOnt[]) =>
    evaluar(onts, ahora, 30).find((a) => a.tipo === TIPO_ALERTA.FALLA_CAJA_NAP);

  it('la ONT ONLINE con potencia fuera de rango cuenta, que es lo que dice el RF', () => {
    // Este es el caso que el motor se perdia: ocho de diez con la senal fuera
    // de rango es justo lo que RF-15 nombra, y no se levantaba ninguna alerta
    // porque ninguna estaba caida.
    const onts = [...Array(8)].map(fueraDeRango).concat([...Array(2)].map(sana));

    const alerta = cajaCaida(onts);

    expect(alerta).toBeDefined();
    expect(alerta!.afectados).toBe(8);
    expect(alerta!.mensaje).toContain('80%');
  });

  it('la ONT caida sigue contando: una caja partida deja a todos sin senal', () => {
    // El criterio literal del RF dejaria esto afuera --una ONT sin conexion no
    // tiene lectura de potencia-- y seria el peor resultado posible.
    const onts = [...Array(8)].map(caida).concat([...Array(2)].map(sana));

    expect(cajaCaida(onts)!.afectados).toBe(8);
  });

  it('suma los dos casos en el mismo porcentaje', () => {
    // Cuatro caidas y cuatro fuera de rango son ocho de diez: el 80 %. Con
    // cualquiera de los dos criterios por separado daria 40 % y no alertaria.
    const onts = [...Array(4)].map(caida)
      .concat([...Array(4)].map(fueraDeRango))
      .concat([...Array(2)].map(sana));

    const alerta = cajaCaida(onts);

    expect(alerta).toBeDefined();
    expect(alerta!.afectados).toBe(8);
  });

  it('no alerta por debajo del umbral del RF', () => {
    // Seis de diez es 60 %: no llega al 70 que fija el RF.
    const onts = [...Array(6)].map(fueraDeRango).concat([...Array(4)].map(sana));

    expect(cajaCaida(onts)).toBeUndefined();
  });

  it('alerta justo en el umbral: el RF dice "70 % o mas"', () => {
    const onts = [...Array(7)].map(fueraDeRango).concat([...Array(3)].map(sana));

    expect(cajaCaida(onts)!.mensaje).toContain(`${UMBRAL_FALLA_CAJA_PCT}%`);
  });

  it('no declara caida una caja con padron demasiado chico', () => {
    // Una caja con cuatro ONT registradas puede tener dieciseis en la calle:
    // decir "el 100 % esta caido" mandaria un tecnico a buscar una falla que
    // no existe. Ver MIN_ONT_PARA_FALLA_CAJA.
    const onts = [...Array(MIN_ONT_PARA_FALLA_CAJA - 1)].map(caida);

    expect(cajaCaida(onts)).toBeUndefined();
  });

  it('la potencia sin lectura no cuenta como afectada', () => {
    // Null no es "fuera de rango": es que no se sabe. Contarlo inflaria el
    // porcentaje con ONT de las que no hay dato.
    expect(afectaAlGrupo(ont('ONLINE', null))).toBe(false);
    expect(afectaAlGrupo(ont(null, null))).toBe(false);
  });

  it('la franja preventiva no cuenta: esos clientes todavia tienen servicio', () => {
    // -22 esta degradandose pero dentro del rango operativo. Es CU-16, su
    // propia alerta, y mezclarla inflaria el conteo de la caja caida.
    expect(afectaAlGrupo(ont('ONLINE', -22))).toBe(false);

    const onts = [...Array(8)].map(() => ont('ONLINE', -22)).concat([...Array(2)].map(sana));
    expect(cajaCaida(onts)).toBeUndefined();
  });
});
