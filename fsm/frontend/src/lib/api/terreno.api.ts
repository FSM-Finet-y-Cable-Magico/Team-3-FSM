import { API_URL } from './config.js';


export interface MaterialDisponible {
  id_tipo_equipo: number;
  nombre: string;
  categoria?: string | null;
  requiere_serie_individual: boolean;
  stock: { cantidad_disponible: number; umbral_minimo?: number | null } | null;
}

/**
 * Acciones y diagnosticos que sirve el backend.
 *
 * No se copian los literales aca: G1 los compara con tildes, y una copia en la
 * Vista se desincroniza sin que nadie se entere hasta que G1 rechaza el cierre.
 */
export interface AccionEquipoOpcion {
  accion: string;
  /** Si es true, el formulario exige diagnostico. */
  es_retiro: boolean;
  /** A que estado lo mueve G1. Se muestra para que el tecnico sepa que implica. */
  estado_g1: string;
}

export interface OpcionesEquipo {
  acciones: AccionEquipoOpcion[];
  diagnosticos: string[];
  diagnostico_por_defecto: string;
}

/** Un equipo individualizable declarado en el cierre (acuerdo G1: va por serie). */
export interface EquipoOt {
  numero_serie: string;
  accion: string;
  diagnostico?: string;
  motivo?: string;
  observacion_estado_fisico?: string;
}

export interface CerrarOTDto {
  fotos: { url_cloudinary: string; formato: string; tamano_kb: number }[];
  materiales: { id_tipo_equipo: number; cantidad: number; numero_serie?: string }[];
  potencia_optica_dbm: number;
  resultado_llamada: 'CONFORME' | 'NO_CONFORME';
  obs_llamada?: string;
  resuelto_remotamente?: boolean;
  id_categoria_falla?: number;
  categoria_falla_otro?: string;
  /** G1 los pasa a "Instalado en cliente". */
  equipos_instalados?: EquipoOt[];
  /** G1 aplica la transicion segun `accion` (bodega, revision o baja). */
  equipos_retirados?: EquipoOt[];
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

export async function obtenerMateriales(token: string): Promise<MaterialDisponible[]> {
  return fetchApi(token, `${API_URL}/api/ordenes/materiales`);
}

export async function obtenerOpcionesEquipo(token: string): Promise<OpcionesEquipo> {
  return fetchApi(token, `${API_URL}/api/ordenes/acciones-equipo`);
}

export async function cerrarOT(token: string, id_ot: number, dto: CerrarOTDto): Promise<Record<string, unknown>> {
  return fetchApi(token, `${API_URL}/api/ordenes/${id_ot}/cerrar`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function subirFoto(
  token: string,
  id_ot: number,
  file: File,
  signal?: AbortSignal,
): Promise<{ url_cloudinary: string; formato: string; tamano_kb: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_URL}/api/ordenes/${id_ot}/foto`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
    signal,
  });
  if (res.status >= 400) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error al subir foto');
  }
  return res.json();
}
