const API_URL = 'http://localhost:3000';


export interface MaterialDisponible {
  id_tipo_equipo: number;
  nombre: string;
  categoria?: string | null;
  requiere_serie_individual: boolean;
  stock: { cantidad_disponible: number; umbral_minimo?: number | null } | null;
}

export interface CerrarOTDto {
  fotos: { url_cloudinary: string; formato: string; tamano_kb: number }[];
  materiales: { id_tipo_equipo: number; cantidad: number; numero_serie?: string }[];
  potencia_optica_dbm: number;
  resultado_llamada: 'CONFORME' | 'NO_CONFORME';
  obs_llamada?: string;
  resuelto_remotamente?: boolean;
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

export async function cerrarOT(token: string, id_ot: number, dto: CerrarOTDto): Promise<Record<string, unknown>> {
  return fetchApi(token, `${API_URL}/api/ordenes/${id_ot}/cerrar`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function subirFotoCloudinary(
  file: File,
  cloudName: string,
  uploadPreset: string,
): Promise<{ url: string; formato: string; tamano_kb: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error?.message || 'Error al subir foto a Cloudinary');
  }
  const data = await res.json();
  return {
    url: data.secure_url,
    formato: data.format,
    tamano_kb: Math.round(data.bytes / 1024),
  };
}
