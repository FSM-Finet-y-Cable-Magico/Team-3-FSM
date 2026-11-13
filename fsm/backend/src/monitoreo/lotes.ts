/** Operaciones en vuelo a la vez en las escrituras masivas del monitoreo. */
export const TAMANO_LOTE = 10;

/**
 * Ejecuta escrituras independientes de a `tamano` en paralelo, SIN transaccion.
 *
 * Por que sin transaccion: con el adaptador de Postgres, Prisma corta una
 * transaccion a los 5 s (P2028). Medido contra Railway desde fuera de su red,
 * a ~200 ms por ida y vuelta, un lote de 50 upserts del catalogo tardo 6,4 s y
 * no se guardaba nada. Estas escrituras no necesitan atomicidad: cada fila es
 * independiente e idempotente, y si una corrida se corta, la siguiente la
 * completa.
 *
 * Por que de a `tamano`: lanzar cientos a la vez agota el pool de conexiones.
 *
 * Recibe funciones y no promesas para que cada operacion arranque recien
 * cuando le toca: una promesa ya creada ya esta corriendo.
 */
export async function ejecutarEnLotes(
  ops: (() => PromiseLike<unknown>)[],
  tamano = TAMANO_LOTE,
): Promise<void> {
  for (let i = 0; i < ops.length; i += tamano) {
    await Promise.all(ops.slice(i, i + tamano).map((op) => op()));
  }
}
