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
  /**
   * Todo retiro, sin distinguir por qué.
   *
   * Antes había tres (`RETIRADO_A_BODEGA`, `BAJA_EN_TERRENO` y este). Se
   * eliminaron los dos primeros por decisión de G1 del 8-sept-2026: todo lo que
   * el técnico retira entra a su taller como "En revisión", y son ellos quienes
   * después deciden si vuelve a bodega o se da de baja, con su propio flujo.
   *
   * El motivo es de fondo y conviene no revertirlo sin hablarlo: un técnico en
   * el domicilio no puede saber si un equipo es recuperable. Pedirle que elija
   * entre "a bodega" y "de baja" es pedirle un diagnóstico que se hace en el
   * taller, y cada vez que se equivoque hay que corregir la máquina de estados
   * de G1 desde afuera. Con un solo destino, el retiro queda trazado y la
   * decisión la toma quien tiene el equipo en la mano y tiempo para mirarlo.
   *
   * Para el técnico esto significa un solo botón de retiro en vez de tres.
   */
  RETIRADO_PARA_DIAGNOSTICO: 'RETIRADO_PARA_DIAGNOSTICO',
} as const;

export type AccionEquipo = (typeof ACCION_EQUIPO)[keyof typeof ACCION_EQUIPO];

/**
 * A qué estado de la máquina de G1 mueve cada acción. Confirmado por Javier el
 * 8-sept-2026: ya no es tentativo.
 */
export const ACCION_A_ESTADO_G1: Record<AccionEquipo, string> = {
  INSTALADO_EN_CLIENTE: 'Instalado en cliente',
  RETIRADO_PARA_DIAGNOSTICO: 'En revisión',
};
export const ACCIONES_EQUIPO_RETIRO: AccionEquipo[] = ['RETIRADO_PARA_DIAGNOSTICO'];

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
 * RESUELTO el 8-sept-2026. Se le habia planteado a G1 que, cruzando su maquina
 * de estados con los estados que un equipo puede tener MIENTRAS EL TECNICO ESTA
 * EN EL DOMICILIO --solo dos: "Asignado a técnico" el que lleva encima,
 * "Instalado en cliente" el que ya esta en la casa-- dos de nuestras cuatro
 * acciones no se podian emitir nunca:
 *
 *   - BAJA_EN_TERRENO era INEMITIBLE: sus dos origenes eran de trastienda.
 *   - RETIRADO_A_BODEGA no servia para retirar un equipo del cliente, que es lo
 *     que su nombre sugiere: ese origen seria "Instalado en cliente", que G1 no
 *     admitia para esa accion.
 *
 * La respuesta fue eliminar las dos y dejar un unico retiro. Por eso este mapa
 * tiene ahora solo dos entradas, y las dos son emitibles desde el domicilio.
 */
export const ORIGENES_VALIDOS_G1: Record<AccionEquipo, string[]> = {
  INSTALADO_EN_CLIENTE: ['Asignado a técnico'],
  RETIRADO_PARA_DIAGNOSTICO: ['Asignado a técnico', 'Instalado en cliente'],
};
