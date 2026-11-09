import { API_URL } from './config.js';
import { pedirJson } from './http.js';

/** Cambio de clave WiFi pedido desde el portal de G2 (acuerdo §6.4). */

export interface SolicitudClaveWifi {
  id_solicitud: number;
  id_contrato: number;
  estado: 'PENDIENTE' | 'ENTREGADA' | string;
  fecha_creacion: string;
  leida_en: string | null;
}

export interface ClaveEntregada {
  id_solicitud: number;
  id_ticket: string;
  id_contrato: number;
  clave: string;
}

const pedir = <T>(token: string, url: string, init?: RequestInit) =>
  pedirJson<T>(token, url, init, 'Error en la solicitud de clave WiFi');

/** Solo metadatos: la clave no viaja en el listado. */
export function listarSolicitudesWifi(token: string, idTicket: number): Promise<SolicitudClaveWifi[]> {
  return pedir(token, `${API_URL}/api/clave-wifi/ticket/${idTicket}`);
}

/** Devuelve la clave en claro y la deja marcada como entregada: no se puede repetir. */
export function entregarClaveWifi(token: string, idSolicitud: number): Promise<ClaveEntregada> {
  return pedir(token, `${API_URL}/api/clave-wifi/${idSolicitud}/entregar`, { method: 'POST' });
}
