import { API_URL } from './config.js';
import { pedirJson } from './http.js';

export interface Configuracion {
  id_empresa: number;
  nombre: string;
  /** null = la empresa no configuró ninguno y rige el del sistema. */
  umbral_desconexion_min: number | null;
  /** Lo que se aplica hoy de verdad, ya resuelto el null. */
  umbral_vigente: number;
  umbral_por_defecto: number;
  /** El rango que fija RF-46. Viaja para que la Vista no lo escriba a mano. */
  umbral_min: number;
  umbral_max: number;
}

export const obtenerConfiguracion = (token: string) =>
  pedirJson<Configuracion>(token, `${API_URL}/api/configuracion`, undefined, 'Error en la solicitud');

export const actualizarConfiguracion = (
  token: string,
  umbral_desconexion_min: number | null,
) =>
  pedirJson<Configuracion>(
    token,
    `${API_URL}/api/configuracion`,
    { method: 'PATCH', body: JSON.stringify({ umbral_desconexion_min }) },
    'Error en la solicitud',
  );
