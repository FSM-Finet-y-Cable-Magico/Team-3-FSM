/**
 * El estado "activo" de un cliente o de un contrato, venga escrito como venga.
 *
 * POR QUE EXISTE. El FSM nacio con su propia base, donde los estados se
 * guardan en mayusculas: 'ACTIVO'. La base compartida `finet_global_validacion`
 * --la que va a usar FiNet-- la carga el CRM de G8 y los guarda capitalizados:
 * 'Activo'. Comparando con `=== 'ACTIVO'`, un cliente activo de la base global
 * quedaba como si no tuviera servicio: no se le podia abrir un ticket, no
 * contaba en el dashboard y su ficha salia sin contratos.
 *
 * Mismo criterio que con los roles (src/auth/roles.constants.ts): se acepta
 * cualquiera de las dos grafias y el mismo binario sirve contra las dos bases,
 * sin nada que configurar.
 *
 * Solo para LEER. Al escribir, el FSM sigue guardando 'ACTIVO'; y las
 * escrituras de cliente y contrato van a pasar por la API del CRM de G8.
 */

export const ESTADO_ACTIVO = 'ACTIVO';

/** Para un `where` de Prisma: `{ estado: FILTRO_ESTADO_ACTIVO }`. */
export const FILTRO_ESTADO_ACTIVO = {
  equals: ESTADO_ACTIVO,
  mode: 'insensitive',
} as const;

/** Para comparar un estado ya leido. */
export function esActivo(estado: string | null | undefined): boolean {
  return (estado ?? '').trim().toUpperCase() === ESTADO_ACTIVO;
}
