import { API_URL } from './config.js';
import { pedirJson, pedirCrudo } from './http.js';
import { nombreDe } from './reportes.api.js';

/** CU-41: consulta del log de auditoria. */

export interface EventoAuditoria {
  /** BigInt en la base: viaja como string. */
  id_log: string;
  id_usuario: number | null;
  usuario: string | null;
  accion: string;
  entidad_afectada: string | null;
  id_entidad_afectada: number | null;
  valor_anterior: unknown;
  valor_nuevo: unknown;
  fecha_hora: string;
}

export interface FiltrosAuditoria {
  id_usuario?: string;
  tipo?: string;
  accion?: string;
  entidad?: string;
  desde?: string;
  hasta?: string;
  page?: number;
}

function qs(f: FiltrosAuditoria): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}

export function buscarAuditoria(
  token: string,
  f: FiltrosAuditoria,
): Promise<{ data: EventoAuditoria[]; total: number; page: number; limit: number }> {
  return pedirJson(token, `${API_URL}/api/auditoria${qs(f)}`, undefined, 'Error al consultar la auditoría');
}

export function accionesAuditoria(token: string): Promise<string[]> {
  return pedirJson(token, `${API_URL}/api/auditoria/acciones`, undefined, 'Error al cargar las acciones');
}

/**
 * Descarga el log filtrado en Excel. Igual que los reportes: el endpoint exige
 * el token en la cabecera, asi que se baja con fetch y se descarga desde un
 * blob, liberando siempre el object URL.
 */
export async function exportarAuditoria(token: string, f: FiltrosAuditoria) {
  const { page: _pagina, ...filtros } = f;
  const res = await pedirCrudo(token, `${API_URL}/api/auditoria/exportar${qs(filtros)}`, undefined, 'No se pudo generar el archivo');
  const url = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreDe(res) ?? 'auditoria.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
