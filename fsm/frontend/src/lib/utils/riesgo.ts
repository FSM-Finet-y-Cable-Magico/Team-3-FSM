/**
 * MOD RF-32: semaforo de riesgo del cliente. El nivel vigente es la ultima fila
 * del cliente en la lista (el Controlador manda solo esa). Una fila sin nivel es
 * anterior al semaforo: marcaba "conflictivo", que es ROJO.
 */
export type NivelRiesgo = 'VERDE' | 'AMARILLO' | 'ROJO';

export const NIVELES_RIESGO: NivelRiesgo[] = ['VERDE', 'AMARILLO', 'ROJO'];

/** Mismo minimo que el Controlador para AMARILLO y ROJO. */
export const MIN_JUSTIFICACION_RIESGO = 20;

export function nivelDeCliente(cliente: { lista_negra?: { nivel: string | null }[] } | null | undefined): NivelRiesgo {
  const ultima = cliente?.lista_negra?.[0];
  if (!ultima) return 'VERDE';
  return (NIVELES_RIESGO as string[]).includes(ultima.nivel ?? '') ? (ultima.nivel as NivelRiesgo) : 'ROJO';
}
