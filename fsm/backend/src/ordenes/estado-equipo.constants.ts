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

/**
 * Diagnostico de un equipo retirado. Lista fija de G1, confirmada por Javier el
 * 4-sept-2026.
 *
 * Los literales van EXACTOS, con tildes: los compara G1 de su lado. No es lo
 * mismo que `categoria_falla`, y por eso es un campo aparte:
 *
 *   - `categoria_falla` dice POR QUE se genero la OT. Es una por OT.
 *   - `DIAGNOSTICO_RETIRO` dice QUE LE PASA A UN EQUIPO. Puede haber varios
 *     equipos retirados en la misma OT, cada uno con su diagnostico.
 *
 * Reutilizar `categoria_falla` habria perdido esa distincion y obligado a G1 a
 * inferir de cual equipo hablaba.
 */
export const DIAGNOSTICO_RETIRO = {
  NO_ENCIENDE: 'No enciende',
  SE_REINICIA: 'Se reinicia continuamente',
  SIN_SENAL_OPTICA: 'Sin señal óptica',
  COPLA_O_PUERTO_DANADO: 'Copla o puerto dañado',
  FALLA_DE_CONFIGURACION: 'Falla de configuración',
  DANO_FISICO_VISIBLE: 'Daño físico visible',
  CAUSA_DESCONOCIDA: 'Causa desconocida',
  OTRO: 'Otro',
} as const;

export type DiagnosticoRetiro = (typeof DIAGNOSTICO_RETIRO)[keyof typeof DIAGNOSTICO_RETIRO];

/** Lo que G1 asume cuando el diagnostico no viene (acordado con Javier). */
export const DIAGNOSTICO_POR_DEFECTO = DIAGNOSTICO_RETIRO.CAUSA_DESCONOCIDA;

/**
 * Maquina de estados de G1, tal como la mando Javier el 4-sept-2026.
 *
 * Es DE ELLOS: aca se replica solo para poder exponerla por
 * `GET /integraciones/estados-equipo` y que ninguno de los dos lados copie
 * literales a mano. Si G1 la cambia, esto se actualiza; no se decide aca.
 */
export const TRANSICIONES_G1: { origen: string; destinos: string[] }[] = [
  { origen: 'En bodega', destinos: ['Asignado a técnico', 'En préstamo externo', 'Dado de baja'] },
  { origen: 'Asignado a técnico', destinos: ['Instalado en cliente', 'En bodega', 'En revisión'] },
  { origen: 'Instalado en cliente', destinos: ['En revisión'] },
  { origen: 'En revisión', destinos: ['En bodega', 'En préstamo externo', 'Dado de baja'] },
  { origen: 'En préstamo externo', destinos: ['En bodega'] },
  { origen: 'Dado de baja', destinos: [] },
];

/**
 * Desde que estado admite G1 cada accion nuestra.
 *
 * OJO, y esto esta planteado a G1 y sin responder: cruzando esto con los
 * estados que un equipo puede tener MIENTRAS EL TECNICO ESTA EN EL DOMICILIO
 * --solo dos: "Asignado a técnico" el que lleva encima, "Instalado en cliente"
 * el que ya esta en la casa-- resulta que:
 *
 *   - BAJA_EN_TERRENO es INEMITIBLE: sus dos origenes son de trastienda.
 *   - RETIRADO_A_BODEGA no sirve para retirar un equipo del cliente, que es lo
 *     que su nombre sugiere: ese origen seria "Instalado en cliente", que G1 no
 *     admite para esta accion.
 */
export const ORIGENES_VALIDOS_G1: Record<AccionEquipo, string[]> = {
  INSTALADO_EN_CLIENTE: ['Asignado a técnico'],
  RETIRADO_A_BODEGA: ['Asignado a técnico', 'En revisión', 'En préstamo externo'],
  RETIRADO_PARA_DIAGNOSTICO: ['Asignado a técnico', 'Instalado en cliente'],
  BAJA_EN_TERRENO: ['En bodega', 'En revisión'],
};
