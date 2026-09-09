import { API_URL } from './config.js';
import { pedirJson } from './http.js';

export interface IndicadoresDashboard {
  ot_por_estado: {
    PENDIENTE: number;
    PENDIENTE_CLIENTE_AUSENTE: number;
    ASIGNADA: number;
    EN_CURSO: number;
    COMPLETADA: number;
    CANCELADA: number;
  };
  ot_criticas_activas: number;
  clientes_reparacion_recurrente: number;
  tecnicos: {
    id_usuario: number;
    nombre_completo: string;
    ot_activas: number;
    en_curso: boolean;
  }[];
  ultimas_completadas: {
    id_ot: number;
    tipo_ot: string;
    cliente: { nombre_completo: string } | null;
    tecnico: { nombre_completo: string } | null;
    fecha_completada: string;
  }[];
  total_clientes_activos: number;
  resueltas_remotamente_hoy: number;
  /** RF-37, segun RF-09: OT con mas de 30 dias sin reagendar. */
  ot_sin_reagendar_30_dias: number;
  ot_completadas_hoy: number;
  tiempo_promedio_cierre: number | null;
  fecha_actualizacion: string;
}

export interface Empresa {
  id_empresa: number;
  nombre: string;
  rut_empresa: string | null;
}

export async function obtenerIndicadores(token: string, id_empresa?: number): Promise<IndicadoresDashboard> {
  const params = id_empresa ? `?empresa=${id_empresa}` : '';
  return pedirJson(token, `${API_URL}/api/dashboard${params}`, undefined, 'Error al obtener indicadores');
}

export async function listarEmpresas(token: string): Promise<Empresa[]> {
  return pedirJson(token, `${API_URL}/api/dashboard/empresas`, undefined, 'Error al listar empresas');
}

export async function obtenerDatosEmpresa(token: string, id_empresa: number): Promise<{ empresa: unknown; total_clientes: number; ot_activas: number }> {
  return pedirJson(token, `${API_URL}/api/dashboard/empresa/${id_empresa}`, undefined, 'Error al obtener datos de empresa');
}
