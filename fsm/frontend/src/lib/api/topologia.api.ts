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
