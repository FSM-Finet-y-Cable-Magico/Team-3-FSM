import { ZONA_OPERACION } from '../common/utils/dia-habil.util.js';

/**
 * Cortes y reactivaciones por morosidad.
 *
 * G8 decide: marca `contrato.estado = 'Suspendido'` (con `fecha_suspension`) y
 * lo devuelve a `Activo` al reactivar. G3 ejecuta en SmartOLT, que hoy es a
 * mano: nuestro token es de solo lectura. Lo unico que guarda el FSM es que
 * alguien lo hizo, en `log_auditoria`. Ver el spec del 13-11-2026.
 */
export const ACCION_CORTE = 'CORTE_SMARTOLT';
export const ACCION_REACTIVACION = 'REACTIVACION_SMARTOLT';

export type EstadoCorte = 'POR_CORTAR' | 'POR_REACTIVAR' | 'AL_DIA';

// En la base el estado viene como 'activo', 'Activo' y 'ACTIVO'.
const normal = (estado: string | null | undefined) => (estado ?? '').trim().toLowerCase();

export const esSuspendido = (estado: string | null | undefined): boolean => normal(estado).startsWith('suspend');
export const esActivo = (estado: string | null | undefined): boolean => normal(estado) === 'activo';

/** Dia calendario de `instante` en la zona de operacion, como 'AAAA-MM-DD'. */
export function diaEnZona(instante: Date, zona: string = ZONA_OPERACION): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

/** `fecha_suspension` es DATE: Prisma la entrega como medianoche UTC de ese dia. */
export const diaDeFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

export interface ContratoParaCorte {
  estado: string | null;
  fecha_suspension: Date | null;
}

export interface RegistroCorte {
  accion: string;
  fecha_hora: Date;
  /**
   * La `fecha_suspension` del contrato cuando se registro el corte (se guarda en
   * `valor_nuevo`). Si es la misma de hoy, el corte es de ESTA suspension, sin
   * importar la hora: G8 puede fechar en UTC y, de noche, eso ya es el dia
   * siguiente en Chile.
   */
  fecha_suspension?: string | null;
}

/**
 * Que le falta a un contrato, dado el ultimo CORTE/REACTIVACION registrado.
 *
 * Solo se reactiva un contrato que G8 volvio a dejar ACTIVO: uno dado de baja
 * va por el retiro, no por la reactivacion. Si G8 vuelve a suspender despues
 * de un corte viejo, cambia `fecha_suspension` y el contrato vuelve a "por
 * cortar".
 */
export function clasificarContrato(c: ContratoParaCorte, ultimo: RegistroCorte | null): EstadoCorte {
  if (esSuspendido(c.estado)) {
    if (!ultimo || ultimo.accion !== ACCION_CORTE) return 'POR_CORTAR';
    if (!c.fecha_suspension) return 'AL_DIA';
    const suspension = diaDeFecha(c.fecha_suspension);
    if (ultimo.fecha_suspension === suspension) return 'AL_DIA';
    return diaEnZona(ultimo.fecha_hora) < suspension ? 'POR_CORTAR' : 'AL_DIA';
  }
  if (esActivo(c.estado) && ultimo?.accion === ACCION_CORTE) return 'POR_REACTIVAR';
  return 'AL_DIA';
}
