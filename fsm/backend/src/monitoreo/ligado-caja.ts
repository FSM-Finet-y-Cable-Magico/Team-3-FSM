/**
 * Ligado ONT → caja NAP (Precondición 2 del plan del Incremento 2).
 *
 * El problema: SmartOLT dice en qué caja está cada ONT (`odb_name`, escrito a
 * mano por los instaladores) y Tomodat trae las cajas del KML con otro nombre.
 * Ninguno de los dos es un identificador estable:
 *
 *   SmartOLT                          Tomodat
 *   "NAP 7"                           "NAP 7"          ← coincide
 *   "NAP06"                           "NAP 6"          ← sin espacio + cero
 *   "NAP-17"                          "NAP 17"         ← guion
 *   "NAP11 ROSA ESTER 2971 TORRE C"   "NAP 11"         ← direccion pegada
 *
 * Y encima los nombres de Tomodat NO son unicos: hay 3 cajas "NAP 7", a mas de
 * 500m entre si (medido: 64 de 65 pares homonimos estan a >500m, hasta 99km).
 * Osea el nombre solo NO alcanza para decidir.
 *
 * El desempate sale de la topologia GPON: todas las ONT de un mismo puerto PON
 * (olt+board+puerto) cuelgan del mismo splitter, o sea estan fisicamente
 * juntas. Se busca el punto que "explica" a mas ONT del grupo y cada ONT se
 * queda con su candidata mas cercana a ese punto.
 *
 * Validado contra la `zona` de SmartOLT, que NO participa del match: con
 * RADIO_DEFECTO_M las ONT de una misma zona caen en cajas a ~142m de mediana
 * (ZONA 3, n=363) sobre un dataset que abarca 99km. Con radios mas grandes la
 * cobertura sube marginalmente pero esa dispersion se degrada.
 */

export interface OntParaLigar {
  numero_serie: string;
  odb: string | null;
  olt_externo: string | null;
  board: number | null;
  puerto_pon: number | null;
  /**
   * Si ya tiene caja, entra igual: su caja es evidencia fija para la votación
   * del grupo PON, pero no se emite asignación para ella. Sin esto el
   * resultado dependería de cuántas quedan pendientes — la segunda corrida
   * votaba distinto que la primera y ligaba de más.
   */
  id_caja_nap: number | null;
}

export interface CajaParaLigar {
  id_caja_nap: number;
  identificador_unico: string | null;
  lat: number | null;
  lon: number | null;
}

export interface StatsLigado {
  ont_evaluadas: number;
  sin_nombre_de_caja: number;
  match_unico: number;
  resueltas_por_pon: number;
  ambiguas_sin_resolver: number;
  sin_caja_candidata: number;
}

export interface ResultadoLigado {
  asignaciones: Map<string, number>;
  stats: StatsLigado;
}

/** Radio de vecindad de un splitter PON. Ver cabecera para por qué 800. */
export const RADIO_DEFECTO_M = 800;

/**
 * Normaliza un nombre de caja preservando TODOS sus tokens: solo unifica la
 * forma. Es deliberadamente conservadora — colapsar de mas genera ambiguedad
 * falsa (p.ej. "NAP Z1-040" y "NAP 1" son cajas distintas y no deben caer en
 * la misma clave).
 */
export function normalizarNombreCaja(nombre: string | null): string | null {
  if (!nombre) return null;
  const s = nombre
    .toUpperCase()
    // separa fronteras letra↔digito: "NAP06" → "NAP 06", "Z1" → "Z 1"
    .replace(/([A-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  if (!s) return null;
  return s
    .split(' ')
    .map((t) => (/^\d+$/.test(t) ? String(parseInt(t, 10)) : t))
    .join(' ');
}

/**
 * Niveles de claves candidatas, del mas especifico al menos. Se prueban en
 * orden y gana el primer nivel con algun match; dentro de un nivel las claves
 * se unen (son alternativas igual de plausibles, el desempate geografico
 * decide despues).
 *
 * Nivel 1: el nombre completo normalizado.
 * Nivel 2: cortado despues del primer numero, para tolerar la direccion que
 *          SmartOLT pega al nombre ("NAP 11 ROSA ESTER 2971 TORRE C" → "NAP 11").
 *
 * Caso aparte: en ZONA 7 los instaladores anotan solo el numero ("305"), sin
 * prefijo. Ahi las alternativas son "NAP 305" y "CTO 305" a la vez.
 */
export function clavesDe(nombre: string | null): string[][] {
  const full = normalizarNombreCaja(nombre);
  if (!full) return [];

  if (/^\d+$/.test(full)) {
    return [[`NAP ${full}`, `CTO ${full}`]];
  }

  const toks = full.split(' ');
  const iNum = toks.findIndex((t) => /^\d+$/.test(t));
  if (iNum === -1) return [[full]];
  const core = toks.slice(0, iNum + 1).join(' ');
  return core === full ? [[full]] : [[full], [core]];
}

/**
 * Rescata una referencia de caja escrita dentro de un texto libre. Una parte de
 * los instaladores anota la caja en el campo de direccion en vez del de caja:
 *
 *   "NAP55 POS3,CASTRO 4165"              → "NAP55"
 *   "CORCOLEN 3256 / NAP 115 POS1"        → "NAP 115"
 *   "PASAJE EL ESTUCO 01564 / NAP95 /POS3" → "NAP95"
 *
 * Se corta en el numero: lo que sigue ("POS3", la calle) no es parte del
 * nombre de la caja. Devuelve null si no hay nada reconocible.
 */
export function referenciaDeCajaEnTexto(texto: string | null): string | null {
  if (!texto) return null;
  const m = /(NAP|CTO)\s*-?\s*(\d+)/i.exec(texto);
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}

interface Punto {
  lat: number;
  lon: number;
}

/** Distancia aproximada en metros. Suficiente a escala urbana. */
function metros(a: Punto, b: Punto): number {
  const dLat = (a.lat - b.lat) * 111_000;
  const dLon = (a.lon - b.lon) * 111_000 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function tieneCoords(c: CajaParaLigar): c is CajaParaLigar & Punto {
  return c.lat != null && c.lon != null;
}

export function emparejar(
  onts: OntParaLigar[],
  cajas: CajaParaLigar[],
  radioM: number = RADIO_DEFECTO_M,
): ResultadoLigado {
  const porClave = new Map<string, CajaParaLigar[]>();
  for (const c of cajas) {
    const k = normalizarNombreCaja(c.identificador_unico);
    if (!k) continue;
    const lista = porClave.get(k);
    if (lista) lista.push(c);
    else porClave.set(k, [c]);
  }

  const porId = new Map(cajas.map((c) => [c.id_caja_nap, c]));

  // Paso 1 — candidatas por nombre.
  const candidatas = new Map<string, CajaParaLigar[]>();
  const yaLigadas = new Set<string>();
  let sinNombre = 0;
  for (const o of onts) {
    // Ya resuelta: su caja es evidencia fija, no candidata a reasignar.
    if (o.id_caja_nap != null) {
      const caja = porId.get(o.id_caja_nap);
      if (caja) {
        candidatas.set(o.numero_serie, [caja]);
        yaLigadas.add(o.numero_serie);
      }
      continue;
    }
    if (!o.odb) {
      sinNombre++;
      continue;
    }
    let hit: CajaParaLigar[] = [];
    for (const nivel of clavesDe(o.odb)) {
      const union = nivel.flatMap((k) => porClave.get(k) ?? []);
      if (union.length) {
        hit = union;
        break;
      }
    }
    candidatas.set(o.numero_serie, hit);
  }

  const asignaciones = new Map<string, number>();
  let matchUnico = 0;
  for (const [sn, c] of candidatas) {
    if (yaLigadas.has(sn)) continue;
    if (c.length === 1) {
      asignaciones.set(sn, c[0].id_caja_nap);
      matchUnico++;
    }
  }

  // Paso 2 — desempate por votacion dentro del grupo PON.
  const grupos = new Map<string, OntParaLigar[]>();
  for (const o of onts) {
    if (!candidatas.has(o.numero_serie)) continue;
    const g = `${o.olt_externo}|${o.board}|${o.puerto_pon}`;
    const lista = grupos.get(g);
    if (lista) lista.push(o);
    else grupos.set(g, [o]);
  }

  let resueltasPorPon = 0;
  let ambiguasSinResolver = 0;

  for (const miembros of grupos.values()) {
    const conCandidatas = miembros.filter((o) => (candidatas.get(o.numero_serie) ?? []).length > 0);
    if (conCandidatas.length === 0) continue;

    const puntos = conCandidatas
      .flatMap((o) => candidatas.get(o.numero_serie) ?? [])
      .filter(tieneCoords);
    if (puntos.length === 0) continue;

    // El centro es el punto candidato que deja a mas ONT del grupo con alguna
    // candidata dentro del radio.
    let centro: (CajaParaLigar & Punto) | null = null;
    let mejorApoyo = -1;
    for (const p of puntos) {
      let apoyo = 0;
      for (const o of conCandidatas) {
        const cerca = (candidatas.get(o.numero_serie) ?? [])
          .filter(tieneCoords)
          .some((x) => metros(x, p) <= radioM);
        if (cerca) apoyo++;
      }
      if (apoyo > mejorApoyo) {
        mejorApoyo = apoyo;
        centro = p;
      }
    }
    if (!centro) continue;
    const ref = centro;

    for (const o of conCandidatas) {
      if (yaLigadas.has(o.numero_serie)) continue;
      const cands = candidatas.get(o.numero_serie) ?? [];
      if (cands.length <= 1) continue;
      const cerca = cands
        .filter(tieneCoords)
        .filter((x) => metros(x, ref) <= radioM)
        .sort((a, b) => metros(a, ref) - metros(b, ref));
      if (cerca.length >= 1) {
        asignaciones.set(o.numero_serie, cerca[0].id_caja_nap);
        resueltasPorPon++;
      } else {
        ambiguasSinResolver++;
      }
    }
  }

  const sinCajaCandidata = [...candidatas]
    .filter(([sn, c]) => !yaLigadas.has(sn) && c.length === 0).length;

  return {
    asignaciones,
    stats: {
      ont_evaluadas: onts.length - yaLigadas.size,
      sin_nombre_de_caja: sinNombre,
      match_unico: matchUnico,
      resueltas_por_pon: resueltasPorPon,
      ambiguas_sin_resolver: ambiguasSinResolver,
      sin_caja_candidata: sinCajaCandidata,
    },
  };
}
