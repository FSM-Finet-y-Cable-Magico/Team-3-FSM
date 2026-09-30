import { randomInt } from 'node:crypto';

/**
 * Vocabularios de tickets de soporte (CU-29, CU-30, CU-32). D6 del plan: se
 * congelan antes de escribir el modulo, al estilo de estado-equipo.constants,
 * y `tickets.constants.spec.ts` verifica contra el esquema que cada literal
 * entre en su columna.
 */

/**
 * CU-30: el jefe tecnico resuelve remotamente (EN_PROGRESO → RESUELTO) o deriva
 * a una OT de terreno (DERIVADO_OT). El ticket derivado se resuelve solo cuando
 * la OT se completa, y vuelve a ABIERTO si la OT se cancela.
 */
export const ESTADO_TICKET = {
  ABIERTO: 'ABIERTO',
  EN_PROGRESO: 'EN_PROGRESO',
  DERIVADO_OT: 'DERIVADO_OT',
  RESUELTO: 'RESUELTO',
} as const;
export type EstadoTicket = (typeof ESTADO_TICKET)[keyof typeof ESTADO_TICKET];

/** Los que todavia esperan algo: cuentan para el SLA y se pueden reclasificar. */
export const ESTADOS_TICKET_ABIERTOS: EstadoTicket[] = [
  ESTADO_TICKET.ABIERTO,
  ESTADO_TICKET.EN_PROGRESO,
  ESTADO_TICKET.DERIVADO_OT,
];

export const TRANSICIONES_TICKET: Record<EstadoTicket, EstadoTicket[]> = {
  ABIERTO: [ESTADO_TICKET.EN_PROGRESO, ESTADO_TICKET.DERIVADO_OT],
  EN_PROGRESO: [ESTADO_TICKET.RESUELTO, ESTADO_TICKET.DERIVADO_OT],
  // Los dos salen de la OT: se completa (RESUELTO) o se cancela (ABIERTO).
  DERIVADO_OT: [ESTADO_TICKET.RESUELTO, ESTADO_TICKET.ABIERTO],
  RESUELTO: [],
};

/** Mismos valores y mismo orden que la prioridad de las OT. */
export const PRIORIDAD_TICKET = {
  CRITICA: 'CRITICA',
  ALTA: 'ALTA',
  MEDIA: 'MEDIA',
  BAJA: 'BAJA',
} as const;
export type PrioridadTicket = (typeof PRIORIDAD_TICKET)[keyof typeof PRIORIDAD_TICKET];

/**
 * La prioridad sale del SLA de la categoria (CU-32: al reclasificar "se
 * recalcula el SLA y la prioridad"). Una categoria sin SLA queda en MEDIA.
 */
export function prioridadPorSla(sla_horas: number | null): PrioridadTicket {
  if (sla_horas == null) return PRIORIDAD_TICKET.MEDIA;
  if (sla_horas <= 4) return PRIORIDAD_TICKET.CRITICA;
  if (sla_horas <= 8) return PRIORIDAD_TICKET.ALTA;
  if (sla_horas <= 24) return PRIORIDAD_TICKET.MEDIA;
  return PRIORIDAD_TICKET.BAJA;
}

/**
 * Por donde llego el ticket. Los tres primeros los registra el jefe tecnico
 * en la Vista; los otros llegan de los canales digitales de otros grupos por
 * `POST /integraciones/tickets` (CU-29, "formulario web o bot").
 */
export const ORIGEN_TICKET = {
  TELEFONO: 'TELEFONO',
  PRESENCIAL: 'PRESENCIAL',
  CORREO: 'CORREO',
  PORTAL: 'PORTAL',
  BOT: 'BOT',
  WHATSAPP: 'WHATSAPP',
  /**
   * El CRM de G8. Se agrega porque seis de los tickets que ya existian vinieron
   * de ahi, y no habia a que mapearlos: PORTAL o BOT dirian un canal que no es.
   * Vale mas conservar de donde vino de verdad que forzarlo a la lista.
   */
  CRM: 'CRM',
} as const;
export type OrigenTicket = (typeof ORIGEN_TICKET)[keyof typeof ORIGEN_TICKET];

export const ORIGENES_INTERNOS: OrigenTicket[] = [ORIGEN_TICKET.TELEFONO, ORIGEN_TICKET.PRESENCIAL, ORIGEN_TICKET.CORREO];
export const ORIGENES_DIGITALES: OrigenTicket[] = [
  ORIGEN_TICKET.PORTAL,
  ORIGEN_TICKET.BOT,
  ORIGEN_TICKET.WHATSAPP,
  ORIGEN_TICKET.CRM,
];

/**
 * Sin 0/O ni 1/I/L: el cliente lo dicta por telefono o lo copia a mano. 32
 * simbolos en 7 posiciones son 34 mil millones de codigos.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * CU-29: numero de seguimiento TK-XXXXXXX. Es AL AZAR y no correlativo a
 * proposito: con TK-0000123 cualquiera podria probar el siguiente y ver el
 * ticket de otro cliente. `codigo_seguimiento` es UNIQUE y el servicio
 * reintenta si choca.
 */
export function generarCodigoSeguimiento(): string {
  let s = 'TK-';
  for (let i = 0; i < 7; i++) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}
