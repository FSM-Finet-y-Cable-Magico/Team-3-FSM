/**
 * Contrato de la fuente de datos de monitoreo óptico.
 *
 * El resto del módulo (ingesta, poller, endpoints) depende SOLO de esta
 * interfaz y nunca de SmartOLT directamente. Hay dos implementaciones:
 *
 *   - `SmartOltClient`  → la API real (https://<subdominio>.smartolt.com/api)
 *   - `MockMonitoreo`   → un payload de ejemplo, para desarrollar sin credenciales
 *
 * Cuál se usa lo decide `MONITOREO_FUENTE` en el .env. Cuando lleguen las
 * credenciales de SmartOLT (y la IP a whitelistear), el cambio es una variable
 * de entorno, no código.
 */

/** Estado de conexión normalizado. Cada fuente traduce su vocabulario a esto. */
export type EstadoConexion = 'ONLINE' | 'OFFLINE' | 'LOS' | 'DESCONOCIDO';

/** Un OLT tal como lo reporta la fuente. Alimenta la tabla `olt`. */
export interface OltInfo {
  /** Identificador del OLT en la fuente (SmartOLT `olt_id`). */
  id_externo: string;
  nombre: string | null;
  ip_gestion: string | null;
  ubicacion: string | null;
}

/**
 * Datos "de censo" de una ONT: cambian poco y sirven para armar la topología
 * y para ligar la ONT a una `unidad_equipo` / `cliente`. Se leen de a ratos,
 * no en cada poll.
 */
export interface OntDetalle {
  /** Número de serie. Clave de cruce con `unidad_equipo.numero_serie`. */
  sn: string;
  /** Id de la ONT en la fuente, para las llamadas siguientes. */
  id_externo: string;
  /** `id_externo` del OLT al que cuelga. */
  olt_externo: string;
  board: number | null;
  puerto_pon: number | null;
  /** SmartOLT "zone". Se mapea a `caja_nap.zona`. */
  zona: string | null;
  /** SmartOLT "ODB" (optical distribution box) ≈ caja NAP / splitter. */
  odb: string | null;
  nombre_cliente: string | null;
  direccion_cliente: string | null;
  modelo: string | null;
}

/** Una medición puntual de una ONT: esto es lo que se ingesta en cada poll. */
export interface LecturaOnt {
  /** Número de serie de la ONT. */
  sn: string;
  /** Potencia óptica RX que ve la ONT, en dBm. `null` si la ONT está caída. */
  potencia_rx_dbm: number | null;
  estado: EstadoConexion;
  /** Instante de la medición reportado por la fuente. */
  medido_en: Date;
}

/** Filtro opcional para no traer todas las ONTs de todos los OLTs a la vez. */
export interface FiltroConsulta {
  olt_externo?: string;
  zona?: string;
}

export interface FuenteMonitoreo {
  /** Nombre legible de la implementación, para los logs. */
  readonly nombre: string;

  /** Censo de OLTs. */
  listarOlts(): Promise<OltInfo[]>;

  /** Censo de ONTs (topología + datos de cliente). */
  listarOntDetalles(filtro?: FiltroConsulta): Promise<OntDetalle[]>;

  /** Mediciones actuales (potencia + estado). Lo que llama el poller. */
  listarLecturas(filtro?: FiltroConsulta): Promise<LecturaOnt[]>;
}

/** Token de inyección: `@Inject(FUENTE_MONITOREO)`. */
export const FUENTE_MONITOREO = Symbol('FUENTE_MONITOREO');
