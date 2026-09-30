import { API_URL } from './config.js';
import { pedirJson } from './http.js';

/** Tickets de soporte (CU-29, CU-30, CU-32). */

export type EstadoTicket = 'ABIERTO' | 'EN_PROGRESO' | 'DERIVADO_OT' | 'RESUELTO';

/** Canales que registra el jefe tecnico. Los digitales entran por integracion. */
export const ORIGENES_INTERNOS = [
  { valor: 'TELEFONO', etiqueta: 'Teléfono' },
  { valor: 'PRESENCIAL', etiqueta: 'En persona' },
  { valor: 'CORREO', etiqueta: 'Correo' },
] as const;

export interface Ticket {
  id_ticket: number;
  id_cliente: number | null;
  id_categoria: number;
  codigo_seguimiento: string;
  prioridad: string;
  estado: EstadoTicket;
  descripcion: string | null;
  fecha_creacion: string;
  fecha_cierre: string | null;
  origen: string | null;
  resuelto_remotamente: boolean;
  id_usuario_asignado: number | null;
  categoria: { id_categoria: number; nombre: string; sla_horas: number | null };
  cliente: { id_cliente: number; rut: string | null; nombre_completo: string; telefono: string | null } | null;
  usuario_asignado: { id_usuario: number; nombre_completo: string } | null;
  orden_trabajo: { id_ot: number; estado: string } | null;
  sla_horas: number | null;
  vence_en: string | null;
  /** CU-30, excepcion 1: SLA vencido sin accion, se marca en rojo. */
  sla_vencido: boolean;
  horas_transcurridas: number;
}

export interface EntradaHistorial {
  accion: string;
  valor_anterior: Record<string, unknown> | null;
  valor_nuevo: Record<string, unknown> | null;
  fecha_hora: string;
  usuario: { nombre_completo: string } | null;
}

export type DetalleTicket = Ticket & { historial: EntradaHistorial[] };

const pedir = <T>(token: string, url: string, init?: RequestInit) =>
  pedirJson<T>(token, url, init, 'Error en la solicitud de tickets');

export function listarTickets(
  token: string,
  filtros: { estado?: string; prioridad?: string; page?: number; limit?: number } = {},
): Promise<{ data: Ticket[]; total: number; page: number; limit: number }> {
  const p = new URLSearchParams();
  if (filtros.estado) p.set('estado', filtros.estado);
  if (filtros.prioridad) p.set('prioridad', filtros.prioridad);
  if (filtros.page) p.set('page', String(filtros.page));
  if (filtros.limit) p.set('limit', String(filtros.limit));
  const qs = p.toString();
  return pedir(token, `${API_URL}/api/tickets${qs ? '?' + qs : ''}`);
}

export function obtenerTicket(token: string, id: number): Promise<DetalleTicket> {
  return pedir(token, `${API_URL}/api/tickets/${id}`);
}

export function crearTicket(
  token: string,
  dto: { rut_cliente: string; id_categoria: number; origen: string; descripcion?: string },
): Promise<DetalleTicket> {
  return pedir(token, `${API_URL}/api/tickets`, { method: 'POST', body: JSON.stringify(dto) });
}

export function tomarTicket(token: string, id: number): Promise<DetalleTicket> {
  return pedir(token, `${API_URL}/api/tickets/${id}/tomar`, { method: 'PATCH' });
}

export function resolverTicket(token: string, id: number, observacion: string): Promise<DetalleTicket> {
  return pedir(token, `${API_URL}/api/tickets/${id}/resolver`, { method: 'PATCH', body: JSON.stringify({ observacion }) });
}

export function reclasificarTicket(token: string, id: number, id_categoria: number): Promise<DetalleTicket> {
  return pedir(token, `${API_URL}/api/tickets/${id}/reclasificar`, {
    method: 'PATCH',
    body: JSON.stringify({ id_categoria }),
  });
}

export function escalarTicket(
  token: string,
  id: number,
  dto: { tipo_ot?: string; id_tecnico?: number; observaciones?: string },
): Promise<DetalleTicket> {
  return pedir(token, `${API_URL}/api/tickets/${id}/escalar`, { method: 'POST', body: JSON.stringify(dto) });
}
