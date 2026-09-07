import { describe, expect, it } from '@jest/globals';
import { ORDEN_SEVERIDAD, SEVERIDAD, TIPO_ALERTA } from './monitoreo.constants.js';

/**
 * Fija tres defectos que encontro la auditoria de esta rama. Los tres viven en
 * `alertas.service.ts` dentro de metodos que tocan la base, asi que aca se
 * prueban las reglas puras que los causaban; el comportamiento completo se
 * ejercita a mano contra la base local.
 */

// Copia literal de la clave de identidad de `evaluarEmpresa`. Si aquella
// cambia y esta no, estas pruebas dejan de proteger nada: van juntas.
const idDe = (p: { tipo: string; id_registro_ont: number | null; clave_caja: string | null }) =>
  `${p.tipo}|${p.id_registro_ont ?? ''}|${p.id_registro_ont == null ? (p.clave_caja ?? '') : ''}`;

describe('identidad de una alerta', () => {
  it('distingue dos OLT caidas', () => {
    // Antes la clave solo incluia `clave_caja` para FALLA_CAJA_NAP, asi que
    // estas dos colapsaban a "FALLA_OLT||": caia una segunda OLT y su alerta
    // se consideraba "ya abierta", no se creaba, y el jefe tecnico no se
    // enteraba.
    const olt1 = { tipo: TIPO_ALERTA.FALLA_OLT, id_registro_ont: null, clave_caja: 'OLT 1' };
    const olt2 = { tipo: TIPO_ALERTA.FALLA_OLT, id_registro_ont: null, clave_caja: 'OLT 2' };

    expect(idDe(olt1)).not.toBe(idDe(olt2));
  });

  it('distingue dos placas de la misma OLT', () => {
    const a = { tipo: TIPO_ALERTA.FALLA_PLACA_OLT, id_registro_ont: null, clave_caja: 'OLT 2 / placa 1' };
    const b = { tipo: TIPO_ALERTA.FALLA_PLACA_OLT, id_registro_ont: null, clave_caja: 'OLT 2 / placa 3' };

    expect(idDe(a)).not.toBe(idDe(b));
  });

  it('distingue dos cajas con senal degradandose', () => {
    // CU-16: la preventiva se agrupa POR CAJA. Con una sola identidad para
    // todas, solo la primera caja del padron llegaba a tener alerta.
    const a = { tipo: TIPO_ALERTA.POTENCIA_DEGRADANDOSE, id_registro_ont: null, clave_caja: '2/1/7|NAP 6' };
    const b = { tipo: TIPO_ALERTA.POTENCIA_DEGRADANDOSE, id_registro_ont: null, clave_caja: '2/1/8|NAP 9' };

    expect(idDe(a)).not.toBe(idDe(b));
  });

  it('una alerta individual se identifica por su ONT, no por su caja', () => {
    // A proposito: si el ligado a caja cambia, sigue siendo la misma alerta y
    // no debe duplicarse.
    const antes = { tipo: TIPO_ALERTA.POTENCIA_BAJA, id_registro_ont: 42, clave_caja: '2/1/7|NAP 6' };
    const despues = { tipo: TIPO_ALERTA.POTENCIA_BAJA, id_registro_ont: 42, clave_caja: '2/1/7|NAP 12' };

    expect(idDe(antes)).toBe(idDe(despues));
  });

  it('dos ONT distintas con el mismo problema son dos alertas', () => {
    const a = { tipo: TIPO_ALERTA.SIN_SENAL, id_registro_ont: 1, clave_caja: null };
    const b = { tipo: TIPO_ALERTA.SIN_SENAL, id_registro_ont: 2, clave_caja: null };

    expect(idDe(a)).not.toBe(idDe(b));
  });
});

// Copia del parseo de `detalle()`, por el mismo motivo que arriba.
function parsearClave(clave: string) {
  const mPlaca = /^OLT (.+) \/ placa (.+)$/.exec(clave);
  const mOlt = /^OLT (.+)$/.exec(clave);
  if (mPlaca) return { olt: mPlaca[1], board: Number(mPlaca[2]) };
  if (mOlt) return { olt: mOlt[1] };
  const [puerto, caja] = clave.split('|');
  const [olt, board, pon] = puerto.split('/');
  return { olt, board: Number(board), pon: Number(pon), caja };
}

describe('los tres formatos de clave_caja', () => {
  it('caja: olt/placa/puerto + nombre', () => {
    expect(parsearClave('2/1/7|NAP 6')).toEqual({ olt: '2', board: 1, pon: 7, caja: 'NAP 6' });
  });

  it('placa', () => {
    expect(parsearClave('OLT 2 / placa 1')).toEqual({ olt: '2', board: 1 });
  });

  it('OLT sola: el formato que faltaba', () => {
    // Sin su rama caia al `else` y dejaba olt="OLT 2" en vez de "2", asi que
    // `detalle()` de una FALLA_OLT devolvia siempre cero afectados.
    expect(parsearClave('OLT 2')).toEqual({ olt: '2' });
  });
});

describe('orden de severidad del panel', () => {
  it('pone la CRITICA primero y la BAJA ultima', () => {
    const desordenadas = [SEVERIDAD.BAJA, SEVERIDAD.MEDIA, SEVERIDAD.CRITICA, SEVERIDAD.ALTA];

    const ordenadas = [...desordenadas].sort((a, b) => ORDEN_SEVERIDAD[a] - ORDEN_SEVERIDAD[b]);

    expect(ordenadas).toEqual([SEVERIDAD.CRITICA, SEVERIDAD.ALTA, SEVERIDAD.MEDIA, SEVERIDAD.BAJA]);
  });

  it('no coincide con el orden alfabetico, que era el bug', () => {
    // `orderBy: { severidad: 'asc' }` daba ALTA, BAJA, CRITICA, MEDIA: las de
    // severidad BAJA por encima de la CRITICA.
    const alfabetico = [...Object.keys(ORDEN_SEVERIDAD)].sort();
    const porUrgencia = [...Object.keys(ORDEN_SEVERIDAD)].sort(
      (a, b) => ORDEN_SEVERIDAD[a] - ORDEN_SEVERIDAD[b],
    );

    expect(alfabetico).not.toEqual(porUrgencia);
    expect(alfabetico.indexOf('CRITICA')).toBeGreaterThan(alfabetico.indexOf('BAJA'));
  });
});
