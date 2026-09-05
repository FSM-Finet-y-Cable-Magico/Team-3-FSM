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
 * Días caída tras los cuales una ONT deja de considerarse un incidente y pasa
 * a ser equipo inactivo.
 *
 * SmartOLT conserva la ONT de un cliente dado de baja: queda OFFLINE para
 * siempre. Sobre los datos reales de FiNet, 205 de 300 ONT caídas llevan más
 * de un mes así, y 133 más de seis meses. Sin este techo el panel muestra 278
 * "incidentes" de los cuales ~200 son bajas comerciales, enterrando los ~70
 * que sí pasaron hoy.
 *
 * Vale para los dos niveles: la ONT inactiva no genera su alerta individual, y
 * TAMPOCO cuenta en el porcentaje de la caja — ni en el numerador ni en el
 * denominador. Una caja con 16 ONT de las cuales 10 son bajas viejas no está
 * "caída al 62%": tiene 6 activas, y lo que importa es cuántas de esas 6 se
 * cayeron.
 *
 * Siete días: algo caído hace más de una semana sin que nadie reaccionara no
 * es un incidente operativo del día, es otra cosa (una baja, un equipo
 * retirado, un proceso que falló).
 */
export const DIAS_MAX_INCIDENTE = 7;

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

/**
 * Tipos de alerta. `alerta.tipo` es VARCHAR(30).
 *
 * Los cuatro primeros son AGREGADOS: describen una causa única que afecta a
 * muchos clientes. Van de mayor a menor alcance, y se suprimen en cascada — si
 * la placa entera cayó, no tiene sentido emitir además la alerta de cada una
 * de sus cajas ni de cada ONT. Un incidente, una alerta.
 *
 * Esa jerarquía sale de la topología GPON real:
 *   OLT → placa → puerto PON → caja NAP → ONT del cliente
 */
export const TIPO_ALERTA = {
  /** La OLT completa no responde. */
  FALLA_OLT: 'FALLA_OLT',
  /** Una placa de la OLT: afecta a muchas cajas a la vez. */
  FALLA_PLACA_OLT: 'FALLA_PLACA_OLT',
  /** CU-17 y rama masiva de CU-53: la caja completa. */
  FALLA_CAJA_NAP: 'FALLA_CAJA_NAP',
  /** CU-52: sin señal por más del umbral de la empresa. */
  SIN_SENAL: 'SIN_SENAL',
  /** CU-13: señal demasiado débil. Fibra sucia, doblada o empalme malo. */
  POTENCIA_BAJA: 'POTENCIA_BAJA',
  /**
   * CU-13: demasiada señal. No es una falla de la red sino una instalación mal
   * calibrada (ONT muy cerca de la OLT, falta atenuador), y satura el receptor.
   * Se separa de POTENCIA_BAJA porque la acción del técnico es la opuesta.
   */
  POTENCIA_ALTA: 'POTENCIA_ALTA',
  /**
   * CU-16: todavía dentro del rango operativo pero degradándose. Es el aviso
   * para agendar una OT PREVENTIVA antes de que el cliente se quede sin
   * servicio.
   */
  POTENCIA_DEGRADANDOSE: 'POTENCIA_DEGRADANDOSE',
} as const;

/** Porcentaje de una placa caído a partir del cual se culpa a la placa. */
export const UMBRAL_FALLA_PLACA_PCT = 20;
/** Y de la OLT completa. */
export const UMBRAL_FALLA_OLT_PCT = 50;
/** Padrón activo mínimo para culpar a una placa u OLT, mismo criterio que la caja. */
export const MIN_ONT_PARA_FALLA_PLACA = 20;

export const SEVERIDAD = {
  CRITICA: 'CRITICA',
  ALTA: 'ALTA',
  MEDIA: 'MEDIA',
  BAJA: 'BAJA',
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
