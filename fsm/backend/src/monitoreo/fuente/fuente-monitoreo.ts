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

/**
 * Estado de conexión normalizado. Cada fuente traduce su vocabulario a esto.
 * `POWER_FAIL` es distinto de `OFFLINE`: en el export real de SmartOLT es un
 * estado propio ("Power fail" — el ONT perdió alimentación, no es una caída
 * de fibra/config) y vale la pena no perder esa distinción en terreno.
 */
export type EstadoConexion = 'ONLINE' | 'OFFLINE' | 'POWER_FAIL' | 'LOS' | 'DESCONOCIDO';

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

/**
 * Una caja del catálogo de la fuente (SmartOLT "ODB").
 *
 * Es el catálogo, no lo que reportan las ONT: trae las cajas aunque no cuelgue
 * ningún cliente de ellas, y sobre todo trae `capacidad`, que el censo de ONT
 * no dice por ningún lado.
 */
export interface OdbInfo {
  /** Id en la fuente. Estable, a diferencia del nombre. */
  id_externo: string;
  nombre: string;
  /** Puertos del splitter. SmartOLT lo llama `nr_of_ports`. */
  capacidad: number | null;
  zona: string | null;
  lat: number | null;
  lon: number | null;
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

  /**
   * Catálogo de cajas. OPCIONAL a propósito: solo SmartOLT lo expone, y el CSV
   * y el mock no tienen de dónde sacarlo. Quien lo use tiene que tolerar que no
   * exista, en vez de obligar a las otras dos fuentes a inventar un catálogo
   * vacío que después nadie sabe si está vacío porque no hay o porque no se
   * puede consultar.
   */
  listarOdbs?(): Promise<OdbInfo[]>;
}

/** Token de inyección: `@Inject(FUENTE_MONITOREO)`. */
export const FUENTE_MONITOREO = Symbol('FUENTE_MONITOREO');
