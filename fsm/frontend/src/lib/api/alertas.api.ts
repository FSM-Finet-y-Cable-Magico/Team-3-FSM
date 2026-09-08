import { API_URL } from './config.js';
import { pedirJson } from './http.js';

/** Alertas del monitoreo de red (CU-13 / CU-15 / CU-17 / CU-52 / CU-53). */

export interface Alerta {
  id_alerta: number;
  tipo: string;
  severidad: string | null;
  mensaje: string | null;
  clave_caja: string | null;
  id_caja_nap: number | null;
  /** Clientes que cubre la alerta. 1 en las individuales. */
  afectados: number;
  resuelta: boolean;
  creada_en: string;
  /** OT ya despachada desde esta alerta (CU-16 / CU-21). */
  ot_generada: { id_ot: number; tipo_ot: string; estado: string } | null;
  resuelta_en: string | null;
  observacion_resolucion: string | null;
  registro: {
    numero_serie: string;
    zona: string | null;
    nombre_cliente_ext: string | null;
    direccion_cliente_ext: string | null;
  } | null;
  caja: { identificador_unico: string | null; latitud: string | null; longitud: string | null } | null;
  cliente: { id_cliente: number; nombre_completo: string; rut: string | null } | null;
}

export interface ResumenAlertas {
  total_abiertas: number;
  por_tipo: Record<string, number>;
}

/** Delega en el envoltorio compartido, que ademas cierra la sesion en un 401. */
async function pedir<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  return pedirJson<T>(token, url, init, 'Error en la solicitud');
}

export function obtenerResumenAlertas(token: string) {
  return pedir<ResumenAlertas>(token, `${API_URL}/api/monitoreo/alertas/resumen`);
}

export interface Facetas {
  zonas: { valor: string; n: number }[];
  cajas: { valor: string; n: number }[];
}

export function obtenerFacetas(token: string) {
  return pedir<Facetas>(token, `${API_URL}/api/monitoreo/alertas/facetas`);
}

export function listarAlertas(
  token: string,
  opts?: { tipo?: string; resueltas?: boolean; limit?: number; zona?: string; caja?: string },
) {
  const p = new URLSearchParams();
  if (opts?.tipo) p.set('tipo', opts.tipo);
  if (opts?.resueltas) p.set('resueltas', 'true');
  if (opts?.limit) p.set('limit', String(opts.limit));
  if (opts?.zona) p.set('zona', opts.zona);
  if (opts?.caja) p.set('caja', opts.caja);
  const qs = p.toString();
  return pedir<Alerta[]>(token, `${API_URL}/api/monitoreo/alertas${qs ? '?' + qs : ''}`);
}

export interface Afectado {
  numero_serie: string;
  cliente: string | null;
  rut: string | null;
  telefono: string | null;
  direccion: string | null;
  zona: string | null;
  caja: string | null;
  estado: string | null;
  potencia_dbm: number | null;
  potencia_fuera_de_rango: boolean;
  degradandose: boolean;
  horas_asi: number | null;
  /** Equipo de un cliente dado de baja: no es parte del incidente. */
  inactiva: boolean;
  /** Caja verificada en terreno por una persona. */
  caja_confirmada: boolean;
  id_caja_nap: number | null;
}

export interface DetalleAlerta {
  alerta: Alerta;
  total: number;
  caidos: number;
  degradados: number;
  afectados: Afectado[];
}

export function detalleAlerta(token: string, id: number) {
  return pedir<DetalleAlerta>(token, `${API_URL}/api/monitoreo/alertas/${id}/detalle`);
}

/** Cajas de la empresa, para el selector de confirmación. */
export interface CajaOpcion {
  id_caja_nap: number;
  identificador_unico: string | null;
  latitud: string | null;
  longitud: string | null;
}

export function listarCajas(token: string) {
  return pedir<CajaOpcion[]>(token, `${API_URL}/api/planta-externa/cajas`);
}

/**
 * CU-20: registra la caja que un técnico verificó en terreno. `id_caja_nap`
 * null significa "verifiqué que no cuelga de ninguna caja del mapa".
 */
export function confirmarCaja(token: string, numero_serie: string, id_caja_nap: number | null) {
  return pedir<{ propagadas: number }>(token, `${API_URL}/api/monitoreo/ont/${numero_serie}/caja`, {
    method: 'PATCH',
    body: JSON.stringify({ id_caja_nap }),
  });
}

/** CU-16 / CU-21: despacha la OT de una alerta. */
export function generarOt(token: string, id: number) {
  return pedir<{ ot: { id_ot: number; tipo_ot: string }; creada: boolean; motivo?: string; clientes?: number }>(
    token, `${API_URL}/api/monitoreo/alertas/${id}/generar-ot`, { method: 'POST' },
  );
}

export function revisarAlerta(token: string, id: number, observacion?: string) {
  return pedir<Alerta>(token, `${API_URL}/api/monitoreo/alertas/${id}/revisar`, {
    method: 'PATCH',
    body: JSON.stringify({ observacion }),
  });
}

export function evaluarAlertas(token: string) {
  return pedir<{ creadas: number; ya_abiertas: number; cerradas_automaticamente: number }>(
    token,
    `${API_URL}/api/monitoreo/alertas/evaluar`,
    { method: 'POST' },
  );
}
