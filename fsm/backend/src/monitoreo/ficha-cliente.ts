/**
 * Rescata los datos del cliente cuando vienen todos apelotonados en un campo.
 *
 * En SmartOLT los campos no se usan como su nombre indica. Sobre los datos
 * reales de FiNet, 118 de 940 ONT traen TODO en el campo del nombre:
 *
 *   nombre    = "LAS PARMAS 492 / NAP7 POS8 / MAXIMO ZAPATA / 13.452.352-2 / 93263 3835"
 *   direccion = "POS8"        ← la posición del puerto, no una dirección
 *
 * Sin desarmarlo, el panel del jefe técnico muestra la línea entera en la
 * columna "cliente" y un "POS8" inútil en la columna "dirección" — justo los
 * dos datos que más necesita para decidir a quién llamar y a dónde ir.
 *
 * Las partes se reconocen POR SU FORMA, no por su posición: hay variantes de 2
 * a 6 campos y el orden no siempre es el mismo. Si algo no calza, se devuelve
 * tal cual vino — esto es solo presentación, nunca decide nada.
 */

export interface FichaCliente {
  nombre: string | null;
  direccion: string | null;
  rut: string | null;
  telefono: string | null;
  /** true si hubo que desarmar un campo compuesto. Útil para el reporte a FiNet. */
  compuesto: boolean;
}

const RUT = /^\s*\d{1,2}[.\s]?\d{3}[.\s]?\d{3}\s*[-.]?\s*[\dkK]\s*$/;
const TELEFONO = /^\s*\+?\s*(?:56)?\s*9?[\s\d]{7,12}\s*$/;
const CAJA_Y_POSICION = /^\s*(?:NAP|CTO)\s*-?\s*\d+\s*(?:POS\s*\.?\s*\d+)?\s*$/i;
const SOLO_POSICION = /^\s*(?:POS|PON)\s*\.?\s*\d+\s*$/i;
const TIENE_LETRAS = /[a-záéíóúñ]{3,}/i;
const TIENE_NUMERO = /\d/;

/**
 * Una dirección chilena casi siempre trae calle + número ("LAS PARMAS 492").
 * Un nombre propio no lleva números. Es la distinción que separa ambas partes.
 */
function pareceDireccion(p: string): boolean {
  return TIENE_LETRAS.test(p) && TIENE_NUMERO.test(p);
}

export function descomponerFicha(
  nombreCrudo: string | null,
  direccionCruda: string | null,
): FichaCliente {
  const dirOriginal = direccionCruda?.trim() || null;
  // Una "dirección" que es solo la posición del puerto no sirve de dirección.
  const dirUtil = dirOriginal && !SOLO_POSICION.test(dirOriginal) ? dirOriginal : null;

  const crudo = nombreCrudo?.trim() ?? '';
  if (!crudo.includes('/')) {
    return { nombre: crudo || null, direccion: dirUtil, rut: null, telefono: null, compuesto: false };
  }

  const partes = crudo.split('/').map((p) => p.trim()).filter(Boolean);
  let rut: string | null = null;
  let telefono: string | null = null;
  const candidatasTexto: string[] = [];

  for (const p of partes) {
    if (!rut && RUT.test(p)) { rut = p.replace(/\s/g, ''); continue; }
    if (CAJA_Y_POSICION.test(p) || SOLO_POSICION.test(p)) continue; // ya lo sabemos por otro lado
    if (!telefono && !TIENE_LETRAS.test(p) && TELEFONO.test(p)) { telefono = p.trim(); continue; }
    if (TIENE_LETRAS.test(p)) candidatasTexto.push(p);
  }

  // De las partes con texto: la que trae números es la dirección, la otra el
  // nombre. Si hay una sola, se decide por la misma regla.
  const dirDelNombre = candidatasTexto.find(pareceDireccion) ?? null;
  const nombre = candidatasTexto.find((p) => p !== dirDelNombre) ?? null;

  return {
    nombre: nombre ?? dirDelNombre,
    // La dirección del campo compuesto gana sobre un campo de dirección que
    // solo traía la posición.
    direccion: dirUtil ?? dirDelNombre,
    rut,
    telefono,
    compuesto: true,
  };
}
