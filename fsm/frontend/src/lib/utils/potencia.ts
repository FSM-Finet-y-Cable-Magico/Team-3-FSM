/**
 * Rango aceptable de potencia optica en la recepcion del cliente.
 *
 * Los mismos umbrales que usa el backend para levantar `advertencia_potencia`
 * al cerrar una OT (ordenes.service.ts). Viven aca para que la vista de detalle
 * y el panel de historial no los repitan cada uno por su cuenta.
 */
export const POTENCIA_MINIMA_DBM = -24;
export const POTENCIA_MAXIMA_DBM = -19;

/**
 * Franja de degradacion previa a la falla (CU-16): la senal todavia sirve pero
 * viene cayendo. Es donde conviene una OT preventiva antes de que el cliente se
 * quede sin servicio. Va de -22 hasta el borde del rango operativo.
 */
export const POTENCIA_PREVENTIVA_DESDE = -22;

export type EstadoPotencia = 'BAJA' | 'OPTIMA' | 'ALTA' | 'SIN_DATO';

/** Clasifica una medicion; `SIN_DATO` cuando la OT todavia no tiene lectura. */
export function estadoPotencia(dbm: number | null | undefined): EstadoPotencia {
  if (dbm === null || dbm === undefined || Number.isNaN(dbm)) return 'SIN_DATO';
  if (dbm < POTENCIA_MINIMA_DBM) return 'BAJA';
  if (dbm > POTENCIA_MAXIMA_DBM) return 'ALTA';
  return 'OPTIMA';
}

export function potenciaEnRango(dbm: number | null | undefined): boolean {
  return estadoPotencia(dbm) === 'OPTIMA';
}

/** Dentro del rango operativo, pero degradandose (CU-16). */
export function potenciaDegradandose(dbm: number | null | undefined): boolean {
  if (dbm === null || dbm === undefined || Number.isNaN(dbm)) return false;
  return dbm <= POTENCIA_PREVENTIVA_DESDE && dbm > POTENCIA_MINIMA_DBM;
}
