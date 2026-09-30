import { API_URL } from './config.js';
import { pedirJson } from './http.js';

export interface ClienteFicha {
  id_cliente: number;
  rut: string;
  nombre_completo: string;
  email?: string;
  telefono?: string;
  estado: string;
  es_conflictivo: boolean;
  obs_conflictivo?: string;
  /** MOD RF-32: semaforo de riesgo. El motivo es obs_conflictivo. */
  nivel_riesgo?: import('$lib/utils/riesgo').NivelRiesgo;
  /**
   * RF-53. El catalogo de zonas es del Grupo 2 (D-02); mientras no lo exponga,
   * la zona sale de la ONT (MONITOREO) o de la caja del puerto (CAJA_NAP).
   */
  zona?: { nombre: string; origen: 'MONITOREO' | 'CAJA_NAP' } | null;
  fecha_creacion: string;
  direccion_principal?: {
    direccion_completa: string;
    comuna: string;
    ciudad?: string;
  };
  contratos_activos?: Array<{
    id_contrato: number;
    fecha_inicio: string;
    estado: string;
    plan: {
      nombre_comercial: string;
      precio_mensual: number;
      velocidad_mbps: number | null;
    } | null;
  }>;
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
    /** Momento de evaluacion: la ventana es [desde, hasta]. */
    hasta: string;
    /** RF-08 pide la lista de OT asociadas, no solo el total. */
    ots: { id_ot: number; fecha_completada: string | null; categoria_falla: string | null }[];
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

/** Delega en el envoltorio compartido, que ademas cierra la sesion en un 401. */
async function fetchApi<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  return pedirJson<T>(token, url, init, 'Error en la solicitud');
}

export async function buscarPorRut(token: string, rut: string): Promise<ClienteConHistorial> {
  return fetchApi(token, `${API_URL}/api/clientes/rut/${rut}`);
}

export async function registrarCliente(token: string, dto: Record<string, unknown>): Promise<ClienteFicha> {
  return fetchApi(token, `${API_URL}/api/clientes`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function editarCliente(token: string, id: number, dto: Record<string, unknown>): Promise<ClienteFicha> {
  return fetchApi(token, `${API_URL}/api/clientes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

/** MOD RF-32: cambiar el nivel del semaforo. AMARILLO y ROJO exigen motivo. */
export async function cambiarNivelRiesgo(
  token: string,
  id: number,
  nivel: import('$lib/utils/riesgo').NivelRiesgo,
  motivo?: string,
): Promise<{ id_cliente: number; nivel_riesgo: string; motivo: string | null }> {
  return fetchApi(token, `${API_URL}/api/clientes/${id}/riesgo`, {
    method: 'PATCH',
    body: JSON.stringify(motivo ? { nivel, motivo } : { nivel }),
  });
}

/** CU-25: lo que muestra el formulario de baja. */
export interface ResumenBaja {
  id_cliente: number;
  nombre_completo: string;
  rut: string | null;
  estado: string;
  direccion: string | null;
  onts: string[];
  puertos: { id_puerto: number; numero_puerto: number | null; id_caja_nap: number | null; caja: string | null }[];
  motivos: string[];
}

export async function resumenBaja(token: string, id: number): Promise<ResumenBaja> {
  return fetchApi(token, `${API_URL}/api/clientes/${id}/baja`);
}

export async function darDeBaja(
  token: string,
  id: number,
  dto: { motivo: string; confirma_sin_deuda: boolean; observaciones?: string },
): Promise<{ id_cliente: number; estado: string; ot_baja_puerto: number; ot_baja_equipo: number }> {
  return fetchApi(token, `${API_URL}/api/clientes/${id}/baja`, { method: 'POST', body: JSON.stringify(dto) });
}

/** CU-07: un cliente asociado a la direccion buscada. */
export interface ClienteEnDireccion {
  id_cliente: number;
  rut: string | null;
  nombre_completo: string;
  estado: string;
  direccion: string;
  /** false: es una direccion anterior del cliente. */
  actual: boolean;
}

export async function buscarPorDireccion(
  token: string,
  q: { calle: string; numero: string; comuna: string },
): Promise<ClienteEnDireccion[]> {
  const p = new URLSearchParams(q);
  return fetchApi(token, `${API_URL}/api/clientes/por-direccion?${p.toString()}`);
}

/** CU-35: lista roja por RUT (bloquea) y por direccion (advierte). */
export async function verificarListaRoja(
  token: string,
  q: { rut?: string; direccion_completa?: string; comuna?: string },
): Promise<{ vetado: { motivo: string } | null; mensaje: string | null; advertencia: string | null }> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  return fetchApi(token, `${API_URL}/api/clientes/lista-roja/verificar?${p.toString()}`);
}

export async function marcarConflictivo(token: string, id: number, motivo: string): Promise<void> {
  return fetchApi(token, `${API_URL}/api/clientes/${id}/conflictivo`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });
}

export async function listarClientes(
  token: string,
  page: number = 1,
  limit: number = 20,
  filtros?: { nombre?: string; rut?: string; telefono?: string; direccion?: string; zona?: string },
): Promise<ClientesPaginados> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filtros?.nombre) params.set('nombre', filtros.nombre);
  if (filtros?.rut) params.set('rut', filtros.rut);
  if (filtros?.telefono) params.set('telefono', filtros.telefono);
  if (filtros?.direccion) params.set('direccion', filtros.direccion);
  if (filtros?.zona) params.set('zona', filtros.zona);
  return fetchApi(token, `${API_URL}/api/clientes?${params.toString()}`);
}

export async function listarPlanes(token: string): Promise<PlanResumen[]> {
  return fetchApi(token, `${API_URL}/api/clientes/planes`);
}
