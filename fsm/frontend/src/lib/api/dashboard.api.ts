const API_URL = 'http://localhost:3000';

export interface IndicadoresDashboard {
  ot_por_estado: {
    PENDIENTE: number;
    ASIGNADA: number;
    EN_CURSO: number;
    COMPLETADA: number;
    CANCELADA: number;
  };
  ot_criticas_activas: number;
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
  fecha_actualizacion: string;
}

export interface Empresa {
  id_empresa: number;
  nombre: string;
  rut_empresa: string | null;
}

export async function obtenerIndicadores(token: string, id_empresa?: number): Promise<IndicadoresDashboard> {
  const params = id_empresa ? `?empresa=${id_empresa}` : '';
  const res = await fetch(`${API_URL}/api/dashboard${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error al obtener indicadores');
  }
  return res.json();
}

export async function listarEmpresas(token: string): Promise<Empresa[]> {
  const res = await fetch(`${API_URL}/api/dashboard/empresas`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error al listar empresas');
  }
  return res.json();
}

export async function obtenerDatosEmpresa(token: string, id_empresa: number): Promise<{ empresa: unknown; total_clientes: number; ot_activas: number }> {
  const res = await fetch(`${API_URL}/api/dashboard/empresa/${id_empresa}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    const data = await res.json();
    throw new Error(data.message || 'Error al obtener datos de empresa');
  }
  return res.json();
}
