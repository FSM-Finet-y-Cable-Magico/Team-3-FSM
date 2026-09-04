import { XMLParser } from 'fast-xml-parser';

/**
 * Parser de KML de topología FTTH (exportable desde Tomodat, o cualquier GIS).
 *
 * Un KML son carpetas (`<Folder>`) con marcadores (`<Placemark>`). Cada marcador
 * tiene nombre, coordenadas y, a veces, `<ExtendedData>` con pares clave/valor.
 * El tipo de nodo (OLT / caja NAP / mufa / poste) se deduce, en este orden:
 *   1. `<ExtendedData>` con una clave tipo/type/categoria
 *   2. el nombre de la carpeta que lo contiene
 *   3. el prefijo del nombre del marcador
 */

export type TipoNodo = 'OLT' | 'CAJA_NAP' | 'MUFA' | 'POSTE' | 'DESCONOCIDO';

export interface NodoTopologia {
  tipo: TipoNodo;
  nombre: string;
  /** Código único del elemento (id de CTO, nombre de OLT…). */
  identificador: string | null;
  latitud: number | null;
  longitud: number | null;
  zona: string | null;
  /** Capacidad de puertos (para cajas NAP). */
  capacidad: number | null;
  /** Identificador del padre si el KML lo trae (mufa de una caja, etc.). */
  padre: string | null;
  /** Todo lo demás que venía en ExtendedData / description. */
  atributos: Record<string, string>;
}

export interface ResultadoParseo {
  nodos: NodoTopologia[];
  descartados: number;
  /**
   * Duplicados exactos (mismo tipo, mismo nombre/identificador y mismas
   * coordenadas — el mismo elemento exportado dos veces) que se colapsaron en
   * uno solo. No es un error, no se cuenta en `descartados`.
   */
  fusionados: number;
}

// `^nodo\b` y "banco central" son propios del export real de Tomodat: la
// cabecera de red ahí no se llama "OLT", se llama "NODO <algo>" (ej. "NODO
// FINET") o directamente el nombre del lugar (ej. "BANCO CENTRAL"). Un "nodo"
// pelado, sin nada más en el nombre, es demasiado ambiguo para asumir que es
// un OLT real — se filtra aparte, ver `esNodoAmbiguo`.
const PALABRAS: Record<Exclude<TipoNodo, 'DESCONOCIDO'>, RegExp> = {
  OLT: /\bolt\b|^nodo\b|^banco central$/i,
  CAJA_NAP: /caja|cto|\bnap\b|atendimento|nap box/i,
  MUFA: /mufa|emenda|\bceo\b|splice|deriva/i,
  POSTE: /poste|pole/i,
};

/** "nodo" o "NODO" a secas, sin nada más: no alcanza para asumir que es un OLT real. */
export function esNodoAmbiguo(nombre: string): boolean {
  return /^nodo$/i.test(nombre.trim());
}

export function parsearKml(xml: string): ResultadoParseo {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    isArray: (name) => ['Folder', 'Placemark', 'Data'].includes(name),
  });

  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    throw new Error(`KML inválido: ${(e as Error).message}`);
  }

  const kml = (doc as Record<string, any>)?.kml;
  const raiz = kml?.Document ?? kml;
  if (!raiz) throw new Error('KML sin nodo <Document> ni <kml>');

  const nodos: NodoTopologia[] = [];
  let descartados = 0;

  const recorrer = (contenedor: any, folderNombre: string | null) => {
    for (const pm of asArray(contenedor?.Placemark)) {
      const nodo = aNodo(pm, folderNombre);
      if (nodo.tipo === 'DESCONOCIDO') descartados++;
      else nodos.push(nodo);
    }
    for (const f of asArray(contenedor?.Folder)) {
      recorrer(f, textoDe(f?.name) ?? folderNombre);
    }
  };
  recorrer(raiz, textoDe(raiz?.name) ?? null);

  // Sin ExtendedData (caso real de Tomodat), `identificador` termina siendo el
  // nombre tal cual, y el nombre no es único: "NAP 1" se repite en cada
  // barrio. Upsertear directo por ese identificador pisaría cajas distintas
  // entre sí. Acá se resuelve: duplicado exacto (mismas coordenadas) se
  // colapsa en uno solo; mismo nombre en coordenadas distintas se desambigua
  // agregando un contador al identificador.
  const { finales, fusionados } = desambiguar(nodos);

  return { nodos: finales, descartados, fusionados };
}

function desambiguar(nodos: NodoTopologia[]): { finales: NodoTopologia[]; fusionados: number } {
  const vistosExactos = new Set<string>();
  const contadorPorClave = new Map<string, number>();
  const finales: NodoTopologia[] = [];
  let fusionados = 0;

  for (const n of nodos) {
    const ident = n.identificador ?? n.nombre;
    const claveExacta = `${n.tipo}|${ident}|${n.latitud?.toFixed(6)}|${n.longitud?.toFixed(6)}`;
    if (vistosExactos.has(claveExacta)) {
      fusionados++;
      continue;
    }
    vistosExactos.add(claveExacta);

    const claveTipo = `${n.tipo}|${ident}`;
    const veces = (contadorPorClave.get(claveTipo) ?? 0) + 1;
    contadorPorClave.set(claveTipo, veces);
    finales.push(veces > 1 ? { ...n, identificador: `${ident} (${veces})` } : n);
  }

  return { finales, fusionados };
}

function aNodo(pm: any, folderNombre: string | null): NodoTopologia {
  const nombre = textoDe(pm?.name) ?? '(sin nombre)';
  const atributos = extendedDataAObj(pm?.ExtendedData);
  const descAttrs = descripcionAObj(textoDe(pm?.description));
  Object.assign(atributos, descAttrs);

  const [lon, lat] = coordenadas(pm);

  const pistaTipo =
    atributos['tipo'] ?? atributos['type'] ?? atributos['categoria'] ?? folderNombre ?? nombre;

  const identificadorCrudo =
    atributos['id'] ??
    atributos['codigo'] ??
    atributos['identificador'] ??
    atributos['tag'] ??
    nombre;

  // Un `<LineString>` es un tramo de cable (troncal/brazo), no una caja ni
  // una mufa — aunque su nombre mencione "NAP" o "mufa" (ej. "BRAZO NAP 9-16
  // DESDE MUFA FCO.RIVEROS", o un segmento entre dos mufas). Sin este freno,
  // el primer punto de la línea (ver `coordenadas`) se guardaba como si fuera
  // la ubicación real de una caja/mufa — infraestructura falsa, con
  // coordenadas de donde arranca el cable, no de donde está la caja.
  const esPunto = !!pm?.Point;

  return {
    tipo: esPunto ? clasificar(pistaTipo) : 'DESCONOCIDO',
    nombre,
    // 44, no 50: deja lugar para el sufijo " (n)" que agrega `desambiguar`
    // sin pasarse del `VarChar(50)` de `caja_nap.identificador_unico` /
    // `mufa.identificador`.
    identificador: acortar(identificadorCrudo, 44),
    latitud: lat,
    longitud: lon,
    zona: atributos['zona'] ?? atributos['zone'] ?? atributos['region'] ?? null,
    capacidad: entero(atributos['capacidad'] ?? atributos['portas'] ?? atributos['puertos']),
    padre: atributos['padre'] ?? atributos['parent'] ?? atributos['olt'] ?? atributos['mufa'] ?? null,
    atributos,
  };
}

// RUT chileno (ej. 12.345.678-9): el export real de Tomodat mezcla, en el
// mismo archivo, infraestructura real (cajas NAP, mufas) con marcadores de
// clientes individuales que alguien tipeó como "DIRECCION / NAPx POSy /
// NOMBRE / RUT / TELEFONO" en el campo `name`. Cuando ese texto tiene un
// espacio entre "NAP" y el número ("NAP 21" en vez de "NAP21"), matchea el
// mismo patrón `\bnap\b` que una caja real — sin este filtro, quedaría el
// nombre/RUT/teléfono de un cliente guardado como si fuera el identificador
// de una caja NAP, visible después para cualquier técnico. Se corta acá,
// antes de clasificar, no después.
const RUT_CHILENO = /\d{1,2}\.\d{3}\.\d{3}-[\dkK]/;

function clasificar(pista: string | null): TipoNodo {
  if (!pista) return 'DESCONOCIDO';
  if (RUT_CHILENO.test(pista)) return 'DESCONOCIDO';
  if (esNodoAmbiguo(pista)) return 'DESCONOCIDO';
  for (const [tipo, re] of Object.entries(PALABRAS)) {
    if (re.test(pista)) return tipo as TipoNodo;
  }
  return 'DESCONOCIDO';
}

function acortar(texto: string, max: number): string {
  return texto.length > max ? texto.slice(0, max - 1) + '…' : texto;
}

function coordenadas(pm: any): [number | null, number | null] {
  const raw =
    textoDe(pm?.Point?.coordinates) ??
    textoDe(pm?.LineString?.coordinates)?.split(/\s+/)[0] ??
    null;
  if (!raw) return [null, null];
  const [lonStr, latStr] = raw.split(',');
  const lon = Number(lonStr);
  const lat = Number(latStr);
  return [Number.isFinite(lon) ? lon : null, Number.isFinite(lat) ? lat : null];
}

function extendedDataAObj(ext: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of asArray(ext?.Data)) {
    const k = d?.['@_name'];
    const v = textoDe(d?.value) ?? textoDe(d?.displayName);
    if (k && v != null) out[String(k).toLowerCase()] = v;
  }
  // SchemaData / SimpleData
  for (const sd of asArray(ext?.SchemaData?.SimpleData)) {
    const k = sd?.['@_name'];
    const v = textoDe(sd?.['#text']) ?? (typeof sd === 'string' ? sd : null);
    if (k && v != null) out[String(k).toLowerCase()] = v;
  }
  return out;
}

/** Extrae pares "clave: valor" o "clave = valor" de una descripción de texto plano. */
function descripcionAObj(desc: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!desc) return out;
  const limpio = desc.replace(/<[^>]+>/g, '\n');
  for (const linea of limpio.split(/\r?\n/)) {
    const m = linea.match(/^\s*([\wáéíóúñ .\-]{2,40})\s*[:=]\s*(.+?)\s*$/i);
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function textoDe(x: unknown): string | null {
  if (x == null) return null;
  if (typeof x === 'string') return x.trim() || null;
  if (typeof x === 'number') return String(x);
  if (typeof x === 'object' && '#text' in (x as object)) return textoDe((x as any)['#text']);
  return null;
}

function entero(x: string | undefined): number | null {
  if (!x) return null;
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : null;
}
