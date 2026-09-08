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
 *
 * Son EXACTAMENTE los cuatro que nombra RF-43, ni uno mas. La version anterior
 * traia otros tres --OT_DESPACHADA, SERVICIO_RESTABLECIDO, VISITA_AGENDADA--
 * que no salian del requerimiento sino de suponer que harian falta. Agregar
 * tipos que el RF no pide es inventar alcance, y ademas dejaba fuera tres de
 * los cuatro que si pide.
 */
export const TIPO_EVENTO = {
  /** Corte avisado con anticipacion (RF-44 lo exige con 24 h). */
  MANTENCION_PROGRAMADA: 'MANTENCION_PROGRAMADA',
  /** Dano fisico: accidente vehicular, robo de cobre. */
  CORTE_IMPREVISTO: 'CORTE_IMPREVISTO',
  /** Falla de television, que el cliente vive distinto de un corte de internet. */
  FALLA_TELEVISION: 'FALLA_TELEVISION',
  /** CU-48: la caja NAP caida que deja a varios sin servicio. */
  CORTE_MASIVO_CAJA_NAP: 'CORTE_MASIVO_CAJA_NAP',
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
  /** RF-42: el mensaje al cliente debe incluir el tiempo estimado. */
  'tiempo_estimado',
] as const;

export type VariablePlantilla = (typeof VARIABLES_PLANTILLA)[number];

/** Horas sin movimiento tras las cuales una OT se considera detenida (RF-45). */
export const HORAS_OT_INACTIVA = 24;
