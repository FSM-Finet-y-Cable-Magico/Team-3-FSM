import { API_URL } from './config.js';

export interface OT {
  id_ot: number;
  id_tecnico?: number;
  tipo_ot: string;
  prioridad: string;
  estado: string;
  fecha_creacion: string;
  fecha_programada?: string;
  fecha_completada?: string;
  antiguedad_dias?: number;
  observaciones?: string;
  obs_cliente_ausente?: string;
  categoria_falla_otro?: string | null;
  categoria_falla?: CategoriaFalla | null;
  cliente?: {
    id_cliente: number;
    nombre_completo: string;
    rut: string;
    es_conflictivo: boolean;
    direcciones?: { direccion_completa: string; comuna: string }[];
  };
  tecnico?: {
    id_usuario: number;
    nombre_completo: string;
    nombre_usuario: string;
  } | null;
  direccion?: { direccion_completa: string; comuna: string } | null;
  historial?: {
    id_historial_ot: number | string;
    estado_anterior?: string | null;
    estado_nuevo?: string | null;
    fecha_hora: string;
    observaciones?: string | null;
  }[];
}

export interface Tecnico {
  id_usuario: number;
  nombre_completo: string;
  nombre_usuario: string;
  ot_activas_hoy: number;
}

export interface CategoriaFalla {
  id_categoria: number;
  nombre: string;
  sla_horas: number | null;
}

async function fetchApi(token: string, url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error en la solicitud');
  }

  return res.json();
}

export async function listarOT(
  token: string,
  filtros?: { estado?: string; tipo_ot?: string; prioridad?: string; page?: number; limit?: number },
): Promise<{ data: OT[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams();
  if (filtros?.estado) params.set('estado', filtros.estado);
  if (filtros?.tipo_ot) params.set('tipo_ot', filtros.tipo_ot);
  if (filtros?.prioridad) params.set('prioridad', filtros.prioridad);
  if (filtros?.page) params.set('page', String(filtros.page));
  if (filtros?.limit) params.set('limit', String(filtros.limit));
  const qs = params.toString();
  return fetchApi(token, `${API_URL}/api/ordenes${qs ? '?' + qs : ''}`);
}

export async function obtenerOT(token: string, id: number): Promise<OT> {
  return fetchApi(token, `${API_URL}/api/ordenes/${id}`);
}

export async function crearOT(token: string, dto: Record<string, unknown>): Promise<OT> {
  return fetchApi(token, `${API_URL}/api/ordenes`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function asignarTecnico(
  token: string,
  id: number,
  dto: { id_tecnico: number; bloque_horario?: string },
): Promise<OT> {
  return fetchApi(token, `${API_URL}/api/ordenes/${id}/asignar`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function actualizarEstado(
  token: string,
  id: number,
  estado: string,
  obs_cancelacion?: string,
  obs_cliente_ausente?: string,
): Promise<OT> {
  return fetchApi(token, `${API_URL}/api/ordenes/${id}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ estado, obs_cancelacion, obs_cliente_ausente }),
  });
}

export async function listarTecnicos(token: string): Promise<Tecnico[]> {
  return fetchApi(token, `${API_URL}/api/ordenes/tecnicos`);
}

export async function listarCategoriasFalla(token: string): Promise<CategoriaFalla[]> {
  return fetchApi(token, `${API_URL}/api/ordenes/categorias-falla`);
}
