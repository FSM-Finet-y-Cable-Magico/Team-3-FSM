/**
 * Acciones semánticas sobre equipos individualizables en el cierre de OT.
 *
 * ACUERDO G1↔G3: la máquina de estados de equipos y sus literales exactos (con
 * tildes) son de G1. G3 NUNCA escribe `unidad_equipo` ni esos literales: manda
 * una de estas acciones y G1 la mapea y ejecuta la transición.
 *
 * El mapeo de abajo está acá solo para trazabilidad y para la documentación del
 * payload; el que vale es el de G1 en el doc global.
 */
export const ACCION_EQUIPO = {
  /** El técnico instaló este equipo en el domicilio del cliente. */
  INSTALADO_EN_CLIENTE: 'INSTALADO_EN_CLIENTE',
  /** El técnico retiró el equipo y vuelve a bodega operativo. */
  RETIRADO_A_BODEGA: 'RETIRADO_A_BODEGA',
  /** El técnico retiró el equipo con falla; va a revisión/diagnóstico. */
  RETIRADO_PARA_DIAGNOSTICO: 'RETIRADO_PARA_DIAGNOSTICO',
  /** El equipo quedó inutilizable en terreno. */
  BAJA_EN_TERRENO: 'BAJA_EN_TERRENO',
} as const;

export type AccionEquipo = (typeof ACCION_EQUIPO)[keyof typeof ACCION_EQUIPO];

/**
 * Mapeo tentativo a los literales de G1 (los 6 estados de su máquina, del JSON
 * de casos de uso de G1). `RETIRADO_PARA_DIAGNOSTICO` → "En revisión" está
 * PENDIENTE de confirmar con G1 en el doc global.
 */
export const ACCION_A_ESTADO_G1: Record<AccionEquipo, string> = {
  INSTALADO_EN_CLIENTE: 'Instalado en cliente',
  RETIRADO_A_BODEGA: 'En bodega',
  RETIRADO_PARA_DIAGNOSTICO: 'En revisión', // CONFIRMAR con G1
  BAJA_EN_TERRENO: 'Dado de baja',
};

export const ACCIONES_EQUIPO_INSTALACION: AccionEquipo[] = ['INSTALADO_EN_CLIENTE'];
export const ACCIONES_EQUIPO_RETIRO: AccionEquipo[] = [
  'RETIRADO_A_BODEGA',
  'RETIRADO_PARA_DIAGNOSTICO',
  'BAJA_EN_TERRENO',
];
