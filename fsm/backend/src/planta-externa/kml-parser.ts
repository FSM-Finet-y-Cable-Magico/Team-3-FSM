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
}

const PALABRAS: Record<Exclude<TipoNodo, 'DESCONOCIDO'>, RegExp> = {
  OLT: /\bolt\b/i,
  CAJA_NAP: /caja|cto|\bnap\b|atendimento|nap box/i,
  MUFA: /mufa|emenda|\bceo\b|splice|deriva/i,
  POSTE: /poste|pole/i,
};

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

  return { nodos, descartados };
}

function aNodo(pm: any, folderNombre: string | null): NodoTopologia {
  const nombre = textoDe(pm?.name) ?? '(sin nombre)';
  const atributos = extendedDataAObj(pm?.ExtendedData);
  const descAttrs = descripcionAObj(textoDe(pm?.description));
  Object.assign(atributos, descAttrs);

  const [lon, lat] = coordenadas(pm);

  const pistaTipo =
    atributos['tipo'] ?? atributos['type'] ?? atributos['categoria'] ?? folderNombre ?? nombre;

  return {
    tipo: clasificar(pistaTipo),
    nombre,
    identificador:
      atributos['id'] ??
      atributos['codigo'] ??
      atributos['identificador'] ??
      atributos['tag'] ??
      nombre,
    latitud: lat,
    longitud: lon,
    zona: atributos['zona'] ?? atributos['zone'] ?? atributos['region'] ?? null,
    capacidad: entero(atributos['capacidad'] ?? atributos['portas'] ?? atributos['puertos']),
    padre: atributos['padre'] ?? atributos['parent'] ?? atributos['olt'] ?? atributos['mufa'] ?? null,
    atributos,
  };
}

function clasificar(pista: string | null): TipoNodo {
  if (!pista) return 'DESCONOCIDO';
  for (const [tipo, re] of Object.entries(PALABRAS)) {
    if (re.test(pista)) return tipo as TipoNodo;
  }
  return 'DESCONOCIDO';
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
