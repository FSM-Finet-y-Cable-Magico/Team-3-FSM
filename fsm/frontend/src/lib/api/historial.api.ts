import { PUBLIC_API_URL as API_URL } from '$env/static/public';

export interface HistorialFalla {
  id_ot: number;
  tipo_ot: string;
  estado: string;
  prioridad: string;
  fecha_creacion: string;
  fecha_completada?: string | null;
  potencia_optica_dbm?: number | null;
  observaciones?: string | null;
  resuelto_remotamente: boolean;
  fotos: { url_cloudinary: string; formato: string }[];
  materiales: { cantidad: number; tipo_equipo: { nombre: string; categoria?: string | null } | null }[];
  categoria_falla?: { id_categoria: number; nombre: string; sla_horas?: number | null } | null;
  categoria_falla_otro?: string | null;
  llamada?: { resultado: string; observaciones?: string | null } | null;
}

export interface CategoriaFrecuente {
  id_categoria: number;
  nombre: string;
  sla_horas?: number | null;
}

export interface Estadisticas {
  total_reparaciones: number;
  reparaciones_completadas: number;
  tiempo_promedio_dias: number | null;
  potencia_promedio_dbm: number | null;
}

export interface HistorialFallasResponse {
  historial: HistorialFalla[];
  categoria_frecuente: CategoriaFrecuente | null;
  estadisticas: Estadisticas;
}

export async function obtenerHistorialFallas(
  token: string,
  id_cliente: number,
): Promise<HistorialFallasResponse> {
  const res = await fetch(`${API_URL}/api/ordenes/historial-fallas/${id_cliente}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error al obtener historial');
  }
  return res.json();
}
