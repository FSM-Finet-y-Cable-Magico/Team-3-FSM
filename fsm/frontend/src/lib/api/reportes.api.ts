import { API_URL } from './config.js';

/** Reportería (RF-38, RF-39, RF-40, RF-41). */

export interface SeccionConteo {
  etiqueta: string;
  cantidad: number;
  pct?: number;
}

export interface FilaTecnico {
  id_tecnico: number | null;
  tecnico: string;
  completadas: number;
  /** Null, no cero: sin OT cerradas no hay un promedio. */
  tiempo_promedio_horas: number | null;
}

export interface FilaMaterial {
  material: string;
  cantidad: number;
  por_tecnico: { tecnico: string; cantidad: number }[];
}

export interface Reporte {
  empresa: { id_empresa: number; nombre: string | null };
  periodo: { desde: string; hasta: string; etiqueta: string };
  filtros: { id_tecnico?: number };
  generado_en: string;
  totales: {
    ot_completadas: number;
    instalaciones: number;
    reparaciones: number;
    otras: number;
    canceladas: number;
  };
  fallas_por_categoria: SeccionConteo[];
  por_tecnico: FilaTecnico[];
  materiales: FilaMaterial[];
  /** Solo en los periódicos (RF-39). */
  instalaciones_por_plan?: SeccionConteo[];
  /** Solo en los periódicos (RF-39). */
  clientes_recurrentes?: { id_cliente: number; cliente: string; reparaciones: number; ots: number[] }[];
}

export interface MetricaComparada {
  metrica: string;
  valores: { id_empresa: number; empresa: string | null; valor: number | null }[];
  mas_es_mejor: boolean;
  unidad?: string;
}

export interface ReporteComparativo {
  periodo: { desde: string; hasta: string; etiqueta: string };
  generado_en: string;
  reportes: Reporte[];
  comparacion: MetricaComparada[];
}

export type TipoReporte = 'diario' | 'on-demand' | 'semanal' | 'mensual' | 'comparativo';
export type Formato = 'pdf' | 'xlsx';

async function pedir<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status >= 400) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'No se pudo generar el reporte');
  }
  return res.json();
}

/** Arma la query de cada tipo. Se comparte con la descarga para no divergir. */
function ruta(tipo: TipoReporte, p: { desde?: string; hasta?: string; fecha?: string; id_tecnico?: number }) {
  const q = new URLSearchParams();
  if (p.id_tecnico) q.set('id_tecnico', String(p.id_tecnico));

  if (tipo === 'diario') {
    if (p.fecha) q.set('fecha', p.fecha);
    return `/reportes/diario?${q}`;
  }
  if (tipo === 'semanal' || tipo === 'mensual') {
    q.set('tipo', tipo);
    if (p.fecha) q.set('fecha', p.fecha);
    return `/reportes/periodico?${q}`;
  }
  q.set('desde', p.desde ?? '');
  q.set('hasta', p.hasta ?? '');
  return `/reportes/${tipo === 'comparativo' ? 'comparativo' : 'on-demand'}?${q}`;
}

export function generar(
  token: string,
  tipo: TipoReporte,
  p: { desde?: string; hasta?: string; fecha?: string; id_tecnico?: number },
) {
  return pedir<Reporte>(token, `${API_URL}/api${ruta(tipo, p)}`);
}

export function generarComparativo(token: string, p: { desde: string; hasta: string }) {
  return pedir<ReporteComparativo>(token, `${API_URL}/api${ruta('comparativo', p)}`);
}

/**
 * RF-40: descarga el reporte en PDF o Excel.
 *
 * No se puede usar un `<a href>` a secas: el endpoint exige el token en la
 * cabecera y un enlace no la manda. Asi que se baja el archivo con fetch y se
 * dispara la descarga desde un blob.
 *
 * El object URL se libera SIEMPRE, tambien si algo falla en el medio: son
 * archivos de varios MB y cada uno que no se libera se queda en memoria hasta
 * que se recargue la pagina.
 */
export async function descargar(
  token: string,
  tipo: TipoReporte,
  formato: Formato,
  p: { desde?: string; hasta?: string; fecha?: string; id_tecnico?: number },
) {
  const q = ruta(tipo, p);
  const res = await fetch(`${API_URL}/api${q}${q.includes('?') ? '&' : '?'}formato=${formato}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status >= 400) {
    // El error viene en JSON aunque se haya pedido un archivo.
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'No se pudo generar el archivo. Inténtalo nuevamente en unos minutos.');
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreDe(res) ?? `reporte.${formato}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saca el nombre que fija el backend, para no reconstruirlo distinto acá. */
function nombreDe(res: Response): string | null {
  const cd = res.headers.get('content-disposition');
  if (!cd) return null;
  // `filename*` va primero: es el que conserva las tildes.
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (utf8) return decodeURIComponent(utf8[1].trim());
  const simple = /filename="([^"]+)"/i.exec(cd);
  return simple ? simple[1] : null;
}
