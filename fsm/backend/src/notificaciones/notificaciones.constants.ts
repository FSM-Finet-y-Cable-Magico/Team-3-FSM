/**
 * Constantes de notificaciones (RF-42, RF-43, RF-45).
 */

/**
 * Canales por los que se puede avisar. `canal` es VARCHAR(20): todos caben.
 *
 * Hoy ninguno envia de verdad: no hay proveedor contratado ni credenciales, y
 * FiNet todavia no dijo cual usara. Lo que se construye es el registro y el
 * armado del mensaje, que es la parte que no cambia cuando se elija proveedor.
 * El envio real entra detras de la misma interfaz, como se hizo con SmartOLT.
 */
export const CANAL_NOTIFICACION = {
  /** Queda escrito para leerlo en pantalla; no sale del sistema. */
  INTERNO: 'INTERNO',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  WHATSAPP: 'WHATSAPP',
} as const;

export type CanalNotificacion = (typeof CANAL_NOTIFICACION)[keyof typeof CANAL_NOTIFICACION];

/**
 * Estado de cada envio. `estado_envio` es VARCHAR(20).
 *
 * `SIMULADO` existe para no mentir: mientras no haya proveedor, decir "ENVIADO"
 * haria creer que al cliente le llego algo. Cuando se conecte el proveedor,
 * las filas viejas siguen distinguiendose de las reales.
 */
export const ESTADO_ENVIO = {
  SIMULADO: 'SIMULADO',
  ENVIADO: 'ENVIADO',
  FALLIDO: 'FALLIDO',
} as const;

export type EstadoEnvio = (typeof ESTADO_ENVIO)[keyof typeof ESTADO_ENVIO];

/**
 * Eventos que puede describir una plantilla. `tipo_evento` es VARCHAR(60).
 */
export const TIPO_EVENTO = {
  /** CU-48: hay una falla que deja sin servicio a varios clientes. */
  FALLA_MASIVA: 'FALLA_MASIVA',
  /** Se despacho una cuadrilla por esa falla. */
  OT_DESPACHADA: 'OT_DESPACHADA',
  /** El servicio volvio. */
  SERVICIO_RESTABLECIDO: 'SERVICIO_RESTABLECIDO',
  /** Recordatorio de visita agendada. */
  VISITA_AGENDADA: 'VISITA_AGENDADA',
} as const;

export type TipoEvento = (typeof TIPO_EVENTO)[keyof typeof TIPO_EVENTO];

/**
 * Variables que se reemplazan en el texto de la plantilla.
 *
 * Es una lista cerrada a proposito: si se dejara interpolar cualquier cosa, una
 * plantilla podria filtrar campos del cliente que no corresponde mandar (RUT,
 * direccion de otro) al escribir mal un nombre.
 */
export const VARIABLES_PLANTILLA = [
  'cliente',
  'zona',
  'caja',
  'fecha',
  'hora',
  'empresa',
] as const;

export type VariablePlantilla = (typeof VARIABLES_PLANTILLA)[number];

/** Horas sin movimiento tras las cuales una OT se considera detenida (RF-45). */
export const HORAS_OT_INACTIVA = 24;
