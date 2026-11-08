/**
 * Equivalencia entre los nombres de rol que guarda la base y los codigos que
 * usa el codigo del FSM.
 *
 * POR QUE EXISTE. El FSM nacio con su propia base, donde `rol.nombre_rol`
 * guarda los codigos tal cual: ADMIN, JEFE_TECNICO, TECNICO, COORDINADOR,
 * COMERCIAL. La base compartida `finet_global_validacion` --la que va a usar
 * FiNet-- los nombra distinto: Administrador, Soporte, Terreno, Comercial,
 * Inventario, SUPERUSUARIO. Sin traduccion, un administrador de esa base
 * entra y no puede hacer nada: los 109 decoradores `@Roles('ADMIN', ...)`
 * comparan contra un string que ahi nunca aparece.
 *
 * POR QUE NO HAY UNA VARIABLE DE ENTORNO. Seria una configuracion que puede
 * quedar mal puesta y que falla de la peor manera: el sistema arranca, la
 * gente entra, y recien al intentar aprobar un cierre descubre que no tiene
 * permiso. En vez de eso, las consultas aceptan LOS DOS nombres a la vez
 * (ver NOMBRES_EN_BASE) y la traduccion al entrar es una busqueda que, si no
 * encuentra, deja el nombre como esta. El mismo binario sirve contra las dos
 * bases y no hay nada que configurar.
 */

/** Los codigos internos. Son los que aparecen en los decoradores `@Roles`. */
export const ROL = {
  ADMIN: 'ADMIN',
  JEFE_TECNICO: 'JEFE_TECNICO',
  TECNICO: 'TECNICO',
  COORDINADOR: 'COORDINADOR',
  COMERCIAL: 'COMERCIAL',
} as const;

export type CodigoRol = (typeof ROL)[keyof typeof ROL];

/**
 * Nombre en la base compartida -> codigo interno.
 *
 * SOBRE `Soporte`. Es el candidato obvio a JEFE_TECNICO y NO esta mapeado a
 * proposito. Preguntamos al administrador de la base que rol corresponde al
 * jefe tecnico --el que asigna y supervisa OT-- y todavia no contesta.
 * Mapearlo mal le daria a soporte la facultad de aprobar cierres, que es
 * justo la separacion de funciones que el sistema defiende: quien cierra no
 * aprueba (MOD RF-04).
 *
 * Mientras tanto nadie tiene JEFE_TECNICO contra esa base, y todo lo que ese
 * rol hace lo cubre ADMIN, porque los decoradores son `@Roles('ADMIN',
 * 'JEFE_TECNICO')` en los 64 casos donde aparece. Se degrada sin romperse.
 * Cuando contesten, es una linea.
 *
 * `Inventario` y `SUPERUSUARIO` tampoco se mapean: son de G1 y del
 * administrador de la base, no perfiles del FSM.
 */
const EQUIVALENCIAS: Record<string, CodigoRol> = {
  Administrador: ROL.ADMIN,
  Terreno: ROL.TECNICO,
  Comercial: ROL.COMERCIAL,
  // Soporte: ROL.JEFE_TECNICO,  <-- ver el comentario de arriba
};

/**
 * Traduce el nombre leido de la base al codigo interno.
 *
 * Si no lo conoce lo devuelve igual, y por eso funciona contra nuestra propia
 * base sin ningun caso especial: ahi `nombre_rol` YA es el codigo. Un rol
 * desconocido tampoco rompe nada: no coincide con ningun `@Roles` y el
 * usuario queda sin permisos, que es el lado seguro.
 */
export function codigoDeRol(nombreEnBase: string | null | undefined): string {
  if (!nombreEnBase) return '';
  return EQUIVALENCIAS[nombreEnBase] ?? nombreEnBase;
}

/**
 * Codigo interno -> todos los nombres con los que puede estar guardado.
 *
 * Para las consultas que BUSCAN por rol, que son el camino inverso. Se usa
 * con `in` para que la misma consulta encuentre al tecnico tanto si la fila
 * dice 'TECNICO' como si dice 'Terreno':
 *
 *   rol: { nombre_rol: { in: nombresEnBase(ROL.TECNICO) } }
 */
export function nombresEnBase(codigo: CodigoRol): string[] {
  const alias = Object.entries(EQUIVALENCIAS)
    .filter(([, c]) => c === codigo)
    .map(([nombre]) => nombre);
  return [codigo, ...alias];
}
