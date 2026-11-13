import { API_URL } from './config.js';
import { pedirJson } from './http.js';

/**
 * Cliente de la topologia de planta externa (CU-18, CU-19 y CU-20).
 *
 * Solo cajas y puertos: OLT, tarjeta y mufa tienen endpoint pero se crean una
 * vez al año, y no valia la pena la superficie de formulario para eso.
 */

export interface CajaDisponible {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  numero_poste: string | null;
  latitud: string | null;
  longitud: string | null;
  capacidad_puertos: number;
  libres: number;
}

export interface PuertoNap {
  id_puerto: number;
  numero_puerto: number | null;
  estado: string | null;
  id_cliente_asociado: number | null;
}

export interface DetallePuertos {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  capacidad_puertos: number;
  /**
   * Puertos SIN registro de ocupación. No significa "disponible": las cajas
   * están en postes y las comparten varios operadores, así que nadie puede
   * afirmar que un puerto esté libre hasta que un técnico lo mira.
   */
  sin_registro: number;
  reservados: number;
  /** Confirmado en terreno, con cliente asociado. Es el único dato duro. */
  ocupados: number;
  /** RF-17. No cuenta como disponible: no se puede asignar. */
  en_mantencion: number;
  puertos: PuertoNap[];
}

/** Lo que devuelve `GET /planta-externa/cajas`: incluye las llenas. */
export interface CajaListada {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  numero_poste: string | null;
  latitud: string | null;
  longitud: string | null;
  capacidad_puertos: number;
  puertos_ocupados: number;
  puertos_libres: number;
}

export interface CrearCaja {
  identificador_unico: string;
  zona?: string;
  numero_poste?: string;
  capacidad_puertos?: number;
  latitud?: number;
  longitud?: number;
}

/** Delega en el envoltorio compartido, que ademas cierra la sesion en un 401. */
async function fetchApi<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  return pedirJson<T>(token, url, init, 'Error en la solicitud');
}

// ---------------------------------------------------------------------------
// Mapa de salud de la red
// ---------------------------------------------------------------------------

/**
 * Estado de una caja según sus ONT. Mismas reglas que el motor de alertas:
 * CAIDA es una falla de caja (70 % afectado con padrón suficiente, o alerta
 * de falla de caja abierta); SIN_ONT es que no tiene ninguna ONT ligada.
 */
export type EstadoCaja = 'CAIDA' | 'DEGRADADA' | 'OK' | 'SIN_ONT';

export interface ConteoOnts {
  total: number;
  en_linea: number;
  caidas: number;
  potencia_fuera: number;
  /** Sin servicio o con potencia fuera de rango. */
  afectadas: number;
  potencia_promedio: number | null;
}

export interface SaludCaja {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  numero_poste: string | null;
  latitud: number | null;
  longitud: number | null;
  estado: EstadoCaja;
  onts: ConteoOnts;
  alertas_abiertas: number;
  ots_abiertas: number;
}

export interface ResumenSalud {
  cajas: number;
  por_estado: Record<EstadoCaja, number>;
  con_alerta_u_ot: number;
  sin_ubicacion: number;
  clientes_afectados: number;
}

/** De la más grave a la más sana. */
export async function saludCajas(token: string): Promise<{ resumen: ResumenSalud; cajas: SaludCaja[] }> {
  return fetchApi(token, `${API_URL}/api/planta-externa/salud-cajas`);
}

export interface OntDeCaja {
  numero_serie: string;
  id_cliente: number | null;
  nombre_cliente: string | null;
  estado_conexion: string | null;
  potencia_dbm: number | null;
  sin_senal_desde: string | null;
  odb: string | null;
  odb_puerto: number | null;
  olt_externo: string | null;
  board: number | null;
  puerto_pon: number | null;
  /** Caída hace tanto que parece un equipo dado de baja: no cuenta en el estado. */
  posible_baja: boolean;
  /** Cliente suspendido por deuda (contrato de G8): no cuenta en el estado. */
  suspendido?: boolean;
}

export interface DetalleSaludCaja {
  caja: SaludCaja & { mufa: string | null };
  onts: OntDeCaja[];
  /** Claves de la caja en SmartOLT, de la más usada a la menos. */
  claves_smartolt: string[];
  alertas: {
    id_alerta: number;
    tipo: string;
    severidad: string | null;
    mensaje: string | null;
    afectados: number;
    creada_en: string;
    id_ot_generada: number | null;
  }[];
  ots: {
    id_ot: number;
    tipo_ot: string;
    estado: string;
    prioridad: string;
    fecha_creacion: string;
    fecha_completada: string | null;
    tecnico: { nombre_completo: string } | null;
  }[];
  cercanas: (SaludCaja & { distancia_m: number })[];
}

export async function saludCaja(token: string, id: number): Promise<DetalleSaludCaja> {
  return fetchApi(token, `${API_URL}/api/planta-externa/cajas/${id}/salud`);
}

/** Todas las cajas, con su ocupación. */
export async function listarCajas(token: string): Promise<CajaListada[]> {
  return fetchApi(token, `${API_URL}/api/planta-externa/cajas`);
}

/** Solo las que tienen al menos un puerto libre, de la más holgada a la más justa. */
export async function cajasDisponibles(token: string, zona?: string): Promise<CajaDisponible[]> {
  const q = zona ? `?zona=${encodeURIComponent(zona)}` : '';
  return fetchApi(token, `${API_URL}/api/planta-externa/cajas-disponibles${q}`);
}

export async function puertosDeCaja(token: string, id: number): Promise<DetallePuertos> {
  return fetchApi(token, `${API_URL}/api/planta-externa/cajas/${id}/puertos`);
}

/** CU-20, excepcion 1: cajas cercanas con al menos un puerto libre. */
export interface CajaCercana {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  libres: number;
  distancia_m: number;
}

export async function cajasCercanas(token: string, id: number): Promise<CajaCercana[]> {
  return fetchApi(token, `${API_URL}/api/planta-externa/cajas/${id}/cercanas`);
}

/** CU-20: resultado de reconciliar los puertos con las ONT ligadas. */
export interface ReconciliacionPuertos {
  aplicado: boolean;
  cajas_revisadas: number;
  puertos_creados: number;
  puertos_ocupados: number;
  clientes_sin_puerto: { id_caja_nap: number; identificador_unico: string | null; id_cliente: number }[];
  cajas_sin_capacidad: { id_caja_nap: number; identificador_unico: string | null }[];
}

/** Sin `aplicar` solo informa lo que haria. */
export async function reconciliarPuertos(token: string, aplicar: boolean): Promise<ReconciliacionPuertos> {
  return fetchApi(token, `${API_URL}/api/planta-externa/puertos/reconciliar${aplicar ? '?aplicar=true' : ''}`, {
    method: 'POST',
  });
}

export async function crearCaja(token: string, dto: CrearCaja): Promise<CajaListada> {
  return fetchApi<CajaListada>(token, `${API_URL}/api/planta-externa/cajas`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export async function editarCaja(
  token: string,
  id: number,
  dto: Partial<CrearCaja>,
): Promise<CajaListada> {
  return fetchApi<CajaListada>(token, `${API_URL}/api/planta-externa/cajas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export async function editarPuerto(
  token: string,
  id: number,
  dto: { estado?: string; id_cliente_asociado?: number | null },
) {
  return fetchApi(token, `${API_URL}/api/planta-externa/puertos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}
