import { esInactiva, type EstadoOnt } from './reglas-alerta.js';

/**
 * Cajas NAP segun SmartOLT: la identidad es la misma clave que usa el motor de
 * alertas (`claveDeCaja`: puerto PON + nombre normalizado), no la caja del KML
 * de Tomodat. Aca vive lo que se puede calcular sin base: la cabecera de una
 * caja y su grilla de puertos.
 */

/**
 * Trim, mayusculas y espacios colapsados. Nada mas, y es a proposito.
 *
 * NO se usa `normalizarNombreCaja`, que es el del ligado. Aquel es tolerante
 * por diseño --parte letra/digito y quita ceros a la izquierda-- porque cruza
 * dos sistemas distintos: nombres que escribieron los instaladores en SmartOLT
 * contra los del KML de Tomodat. Aca los dos lados son cadenas del MISMO
 * sistema, el `odb` del censo contra el `name` del catalogo, asi que no hay
 * nada que tolerar.
 *
 * Y tolerar de mas haria daño: `NAP 7`, `NAP-07` y `NAP07` colapsan a la misma
 * clave con aquel normalizador, y en SmartOLT son TRES cajas distintas, en tres
 * zonas y tres puertos PON distintos. Darles la capacidad de la equivocada crea
 * puertos que no existen.
 *
 * Medido contra produccion: el estricto resuelve 221 cajas y el suelto 224. Las
 * tres de diferencia no valen el riesgo.
 */
export function claveEstrictaNombre(nombre: string | null): string | null {
  const s = (nombre ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

/** Valores no nulos, del mas usado al menos usado; a igual cantidad, el que aparecio primero. */
export function porFrecuencia(valores: (string | null)[]): string[] {
  const cuenta = new Map<string, number>();
  for (const v of valores) if (v != null) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  // Array.prototype.sort es estable: a igual cantidad conserva el orden de insercion.
  return [...cuenta].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

/** El valor no nulo que mas se repite. Null si no hay ninguno. */
export function masFrecuente(valores: (string | null)[]): string | null {
  return porFrecuencia(valores)[0] ?? null;
}

export interface CabeceraCaja {
  /** `olt/placa/puerto|NOMBRE NORMALIZADO`. */
  clave: string;
  /** Nombre tal como lo escribieron los instaladores en SmartOLT. */
  nombre: string;
  olt_externo: string | null;
  board: number | null;
  puerto_pon: number | null;
  /** Zona de SmartOLT, la mas frecuente entre las ONT de la caja. */
  zona: string | null;
}

/**
 * Como se presenta una caja. Las grafias de una misma caja conviven ("NAP53" y
 * "NAP 53" en el mismo splitter): se muestra la mas usada, que es la que el
 * tecnico va a buscar en SmartOLT.
 */
export function cabeceraDeCaja(clave: string, miembros: EstadoOnt[]): CabeceraCaja {
  const primera = miembros[0];
  return {
    clave,
    nombre: masFrecuente(miembros.map((o) => o.odb?.trim() || null)) ?? primera.caja_normalizada ?? clave,
    olt_externo: primera.olt_externo,
    board: primera.board,
    puerto_pon: primera.puerto_pon,
    zona: masFrecuente(miembros.map((o) => o.zona?.replace(/\s+/g, ' ').trim() || null)),
  };
}

export interface EntradaCatalogo {
  nombre: string;
  capacidad: number | null;
}

export interface OntDePuerto {
  numero_serie: string;
  nombre_cliente: string | null;
  estado_conexion: string | null;
  potencia_dbm: number | null;
  /** Caida hace mas de DIAS_MAX_INCIDENTE: probablemente un cliente dado de baja. */
  posible_baja: boolean;
  /** Cliente suspendido por deuda (contrato de G8). Tiene prioridad sobre `posible_baja`. */
  suspendido: boolean;
}

export interface PuertoDeCaja {
  numero: number;
  /** Sin registro NO es libre: la caja es del poste y la comparten operadores. */
  estado: 'OCUPADO' | 'SIN_REGISTRO';
  /** Dos o mas ONT dicen estar en este puerto. */
  conflicto: boolean;
  onts: OntDePuerto[];
}

export interface GrillaDeCaja {
  capacidad: number;
  /** True si la capacidad no salio del catalogo y se estimo por los puertos usados. */
  capacidad_estimada: boolean;
  /** Puertos con al menos una ONT. */
  ocupados: number;
  puertos: PuertoDeCaja[];
  /** ONT cuyo puerto es mayor que la capacidad de la caja. */
  fuera_de_rango: (OntDePuerto & { odb_puerto: number })[];
  /** ONT de la caja sin puerto en SmartOLT. */
  sin_puerto: OntDePuerto[];
}

/** Los divisores de FiNet son de 8 o de 16; mas alla, lo que diga el puerto. */
export function capacidadEstimada(maxPuerto: number): number {
  if (maxPuerto <= 8) return 8;
  if (maxPuerto <= 16) return 16;
  return maxPuerto;
}

/**
 * Capacidad de la caja segun el catalogo. Prueba las grafias en el orden dado
 * (la mas usada primero) y se queda con la primera que calce. Si calzan varias
 * entradas homonimas con capacidades distintas no adivina: devuelve null.
 */
export function resolverCapacidad(grafias: string[], catalogo: EntradaCatalogo[]): number | null {
  for (const g of grafias) {
    const k = claveEstrictaNombre(g);
    if (!k) continue;
    const calzan = catalogo.filter((c) => claveEstrictaNombre(c.nombre) === k);
    if (calzan.length === 0) continue;
    const capacidades = new Set(calzan.map((c) => c.capacidad));
    if (capacidades.size !== 1) return null;
    const [cap] = capacidades;
    return cap != null && cap > 0 ? cap : null;
  }
  return null;
}

const tienePuerto = (o: EstadoOnt): o is EstadoOnt & { odb_puerto: number } =>
  o.odb_puerto != null && o.odb_puerto > 0;

/**
 * Capacidad de una caja: la del catalogo de SmartOLT y, si no esta o es ambigua,
 * una estimacion por el puerto mas alto ocupado (`capacidad_estimada`). La usan
 * la grilla de puertos y el panel de criticos, para que digan lo mismo.
 */
export function capacidadDeCaja(
  onts: EstadoOnt[],
  catalogo: EntradaCatalogo[],
): { capacidad: number; capacidad_estimada: boolean } {
  const maxPuerto = onts.filter(tienePuerto).reduce((m, o) => Math.max(m, o.odb_puerto), 0);
  const delCatalogo = resolverCapacidad(porFrecuencia(onts.map((o) => o.odb?.trim() || null)), catalogo);
  return { capacidad: delCatalogo ?? capacidadEstimada(maxPuerto), capacidad_estimada: delCatalogo == null };
}

/** Grilla de puertos de una caja a partir de sus ONT y del catalogo. */
export function armarGrilla(onts: EstadoOnt[], catalogo: EntradaCatalogo[], ahora: Date): GrillaDeCaja {
  const aPuerto = (o: EstadoOnt): OntDePuerto => ({
    numero_serie: o.numero_serie,
    nombre_cliente: o.nombre_cliente ?? null,
    estado_conexion: o.estado_conexion,
    potencia_dbm: o.potencia_dbm,
    // `esInactiva` tambien es true para un suspendido: no es "posible baja".
    posible_baja: !o.suspendido && esInactiva(o, ahora),
    suspendido: !!o.suspendido,
  });

  const conPuerto = onts.filter(tienePuerto);
  const { capacidad, capacidad_estimada } = capacidadDeCaja(onts, catalogo);

  const porNumero = new Map<number, OntDePuerto[]>();
  const fuera_de_rango: (OntDePuerto & { odb_puerto: number })[] = [];
  for (const o of conPuerto) {
    if (o.odb_puerto > capacidad) {
      fuera_de_rango.push({ ...aPuerto(o), odb_puerto: o.odb_puerto });
      continue;
    }
    const lista = porNumero.get(o.odb_puerto);
    if (lista) lista.push(aPuerto(o));
    else porNumero.set(o.odb_puerto, [aPuerto(o)]);
  }

  const puertos: PuertoDeCaja[] = Array.from({ length: capacidad }, (_, i) => {
    const lista = porNumero.get(i + 1) ?? [];
    return {
      numero: i + 1,
      estado: lista.length > 0 ? 'OCUPADO' : 'SIN_REGISTRO',
      conflicto: lista.length > 1,
      onts: lista,
    };
  });

  return {
    capacidad,
    capacidad_estimada,
    ocupados: puertos.filter((p) => p.estado === 'OCUPADO').length,
    puertos,
    fuera_de_rango,
    sin_puerto: onts.filter((o) => !tienePuerto(o)).map(aPuerto),
  };
}
