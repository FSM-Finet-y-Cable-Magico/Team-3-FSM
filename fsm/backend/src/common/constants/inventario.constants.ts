/**
 * Vocabulario de `movimiento_inventario.tipo_movimiento`, acordado por el
 * equipo.
 *
 * La base de datos todavía NO valida estos valores: la columna es un
 * `VARCHAR(30)` nullable, sin enum ni CHECK, así que estas constantes son hoy
 * el único punto de control. Aplicarlo en el esquema requiere migración y está
 * diferido a la instalación definitiva en #36, igual que C6 (#19).
 *
 * El módulo de Inventario del Incremento 2 necesita los otros tres valores:
 * deben salir de aquí y no repetirse como strings sueltos.
 */
export const TIPO_MOVIMIENTO = {
  /** Consumo de material al cerrar una OT. `referencia_id` es el `id_ot`. */
  SALIDA_OT: 'SALIDA_OT',
  /** Recepción de mercadería. `referencia_id` es la orden de ingreso. */
  INGRESO_COMPRA: 'INGRESO_COMPRA',
  /** Movimiento entre bodegas o empresas. */
  TRANSFERENCIA: 'TRANSFERENCIA',
  /** Retiro de inventario. */
  BAJA: 'BAJA',
} as const;

export type TipoMovimiento = (typeof TIPO_MOVIMIENTO)[keyof typeof TIPO_MOVIMIENTO];
