/**
 * Reglas del motor de alertas. Funciones puras: reciben el estado de las ONT y
 * devuelven qué alertas corresponden. Sin base de datos, para poder razonarlas
 * y probarlas sueltas.
 *
 * Tres reglas, dos niveles:
 *   - por ONT   → CU-13 (potencia) y CU-52 (sin señal)
 *   - por caja  → CU-17 y rama masiva de CU-53, que agregan las anteriores
 *
 * La agrupación por caja NO usa la caja de Tomodat: usa la clave que trae
 * SmartOLT (olt/placa/puerto/nombre-de-caja). El motivo es cobertura — el
 * nombre de caja de SmartOLT existe en el 91% de las ONT, mientras que el
 * ligado a la topología de Tomodat alcanza el 89% y depende de un matching
 * heurístico. Para DETECTAR que una caja se cayó no hace falta saber dónde
 * está; la caja de Tomodat se adjunta cuando se conoce, y es lo que después
 * permite decirle al técnico a qué esquina ir.
 */
import {
  DIAS_MAX_INCIDENTE,
  MIN_ONT_PARA_FALLA_CAJA,
  SEVERIDAD,
  TIPO_ALERTA,
  UMBRAL_FALLA_CAJA_PCT,
  potenciaFueraDeRango,
} from './monitoreo.constants.js';

export interface EstadoOnt {
  id_registro_ont: number;
  numero_serie: string;
  id_cliente: number | null;
  id_caja_nap: number | null;
  olt_externo: string | null;
  board: number | null;
  puerto_pon: number | null;
  /** Nombre de caja según SmartOLT, ya normalizado. */
  caja_normalizada: string | null;
  estado_conexion: string | null;
  potencia_dbm: number | null;
  /** Desde cuándo está en un estado distinto de ONLINE. Null si está online. */
  sin_senal_desde: Date | null;
}

export interface AlertaPropuesta {
  tipo: string;
  severidad: string;
  mensaje: string;
  id_registro_ont: number | null;
  id_cliente: number | null;
  clave_caja: string | null;
  id_caja_nap: number | null;
}

/** Identidad del grupo de caja según SmartOLT. Null si no se puede formar. */
export function claveDeCaja(o: EstadoOnt): string | null {
  if (!o.caja_normalizada) return null;
  return `${o.olt_externo ?? '?'}/${o.board ?? '?'}/${o.puerto_pon ?? '?'}|${o.caja_normalizada}`;
}

function estaCaida(o: EstadoOnt): boolean {
  return o.estado_conexion != null && o.estado_conexion !== 'ONLINE';
}

/**
 * Equipo de un cliente dado de baja: sigue en SmartOLT, OFFLINE para siempre.
 * No es un incidente y no participa de ningún cálculo — ver `DIAS_MAX_INCIDENTE`.
 */
function esInactiva(o: EstadoOnt, ahora: Date): boolean {
  if (!estaCaida(o)) return false;
  if (!o.sin_senal_desde) return false;
  const dias = (ahora.getTime() - o.sin_senal_desde.getTime()) / 86_400_000;
  return dias > DIAS_MAX_INCIDENTE;
}

/**
 * Evalúa las tres reglas.
 *
 * Cuando una caja se declara caída, sus ONT NO generan además la alerta
 * individual de sin señal: es el mismo incidente, y duplicarlo llenaría el
 * panel de ruido — 12 alertas por la misma caja en vez de una accionable.
 * La de potencia sí se mantiene, porque una ONT degradada dentro de una caja
 * caída es un problema aparte que sigue estando cuando la caja se repare.
 */
export function evaluar(onts: EstadoOnt[], ahora: Date, umbralMin: number): AlertaPropuesta[] {
  const propuestas: AlertaPropuesta[] = [];

  // El padrón de trabajo son solo las ONT activas: las de bajas viejas no son
  // incidente ni cuentan para el porcentaje de la caja.
  const activas = onts.filter((o) => !esInactiva(o, ahora));

  // --- Nivel caja (CU-17 / CU-53) ---
  const porCaja = new Map<string, EstadoOnt[]>();
  for (const o of activas) {
    const k = claveDeCaja(o);
    if (!k) continue;
    const lista = porCaja.get(k);
    if (lista) lista.push(o);
    else porCaja.set(k, [o]);
  }

  const cajasCaidas = new Set<string>();
  for (const [clave, miembros] of porCaja) {
    if (miembros.length < MIN_ONT_PARA_FALLA_CAJA) continue;
    const caidas = miembros.filter(estaCaida).length;
    const pct = Math.round((caidas / miembros.length) * 100);
    if (pct < UMBRAL_FALLA_CAJA_PCT) continue;

    cajasCaidas.add(clave);
    // La caja de Tomodat se toma de cualquier miembro que la tenga resuelta:
    // es la que aporta coordenadas para el despacho.
    const conCaja = miembros.find((m) => m.id_caja_nap != null);
    propuestas.push({
      tipo: TIPO_ALERTA.FALLA_CAJA_NAP,
      severidad: SEVERIDAD.CRITICA,
      mensaje:
        `${caidas} de ${miembros.length} ONT activas caídas (${pct}%) en ${clave.split('|')[1]} ` +
        `(puerto ${clave.split('|')[0]})`,
      id_registro_ont: null,
      id_cliente: null,
      clave_caja: clave,
      id_caja_nap: conCaja?.id_caja_nap ?? null,
    });
  }

  // --- Nivel ONT (CU-13 potencia, CU-52 sin señal) ---
  for (const o of activas) {
    const clave = claveDeCaja(o);

    if (potenciaFueraDeRango(o.potencia_dbm)) {
      propuestas.push({
        tipo: TIPO_ALERTA.POTENCIA_FUERA_RANGO,
        severidad: SEVERIDAD.MEDIA,
        mensaje: `Potencia ${o.potencia_dbm} dBm fuera del rango operativo (ONT ${o.numero_serie})`,
        id_registro_ont: o.id_registro_ont,
        id_cliente: o.id_cliente,
        clave_caja: clave,
        id_caja_nap: o.id_caja_nap,
      });
    }

    if (clave && cajasCaidas.has(clave)) continue; // ya cubierta por la alerta de caja
    if (!estaCaida(o) || !o.sin_senal_desde) continue;

    const minutos = Math.floor((ahora.getTime() - o.sin_senal_desde.getTime()) / 60_000);
    if (minutos < umbralMin) continue;

    propuestas.push({
      tipo: TIPO_ALERTA.SIN_SENAL,
      severidad: SEVERIDAD.ALTA,
      mensaje: `Sin señal hace ${minutos} min (${o.estado_conexion}) — ONT ${o.numero_serie}`,
      id_registro_ont: o.id_registro_ont,
      id_cliente: o.id_cliente,
      clave_caja: clave,
      id_caja_nap: o.id_caja_nap,
    });
  }

  return propuestas;
}
