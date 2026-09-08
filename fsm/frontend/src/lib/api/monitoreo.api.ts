import { API_URL } from './config.js';

/** Monitoreo de red en vivo (CU-12 / RF-10) y criticos por caja (CU-15 / RF-13). */

export interface ResumenMonitoreo {
  total_ont: number;
  /** ONLINE / OFFLINE / LOS / DESCONOCIDO. */
  por_estado: Record<string, number>;
  potencia_fuera_de_rango: number;
  fecha_actualizacion: string;
}

export interface LecturaOnt {
  numero_serie: string;
  id_unidad: number | null;
  id_cliente: number | null;
  zona: string | null;
  olt_externo: string | null;
  nombre_cliente_ext: string | null;
  estado_conexion: string | null;
  potencia_actual_dbm: number | null;
  potencia_fuera_de_rango: boolean;
  medido_en: string | null;
}

export interface CajaCritica {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  latitud: string | null;
  longitud: string | null;
  clientes_en_la_caja: number;
  criticos: number;
  sin_senal: number;
  potencia_fuera_de_rango: number;
  /** Que porcentaje de la caja esta afectado. Decide cuadrilla vs. visitas. */
  pct_afectado: number;
}

export interface CriticosPorCaja {
  cajas: CajaCritica[];
  totales: {
    cajas_afectadas: number;
    clientes_criticos: number;
    /** Criticos sin caja resuelta: se muestran aparte para que el total cuadre. */
    criticos_sin_caja: number;
  };
}

/** Lo que publica el gateway `/monitoreo` cuando entra una lectura nueva. */
export interface ActualizacionMonitoreo {
  tipo: 'LECTURAS_INGESTADAS' | 'ALERTAS_EVALUADAS';
  leidas?: number;
  cambios_estado?: number;
  alertas_abiertas?: number;
  medido_en: string;
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

export function obtenerResumenMonitoreo(token: string) {
  return pedir<ResumenMonitoreo>(token, `${API_URL}/api/monitoreo/resumen`);
}

/**
 * Tope que acepta el backend (`ConsultaLecturasDto`). Se pide todo de una:
 * la pantalla ordena por gravedad en el navegador, y el backend pagina por
 * numero de serie, asi que una pagina seria un corte alfabetico que dejaria
 * fuera justo las ONT con problema.
 */
export const TOPE_PADRON = 2000;

export function listarLecturas(token: string, limit = TOPE_PADRON) {
  return pedir<LecturaOnt[]>(token, `${API_URL}/api/monitoreo/ont?page=1&limit=${limit}`);
}

export function criticosPorCaja(token: string, zona?: string) {
  const qs = zona ? `?zona=${encodeURIComponent(zona)}` : '';
  return pedir<CriticosPorCaja>(token, `${API_URL}/api/monitoreo/criticos-por-caja${qs}`);
}
