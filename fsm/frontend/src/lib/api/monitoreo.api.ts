import { API_URL } from './config.js';

// ARCHIVO DE PRUEBA — soporta la vista /monitoreo-prueba (ver nota en esa
// página). No corresponde a ningún CU del catálogo oficial; se borra junto
// con la vista una vez corroborada.

export interface ResumenMonitoreo {
  total_ont: number;
  por_estado: Record<string, number>;
  potencia_fuera_de_rango: number;
  fecha_actualizacion: string;
}

export interface OntVista {
  numero_serie: string;
  id_unidad: number | null;
  id_cliente: number | null;
  zona: string | null;
  olt_externo: string | null;
  nombre_cliente_ext: string | null;
  estado_conexion: string | null;
  potencia_actual_dbm: number | null;
  potencia_fuera_de_rango: boolean;
}

export async function obtenerResumenMonitoreo(token: string): Promise<ResumenMonitoreo> {
  const res = await fetch(`${API_URL}/api/monitoreo/resumen`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error al obtener el resumen de monitoreo');
  }
  return res.json();
}

export async function listarOnt(token: string, page = 1, limit = 100): Promise<OntVista[]> {
  const res = await fetch(`${API_URL}/api/monitoreo/ont?page=${page}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error al listar ONT');
  }
  return res.json();
}
