/**
 * Datos que G1 exige al cerrar una OT de REPARACION (pedido del 8-nov-2026).
 *
 * POR QUE EXISTEN. Hasta ahora el cierre de una reparacion le contaba a G1
 * QUE se gasto y QUE equipos se movieron, pero no QUE pasaba ni como quedo.
 * Sin eso G1 no puede registrar el cierre de reparacion y lo anota como la
 * discrepancia `DATOS_REPARACION_INCOMPLETOS`.
 *
 * SOLO APLICAN A REPARACION. En instalaciones, bajas y el resto de los tipos
 * viajan en null: son datos de un diagnostico que ahi no existe. Por eso los
 * tres campos son opcionales en el DTO y la obligatoriedad la impone el
 * servicio, que es el unico que conoce el `tipo_ot` --mismo criterio que
 * `id_categoria_falla`, que ya funcionaba asi--.
 */

/** Como quedo la reparacion. Los compara G1, asi que van exactos. */
export const RESULTADO_REPARACION = {
  /** El problema no volvera a presentarse: se corrigio la causa. */
  RESUELTO: 'RESUELTO',
  /** Hay servicio, pero con una limitacion o un arreglo provisorio. */
  PARCIAL: 'PARCIAL',
  /** Se diagnostico y no se pudo arreglar en esta visita. */
  SIN_SOLUCION: 'SIN_SOLUCION',
} as const;

export type ResultadoReparacion =
  (typeof RESULTADO_REPARACION)[keyof typeof RESULTADO_REPARACION];

/**
 * Largos que exige G1 para los dos textos.
 *
 * El minimo no es capricho: sin el, "ok" o "ya" pasan la validacion y G1
 * recibe un cierre que no explica nada, que es justo lo que se queria evitar.
 * El maximo es el de su columna.
 */
export const LARGO_MIN_TEXTO_REPARACION = 5;
export const LARGO_MAX_TEXTO_REPARACION = 300;

/**
 * Los tres datos, como quedan guardados y como viajan.
 *
 * Se guardan dentro de `orden_trabajo.cierre_equipos`, la columna JSON que ya
 * guardaba los equipos declarados. NO en columnas propias: contra la base
 * compartida `finet_global_validacion` no tenemos CREATE, asi que agregar
 * columnas depende del administrador. Reusar la columna que ya existe funciona
 * hoy, en las dos bases, sin pedirle nada a nadie.
 *
 * El nombre de la columna quedo corto --dice "equipos" y guarda mas que eso--.
 * Si el administrador confirma para que sirve `borrador_cierre`, o crea las
 * columnas propias, mover esto es leer de otro lado: el resto del sistema solo
 * toca `construirPayloadCierre`.
 */
export interface ReparacionDeclarada {
  falla_reportada: string;
  solucion_aplicada: string;
  resultado: ResultadoReparacion;
}
