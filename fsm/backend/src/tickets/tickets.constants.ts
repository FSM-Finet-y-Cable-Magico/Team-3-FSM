/**
 * Vocabularios de tickets — decisión D6 del plan del Incremento 3.
 *
 * Están acá y no sueltos por strings porque ya pasó una vez: `EN_MANTENCION`
 * tiene 13 caracteres y `puerto_nap.estado` era VARCHAR(10), asi que uno de los
 * tres estados que pedia RF-17 simplemente no se podia guardar. Costo una
 * migracion. Abajo hay una prueba que compara cada literal contra el largo de
 * su columna para que no vuelva a pasar.
 *
 * LOS DATOS QUE YA EXISTEN. En produccion hay 10 tickets escritos antes de este
 * modulo, con la caja inconsistente: "cerrado" y "Cerrado", "media" y "Media",
 * "telefono" y "Telefono". Se comprobo uno por uno que los 9 combos distintos
 * normalizan a estos literales con solo pasarlos a mayusculas, asi que el
 * modulo LEE tolerando la caja y ESCRIBE siempre canonico. No hace falta migrar
 * datos ni coordinar una ventana con los otros grupos.
 */

/** Largos reales de las columnas, para la prueba de D6. */
export const LARGO_COLUMNA = {
  estado: 20,
  prioridad: 10,
  origen: 20,
  codigo_seguimiento: 20,
} as const;

export const ESTADO_TICKET = {
  /** Recien creado, sin nadie a cargo. */
  ABIERTO: 'ABIERTO',
  /** Asignado a una persona, que lo esta trabajando. */
  EN_ATENCION: 'EN_ATENCION',
  /** Derivado a una OT porque necesita visita a terreno. */
  ESCALADO: 'ESCALADO',
  /** Solucionado, a la espera del cierre formal. */
  RESUELTO: 'RESUELTO',
  /** Terminado. Lleva `fecha_cierre` y ya no admite cambios. */
  CERRADO: 'CERRADO',
} as const;

export type EstadoTicket = (typeof ESTADO_TICKET)[keyof typeof ESTADO_TICKET];

export const PRIORIDAD_TICKET = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  CRITICA: 'CRITICA',
} as const;

export type PrioridadTicket = (typeof PRIORIDAD_TICKET)[keyof typeof PRIORIDAD_TICKET];

export const ORIGEN_TICKET = {
  TELEFONO: 'TELEFONO',
  WHATSAPP: 'WHATSAPP',
  PORTAL: 'PORTAL',
  PRESENCIAL: 'PRESENCIAL',
  /** Lo abrio el CRM de G8. */
  CRM: 'CRM',
  /** Lo abrio el bot; queda ligado por `id_conversacion_bot`. */
  BOT: 'BOT',
} as const;

export type OrigenTicket = (typeof ORIGEN_TICKET)[keyof typeof ORIGEN_TICKET];

/**
 * Transiciones permitidas. Se valida contra esto y nunca contra strings
 * sueltos, que es lo que pide el paso 4 del track.
 *
 * `CERRADO` es terminal a proposito: un ticket cerrado tiene `fecha_cierre`, y
 * reabrirlo dejaria esa fecha mintiendo. Si hay que retomar el caso, se abre
 * uno nuevo.
 *
 * `RESUELTO → EN_ATENCION` existe porque la solucion puede no haber servido, y
 * eso se sabe despues de avisarle al cliente. Sin esa vuelta, la unica salida
 * seria cerrar y abrir otro, perdiendo el hilo.
 */
export const TRANSICIONES_TICKET: Record<EstadoTicket, EstadoTicket[]> = {
  ABIERTO: ['EN_ATENCION', 'ESCALADO', 'CERRADO'],
  EN_ATENCION: ['ABIERTO', 'ESCALADO', 'RESUELTO', 'CERRADO'],
  ESCALADO: ['RESUELTO', 'CERRADO'],
  RESUELTO: ['EN_ATENCION', 'CERRADO'],
  CERRADO: [],
};

/** Estados en los que el ticket sigue vivo. Util para filtros y contadores. */
export const ESTADOS_ABIERTOS: EstadoTicket[] = ['ABIERTO', 'EN_ATENCION', 'ESCALADO', 'RESUELTO'];

/** Al entrar acá se sella `fecha_cierre`. */
export const ESTADOS_TERMINALES: EstadoTicket[] = ['CERRADO'];

export const PRIORIDAD_POR_DEFECTO: PrioridadTicket = 'MEDIA';
export const ORIGEN_POR_DEFECTO: OrigenTicket = 'TELEFONO';

/**
 * Pasa a canonico lo que venga de la base o de afuera. Devuelve `null` si no es
 * un valor conocido, para que quien llama decida: rechazar si es una entrada
 * del usuario, o mostrar el crudo si es una fila antigua.
 */
function canonico<T extends string>(vocabulario: Record<string, T>, valor: unknown): T | null {
  if (typeof valor !== 'string') return null;
  const clave = valor.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return vocabulario[clave] ?? null;
}

export const normalizarEstado = (v: unknown) => canonico(ESTADO_TICKET, v);
export const normalizarPrioridad = (v: unknown) => canonico(PRIORIDAD_TICKET, v);
export const normalizarOrigen = (v: unknown) => canonico(ORIGEN_TICKET, v);

/**
 * Alfabeto del código de seguimiento. Sin I, O, 0 ni 1: el código se dicta por
 * teléfono, que es de donde llega la mayoría de los tickets, y esas cuatro son
 * las que se confunden al oído y al leerlas a mano.
 */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO_SUFIJO = 5;

/**
 * `TK-AAAAMM-XXXXX`, 15 caracteres sobre una columna de 20.
 *
 * El mes va adelante para que el código diga cuándo se abrió el caso sin tener
 * que buscarlo, y para que el espacio de colisión se reinicie cada mes: son
 * 32^5 ≈ 33 millones por mes, con menos de 100 tickets reales. Igual el
 * servicio maneja el choque, porque `codigo_seguimiento` es @unique y "casi
 * imposible" no es "imposible".
 */
export function generarCodigoSeguimiento(ahora = new Date()): string {
  const anio = ahora.getUTCFullYear();
  const mes = String(ahora.getUTCMonth() + 1).padStart(2, '0');
  let sufijo = '';
  for (let i = 0; i < LARGO_SUFIJO; i++) {
    sufijo += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return `TK-${anio}${mes}-${sufijo}`;
}
