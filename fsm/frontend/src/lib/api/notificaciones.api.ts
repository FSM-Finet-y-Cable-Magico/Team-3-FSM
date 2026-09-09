import { API_URL } from './config.js';
import { pedirJson } from './http.js';

/** Notificaciones a clientes y avisos internos (RF-42, RF-43, RF-45). */

export interface OpcionesNotificacion {
  canales: string[];
  tipos_evento: string[];
  variables: string[];
  horas_ot_inactiva: number;
  /**
   * Hoy es false: no hay proveedor de SMS ni correo conectado. La pantalla lo
   * dice en vez de dejar creer que al cliente le llegó algo.
   */
  envio_real_disponible: boolean;
}

export interface Plantilla {
  id_plantilla: number;
  id_empresa: number | null;
  tipo_evento: string | null;
  canal: string;
  contenido_texto: string | null;
  /** RF-42 y RF-43: lo que se le informa al cliente. Texto libre ("2 a 4 horas"). */
  tiempo_estimado_reparacion: string | null;
  activa: boolean;
  /** Del sistema, compartida por las dos empresas: se ve pero no se edita. */
  es_base: boolean;
  editable: boolean;
  variables_usadas: string[];
}

export interface Destinatario {
  numero_serie: string;
  zona: string | null;
  caja: string | null;
  id_cliente: number | null;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  contactable: boolean;
  ya_avisado: boolean;
}

export interface Destinatarios {
  alerta: { id_alerta: number; tipo: string; clave_caja: string | null };
  destinatarios: Destinatario[];
}

export interface ResumenEnvio {
  id_alerta: number;
  destinatarios: number;
  enviadas: number;
  sin_contacto: number;
  ya_avisados: number;
  canal: string;
  simulado: boolean;
  tiempo_estimado: string | null;
}

export interface OtDetenida {
  id_ot: number;
  tipo_ot: string;
  estado: string;
  prioridad: string;
  cliente: string | null;
  tecnico: string | null;
  sin_movimiento_desde: string;
  horas_detenida: number;
  sin_tecnico: boolean;
}

/** Delega en el envoltorio compartido, que ademas cierra la sesion en un 401. */
async function pedir<T>(token: string, url: string, init?: RequestInit): Promise<T> {
  return pedirJson<T>(token, url, init, 'Error en la solicitud');
}

export const obtenerOpciones = (token: string) =>
  pedir<OpcionesNotificacion>(token, `${API_URL}/api/notificaciones/opciones`);

export const listarPlantillas = (token: string) =>
  pedir<Plantilla[]>(token, `${API_URL}/api/notificaciones/plantillas`);

export const crearPlantilla = (
  token: string,
  datos: { tipo_evento?: string; canal: string; contenido_texto: string; tiempo_estimado_reparacion?: string },
) =>
  pedir<Plantilla>(token, `${API_URL}/api/notificaciones/plantillas`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });

export const editarPlantilla = (
  token: string,
  id: number,
  datos: {
    tipo_evento?: string;
    canal?: string;
    contenido_texto?: string;
    tiempo_estimado_reparacion?: string;
    activa?: boolean;
  },
) =>
  pedir<Plantilla>(token, `${API_URL}/api/notificaciones/plantillas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });

export const desactivarPlantilla = (token: string, id: number) =>
  pedir<Plantilla>(token, `${API_URL}/api/notificaciones/plantillas/${id}/desactivar`, {
    method: 'PATCH',
  });

/** Se mira ANTES de enviar: avisar a 71 personas no se puede deshacer. */
export const destinatariosDeAlerta = (token: string, idAlerta: number) =>
  pedir<Destinatarios>(token, `${API_URL}/api/notificaciones/alertas/${idAlerta}/destinatarios`);

export const notificarAlerta = (
  token: string,
  idAlerta: number,
  id_plantilla: number,
  opciones?: { canal?: string; tiempo_estimado?: string },
) =>
  pedir<ResumenEnvio>(token, `${API_URL}/api/notificaciones/alertas/${idAlerta}/notificar`, {
    method: 'POST',
    body: JSON.stringify({ id_plantilla, ...opciones }),
  });

export const otDetenidas = (token: string, horas?: number) =>
  pedir<OtDetenida[]>(
    token,
    `${API_URL}/api/notificaciones/ot-detenidas${horas ? `?horas=${horas}` : ''}`,
  );

/** RF-45: descartar la alerta de una OT detenida. Vuelve a las 48 h. */
export const descartarAlertaDetenida = (token: string, id_ot: number) =>
  pedirJson<{ id_ot: number; descartada_en: string; reaparece_en: string; horas_silencio: number }>(
    token,
    `${API_URL}/api/notificaciones/ot-detenidas/${id_ot}/descartar`,
    { method: 'POST' },
  );
