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
 * Valores que se guardan en `monitoreo_ont.estado_conexion` e
 * `historial_conexion_ont.evento`. Ambas columnas son `VARCHAR(15)`: todos
 * estos caben.
 */
export const ESTADO_CONEXION = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  LOS: 'LOS',
  DESCONOCIDO: 'DESCONOCIDO',
} as const;
