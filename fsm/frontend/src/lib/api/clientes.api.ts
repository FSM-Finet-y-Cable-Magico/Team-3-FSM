const PUBLIC_API_URL = 'http://localhost:3000';

export interface ClienteFicha {
  id_cliente: number;
  rut: string;
  nombre_completo: string;
  email?: string;
  telefono?: string;
  estado: string;
  es_conflictivo: boolean;
  obs_conflictivo?: string;
  fecha_creacion: string;
  direccion_principal?: {
    direccion_completa: string;
    comuna: string;
    ciudad?: string;
  };
  contrato_activo?: {
    id_contrato: number;
    plan: { nombre_comercial: string; velocidad_mbps: number };
  };
  unidad_instalada?: {
    numero_serie: string;
    modelo: string;
    estado: string;
  };
}

export interface HistorialOT {
  id_ot: number;
  tipo_ot: string;
  estado: string;
  prioridad: string;
  fecha_creacion: string;
  fecha_completada?: string;
}

export interface ClienteConHistorial {
  cliente: ClienteFicha;
  historial_ot: HistorialOT[];
  alerta_reparaciones_30_dias?: {
    activa: boolean;
    total_reparaciones_30_dias: number;
    desde: string;
  };
}

export interface PlanResumen {
  id_plan: number;
  nombre_comercial: string;
  velocidad_mbps: number;
  precio_mensual: number;
}

interface ClientesPaginados {
  data: ClienteFicha[];
  total: number;
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

  //return res.json(); provoca error de respuestas vacias
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return null;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function buscarPorRut(token: string, rut: string): Promise<ClienteConHistorial> {
  return fetchApi(token, `${PUBLIC_API_URL}/api/clientes/rut/${rut}`);
}

export async function registrarCliente(token: string, dto: Record<string, unknown>): Promise<ClienteFicha> {
  return fetchApi(token, `${PUBLIC_API_URL}/api/clientes`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function editarCliente(token: string, id: number, dto: Record<string, unknown>): Promise<ClienteFicha> {
  return fetchApi(token, `${PUBLIC_API_URL}/api/clientes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function marcarConflictivo(token: string, id: number, motivo: string): Promise<void> {
  return fetchApi(token, `${PUBLIC_API_URL}/api/clientes/${id}/conflictivo`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}

export async function listarClientes(
  token: string,
  page: number = 1,
  limit: number = 20,
): Promise<ClientesPaginados> {
  return fetchApi(token, `${PUBLIC_API_URL}/api/clientes?page=${page}&limit=${limit}`);
}

export async function listarPlanes(token: string): Promise<PlanResumen[]> {
  return fetchApi(token, `${PUBLIC_API_URL}/api/clientes/planes`);
}
