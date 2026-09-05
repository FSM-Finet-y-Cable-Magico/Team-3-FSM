/**
 * Constantes del módulo de monitoreo.
 */

/**
 * Rango operativo aceptable de potencia óptica RX, en dBm.
 *
 * Es el MISMO criterio que usa `ordenes.service.cerrarOT` para
 * `advertencia_potencia` (hoy hardcodeado como `< -24 || > -19`). Está acá para
 * que el módulo de monitoreo no repita el número suelto. Pendiente confirmar
 * con FiNet el rango real y, cuando se confirme, unificar ambos usos.
 */
export const RANGO_POTENCIA_DBM = { min: -24, max: -19 } as const;

export function potenciaFueraDeRango(dbm: number | null | undefined): boolean {
  if (dbm === null || dbm === undefined) return false;
  return dbm < RANGO_POTENCIA_DBM.min || dbm > RANGO_POTENCIA_DBM.max;
}

/**
 * CU-16: franja de degradación previa a la falla. La señal todavía sirve, pero
 * viene cayendo — es el rango donde conviene mandar una OT PREVENTIVA antes de
 * que el cliente se quede sin servicio.
 *
 * Va de -22 (empieza a degradarse) a -24 (borde del rango operativo, donde
 * `potenciaFueraDeRango` ya la da por fuera).
 */
export const RANGO_POTENCIA_PREVENTIVA_DBM = { desde: -22, hasta: -24 } as const;

export function potenciaEnFranjaPreventiva(dbm: number | null | undefined): boolean {
  if (dbm === null || dbm === undefined) return false;
  return dbm <= RANGO_POTENCIA_PREVENTIVA_DBM.desde && dbm > RANGO_POTENCIA_PREVENTIVA_DBM.hasta;
}

/**
 * CU-17 / CU-53: porcentaje de ONT caídas de una misma caja a partir del cual
 * deja de ser un problema por cliente y pasa a ser una falla de la caja.
 */
export const UMBRAL_FALLA_CAJA_PCT = 70;

/**
 * Padrón mínimo conocido de una caja para animarse a declararla caída.
 *
 * No sale del CU: sale de que el padrón está incompleto. Una caja con 2 ONT
 * registradas puede tener 16 en la calle — decir "el 100% está caído" cuando
 * en realidad son 2 de 16 manda un técnico a buscar una falla que no existe.
 * Por debajo de este número, las ONT generan su alerta individual y nada más.
 */
export const MIN_ONT_PARA_FALLA_CAJA = 5;

/** CU-52: minutos sin señal antes de alertar, si la empresa no configuró otro. */
export const UMBRAL_DESCONEXION_MIN_DEFECTO = 30;

/**
 * Horas de silencio después de que una PERSONA revisa una alerta.
 *
 * Sin esto el motor la recrea en la siguiente corrida —la condición sigue
 * cumpliéndose, porque revisar no repara— y el jefe técnico ve reaparecer lo
 * que acaba de despachar cada 30 minutos. Pasado el plazo vuelve a levantarse,
 * que es lo correcto: si el problema sigue una semana después, hay que
 * recordarlo.
 *
 * No aplica al cierre automático: ese ocurre cuando la condición desaparece, y
 * ahí una alerta nueva más adelante es un incidente nuevo de verdad.
 */
export const SILENCIO_TRAS_REVISION_H = 24;

/** Tipos de alerta que genera el motor. `alerta.tipo` es VARCHAR(30). */
export const TIPO_ALERTA = {
  /** CU-13: potencia fuera del rango operativo. */
  POTENCIA_FUERA_RANGO: 'POTENCIA_FUERA_RANGO',
  /** CU-52: sin señal por más del umbral de la empresa. */
  SIN_SENAL: 'SIN_SENAL',
  /** CU-17 y rama masiva de CU-53: la caja completa. */
  FALLA_CAJA_NAP: 'FALLA_CAJA_NAP',
} as const;

export const SEVERIDAD = {
  CRITICA: 'CRITICA',
  ALTA: 'ALTA',
  MEDIA: 'MEDIA',
} as const;

/**
 * Valores que se guardan en `monitoreo_ont.estado_conexion` e
 * `historial_conexion_ont.evento`. Ambas columnas son `VARCHAR(15)`: todos
 * estos caben.
 */
export const ESTADO_CONEXION = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  POWER_FAIL: 'POWER_FAIL',
  LOS: 'LOS',
  DESCONOCIDO: 'DESCONOCIDO',
} as const;
