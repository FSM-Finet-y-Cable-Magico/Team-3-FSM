import { API_URL } from './config.js';
import { pedirJson, pedirCrudo } from './http.js';


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

/** Delega en el envoltorio compartido, que ademas cierra la sesion en un 401. */
async function fetchApi<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  return pedirJson<T>(token, url, init, 'Error en la solicitud');
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

  // `pedirCrudo` no fija Content-Type a proposito: con FormData lo pone el
  // navegador junto con el boundary, y fijarlo a mano rompe la subida.
  const res = await pedirCrudo(
    token,
    `${API_URL}/api/ordenes/${id_ot}/foto`,
    { method: 'POST', body: formData, signal },
    'Error al subir foto',
  );
  return res.json();
}
