import { API_URL } from './config.js';

/** Alertas del monitoreo de red (CU-13 / CU-15 / CU-17 / CU-52 / CU-53). */

export interface Alerta {
  id_alerta: number;
  tipo: string;
  severidad: string | null;
  mensaje: string | null;
  clave_caja: string | null;
  id_caja_nap: number | null;
  /** Clientes que cubre la alerta. 1 en las individuales. */
  afectados: number;
  resuelta: boolean;
  creada_en: string;
  resuelta_en: string | null;
  observacion_resolucion: string | null;
  registro: {
    numero_serie: string;
    zona: string | null;
    nombre_cliente_ext: string | null;
    direccion_cliente_ext: string | null;
  } | null;
  caja: { identificador_unico: string | null; latitud: string | null; longitud: string | null } | null;
  cliente: { id_cliente: number; nombre_completo: string; rut: string | null } | null;
}

export interface ResumenAlertas {
  total_abiertas: number;
  por_tipo: Record<string, number>;
}

async function pedir<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (res.status >= 400) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error en la solicitud');
  }
  return res.json();
}

export function obtenerResumenAlertas(token: string) {
  return pedir<ResumenAlertas>(token, `${API_URL}/api/monitoreo/alertas/resumen`);
}

export interface Facetas {
  zonas: { valor: string; n: number }[];
  cajas: { valor: string; n: number }[];
}

export function obtenerFacetas(token: string) {
  return pedir<Facetas>(token, `${API_URL}/api/monitoreo/alertas/facetas`);
}

export function listarAlertas(
  token: string,
  opts?: { tipo?: string; resueltas?: boolean; limit?: number; zona?: string; caja?: string },
) {
  const p = new URLSearchParams();
  if (opts?.tipo) p.set('tipo', opts.tipo);
  if (opts?.resueltas) p.set('resueltas', 'true');
  if (opts?.limit) p.set('limit', String(opts.limit));
  if (opts?.zona) p.set('zona', opts.zona);
  if (opts?.caja) p.set('caja', opts.caja);
  const qs = p.toString();
  return pedir<Alerta[]>(token, `${API_URL}/api/monitoreo/alertas${qs ? '?' + qs : ''}`);
}

export interface Afectado {
  numero_serie: string;
  cliente: string | null;
  rut: string | null;
  telefono: string | null;
  direccion: string | null;
  zona: string | null;
  caja: string | null;
  estado: string | null;
  potencia_dbm: number | null;
  potencia_fuera_de_rango: boolean;
  degradandose: boolean;
  horas_asi: number | null;
  /** Equipo de un cliente dado de baja: no es parte del incidente. */
  inactiva: boolean;
}

export interface DetalleAlerta {
  alerta: Alerta;
  total: number;
  caidos: number;
  degradados: number;
  afectados: Afectado[];
}

export function detalleAlerta(token: string, id: number) {
  return pedir<DetalleAlerta>(token, `${API_URL}/api/monitoreo/alertas/${id}/detalle`);
}

export function revisarAlerta(token: string, id: number, observacion?: string) {
  return pedir<Alerta>(token, `${API_URL}/api/monitoreo/alertas/${id}/revisar`, {
    method: 'PATCH',
    body: JSON.stringify({ observacion }),
  });
}

export function evaluarAlertas(token: string) {
  return pedir<{ creadas: number; ya_abiertas: number; cerradas_automaticamente: number }>(
    token,
    `${API_URL}/api/monitoreo/alertas/evaluar`,
    { method: 'POST' },
  );
}
