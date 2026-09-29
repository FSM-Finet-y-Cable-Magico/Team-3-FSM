import { API_URL } from './config.js';
import { pedirJson } from './http.js';

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
  /** Puertos que declara la caja, para contrastar con lo que hay registrado. */
  capacidad_puertos: number | null;
  /**
   * Menos de 5 ONT registradas: el "100%" de esa caja habla de lo poco que se
   * sabe de ella, no de la caja entera. Mismo umbral con el que CU-17 se niega
   * a declararla caida.
   */
  padron_chico: boolean;
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

/** Delega en el envoltorio compartido, que ademas cierra la sesion en un 401. */
async function pedir<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  return pedirJson<T>(token, url, init, 'Error en la solicitud');
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

/** CU-14: una caida de la ONT, de que paso a caido hasta que volvio a ONLINE. */
export interface Interrupcion {
  desde: string;
  /** Null si sigue caida al final del periodo. */
  hasta: string | null;
  estado: string;
  minutos: number;
  en_curso: boolean;
  /** Ya estaba caida al empezar el periodo. */
  empezo_antes: boolean;
  /** Orientacion para el diagnostico, no una causa demostrada. */
  indicio: string;
}

export interface HistorialInterrupciones {
  numero_serie: string;
  nombre_cliente_ext: string | null;
  periodo: { desde: string; hasta: string };
  eventos: { evento: string | null; timestamp: string }[];
  interrupciones: Interrupcion[];
  indicadores: {
    total: number;
    cortas: number;
    largas: number;
    minutos_totales: number;
    dias_con_varias_cortas: { dia: string; cortas: number }[];
    horario_recurrente: { hora: number; dias: number }[];
  };
}

/**
 * CU-14: historial de interrupciones de una ONT. Sin periodo, el Controlador
 * devuelve los ultimos 30 dias. `desde`/`hasta` son dias YYYY-MM-DD inclusivos.
 */
export function historialInterrupciones(token: string, sn: string, periodo?: { desde: string; hasta: string }) {
  const qs = periodo ? `?desde=${periodo.desde}&hasta=${periodo.hasta}` : '';
  return pedir<HistorialInterrupciones>(
    token,
    `${API_URL}/api/monitoreo/ont/${encodeURIComponent(sn)}/interrupciones${qs}`,
  );
}
