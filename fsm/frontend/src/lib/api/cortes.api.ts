import { API_URL } from './config.js';
import { pedirJson } from './http.js';

/** Cortes y reactivaciones por morosidad: G8 suspende, FiNet corta a mano en SmartOLT, el FSM registra. */

export interface FilaCorte {
  id_contrato: number;
  estado_contrato: string;
  fecha_suspension: string | null;
  plan: string | null;
  cliente: { id_cliente: number; nombre_completo: string; rut: string | null; telefono: string | null } | null;
  direccion: { direccion_completa: string; comuna: string } | null;
  onts: {
    numero_serie: string;
    estado_conexion: string | null;
    odb: string | null;
    odb_puerto: number | null;
    olt_externo: string | null;
    board: number | null;
    puerto_pon: number | null;
  }[];
  ultimo_registro: { accion: string; fecha_hora: string } | null;
}

export interface RegistroCorte {
  id_log: number;
  accion: string;
  fecha_hora: string;
  usuario: string | null;
  id_contrato: number;
  cliente: string | null;
  observacion: string | null;
}

export interface PanelCortes {
  por_cortar: FilaCorte[];
  por_reactivar: FilaCorte[];
  historial: RegistroCorte[];
}

export function listarCortes(token: string): Promise<PanelCortes> {
  return pedirJson(token, `${API_URL}/api/cortes`, undefined, 'No se pudo cargar el panel de cortes');
}

export function registrarCorte(token: string, id_contrato: number, accion: 'CORTE' | 'REACTIVACION', observacion?: string) {
  return pedirJson(
    token,
    `${API_URL}/api/cortes/${id_contrato}/hecho`,
    { method: 'POST', body: JSON.stringify({ accion, ...(observacion?.trim() ? { observacion: observacion.trim() } : {}) }) },
    'No se pudo registrar',
  );
}
