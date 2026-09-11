/**
 * Reglas del motor de alertas. Funciones puras: reciben el estado de las ONT y
 * devuelven qué alertas corresponden. Sin base de datos, para poder razonarlas
 * y probarlas sueltas.
 *
 * La idea central es UN INCIDENTE, UNA ALERTA. La red GPON es un árbol:
 *
 *     OLT → placa → puerto PON → caja NAP → ONT del cliente
 *
 * Cuando algo falla arriba, todo lo que cuelga se cae. Emitir una alerta por
 * cada ONT afectada convierte una causa única en cientos de líneas y esconde
 * justamente el dato que importa: dónde está la falla.
 *
 * Por eso las reglas se evalúan de arriba hacia abajo y se suprimen en
 * cascada: si la placa cayó entera, sus cajas y sus ONT no vuelven a alertar.
 * Sobre los datos reales de FiNet esto convirtió un incidente de 71 alertas en
 * una sola, que además dice qué placa revisar.
 *
 * La agrupación NO usa la caja de Tomodat: usa lo que trae SmartOLT
 * (olt/placa/puerto/nombre-de-caja), que cubre el 91% de las ONT contra el 89%
 * del ligado y no depende de un matching heurístico. Para detectar que algo se
 * cayó no hace falta saber dónde está; la caja de Tomodat se adjunta cuando se
 * conoce, y es lo que después permite despachar al técnico.
 */
import {
  DIAS_MAX_INCIDENTE,
  MIN_ONT_PARA_FALLA_CAJA,
  MIN_ONT_PARA_FALLA_PLACA,
  RANGO_POTENCIA_DBM,
  SEVERIDAD,
  TIPO_ALERTA,
  UMBRAL_FALLA_CAJA_PCT,
  UMBRAL_FALLA_OLT_PCT,
  UMBRAL_FALLA_PLACA_PCT,
  potenciaEnFranjaPreventiva,
  potenciaFueraDeRango,
  ESTADO_CONEXION,
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
  /** Cuántos clientes cubre esta alerta. 1 para las individuales. */
  afectados: number;
}

/** Identidad del grupo de caja según SmartOLT. Null si no se puede formar. */
export function claveDeCaja(o: EstadoOnt): string | null {
  if (!o.caja_normalizada) return null;
  return `${o.olt_externo ?? '?'}/${o.board ?? '?'}/${o.puerto_pon ?? '?'}|${o.caja_normalizada}`;
}

const claveDePlaca = (o: EstadoOnt) => `OLT ${o.olt_externo ?? '?'} / placa ${o.board ?? '?'}`;
const claveDeOlt = (o: EstadoOnt) => `OLT ${o.olt_externo ?? '?'}`;

function estaCaida(o: EstadoOnt): boolean {
  return o.estado_conexion != null && o.estado_conexion !== ESTADO_CONEXION.ONLINE;
}

/**
 * RF-15: "cuando el 70 % o mas de los clientes de una misma caja NAP presenten
 * POTENCIA FUERA DE RANGO simultaneamente".
 *
 * El porcentaje de las alertas agregadas contaba solo las ONT caidas, que no es
 * lo mismo y no se solapa con lo que dice el RF:
 *
 *   - una ONT ONLINE con -30 dBm esta fuera de rango y el RF la cuenta; el
 *     motor no la contaba;
 *   - una ONT OFFLINE no tiene lectura de potencia, asi que el texto literal
 *     del RF no la cuenta, pero operativamente una caja partida deja a todos
 *     sin senal, no con senal mala.
 *
 * Se toma la union de las dos: sin servicio O fuera de rango. Es la unica
 * lectura que no se pierde ninguno de los dos casos, y sobre todo es la que YA
 * usa el resto del sistema. `criticosPorCaja` (CU-15) define exactamente asi al
 * cliente critico de una caja, y de ahi sale el `pct_afectado` del panel.
 *
 * Con dos definiciones distintas, el panel de CU-15 podia mostrar una caja al
 * 80 % afectada mientras el motor no levantaba la alerta porque solo el 40 %
 * estaba caida: dos cifras de la misma caja en dos pantallas.
 *
 * OJO: esto cambia QUE alertas se levantan. Conviene confirmarlo con FiNet.
 *
 * No se toca `estaCaida`, que sigue significando "sin conexion" y es lo
 * correcto para los otros dos usos: detectar el equipo de un cliente dado de
 * baja, y la alerta individual de sin senal.
 */
export function afectaAlGrupo(o: EstadoOnt): boolean {
  return estaCaida(o) || potenciaFueraDeRango(o.potencia_dbm);
}

/**
 * Equipo de un cliente dado de baja: sigue en SmartOLT, OFFLINE para siempre.
 * No es un incidente y no participa de ningún cálculo — ver `DIAS_MAX_INCIDENTE`.
 */
export function esInactiva(o: EstadoOnt, ahora: Date): boolean {
  if (!estaCaida(o)) return false;
  if (!o.sin_senal_desde) return false;
  return (ahora.getTime() - o.sin_senal_desde.getTime()) / 86_400_000 > DIAS_MAX_INCIDENTE;
}

function agrupar<T>(items: T[], clave: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = clave(it);
    if (!k) continue;
    const l = m.get(k);
    if (l) l.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function evaluar(onts: EstadoOnt[], ahora: Date, umbralMin: number): AlertaPropuesta[] {
  const propuestas: AlertaPropuesta[] = [];
  // El padrón de trabajo son solo las ONT activas: las bajas viejas no son
  // incidente ni cuentan en ningún porcentaje.
  const activas = onts.filter((o) => !esInactiva(o, ahora));

  // Se van marcando los grupos ya explicados por una alerta de nivel superior.
  const oltsCaidas = new Set<string>();
  const placasCaidas = new Set<string>();
  const cajasCaidas = new Set<string>();

  /** Emite una alerta agregada si el grupo supera su umbral. */
  const evaluarNivel = (
    grupos: Map<string, EstadoOnt[]>,
    minPadron: number,
    umbralPct: number,
    tipo: string,
    severidad: string,
    yaExplicado: (miembros: EstadoOnt[]) => boolean,
    marcar: (clave: string) => void,
    etiqueta: (clave: string) => string,
  ) => {
    for (const [clave, miembros] of grupos) {
      if (miembros.length < minPadron) continue;
      if (yaExplicado(miembros)) continue;
      const afectadas = miembros.filter(afectaAlGrupo).length;
      const pct = Math.round((afectadas / miembros.length) * 100);
      if (pct < umbralPct) continue;

      marcar(clave);
      const conCaja = miembros.find((m) => m.id_caja_nap != null);
      propuestas.push({
        tipo,
        severidad,
        mensaje: `${afectadas} de ${miembros.length} ONT activas afectadas (${pct}%) en ${etiqueta(clave)}`,
        id_registro_ont: null,
        id_cliente: null,
        clave_caja: clave,
        id_caja_nap: tipo === TIPO_ALERTA.FALLA_CAJA_NAP ? (conCaja?.id_caja_nap ?? null) : null,
        afectados: afectadas,
      });
    }
  };

  // --- Nivel 1: OLT completa ---
  evaluarNivel(
    agrupar(activas, claveDeOlt),
    MIN_ONT_PARA_FALLA_PLACA,
    UMBRAL_FALLA_OLT_PCT,
    TIPO_ALERTA.FALLA_OLT,
    SEVERIDAD.CRITICA,
    () => false,
    (k) => oltsCaidas.add(k),
    (k) => k,
  );

  // --- Nivel 2: placa (CU-53 masivo) ---
  evaluarNivel(
    agrupar(activas, claveDePlaca),
    MIN_ONT_PARA_FALLA_PLACA,
    UMBRAL_FALLA_PLACA_PCT,
    TIPO_ALERTA.FALLA_PLACA_OLT,
    SEVERIDAD.CRITICA,
    (m) => oltsCaidas.has(claveDeOlt(m[0])),
    (k) => placasCaidas.add(k),
    (k) => k,
  );

  // --- Nivel 3: caja NAP (CU-17) ---
  evaluarNivel(
    agrupar(activas, claveDeCaja),
    MIN_ONT_PARA_FALLA_CAJA,
    UMBRAL_FALLA_CAJA_PCT,
    TIPO_ALERTA.FALLA_CAJA_NAP,
    SEVERIDAD.CRITICA,
    (m) => oltsCaidas.has(claveDeOlt(m[0])) || placasCaidas.has(claveDePlaca(m[0])),
    (k) => cajasCaidas.add(k),
    (k) => `${k.split('|')[1]} (puerto ${k.split('|')[0]})`,
  );

  // --- CU-16: candidatas a OT preventiva, AGREGADAS POR CAJA ---
  // La ficha pide la preventiva "por zona/caja, no por SN", y con razón: en la
  // red real hay ~220 ONT en la franja de degradación. Emitirlas una por una
  // daría 220 líneas de severidad baja que ahogan el panel; agrupadas por caja
  // son unas pocas decenas, y además es la forma en que se despacha — un
  // técnico que va a una caja atiende a todos sus clientes de una vez.
  for (const [clave, miembros] of agrupar(activas, claveDeCaja)) {
    if (cajasCaidas.has(clave) || placasCaidas.has(claveDePlaca(miembros[0]))) continue;
    // Mismo piso que las demás reglas agregadas: sin un padrón conocido mínimo,
    // "2 de 2 degradándose" no dice nada — esa caja puede tener 16 clientes en
    // la calle y solo 2 registrados.
    if (miembros.length < MIN_ONT_PARA_FALLA_CAJA) continue;
    const degradadas = miembros.filter((m) => potenciaEnFranjaPreventiva(m.potencia_dbm));
    if (degradadas.length < 2) continue; // una sola no justifica mover una cuadrilla

    const conCaja = miembros.find((m) => m.id_caja_nap != null);
    propuestas.push({
      tipo: TIPO_ALERTA.POTENCIA_DEGRADANDOSE,
      severidad: SEVERIDAD.BAJA,
      mensaje:
        `${degradadas.length} de ${miembros.length} clientes con señal degradándose en ` +
        `${clave.split('|')[1]} — candidata a OT preventiva`,
      id_registro_ont: null,
      id_cliente: null,
      clave_caja: clave,
      id_caja_nap: conCaja?.id_caja_nap ?? null,
      afectados: degradadas.length,
    });
  }

  // --- Nivel 4: la ONT del cliente ---
  for (const o of activas) {
    const clave = claveDeCaja(o);
    const explicadaArriba =
      oltsCaidas.has(claveDeOlt(o)) ||
      placasCaidas.has(claveDePlaca(o)) ||
      (clave != null && cajasCaidas.has(clave));

    const base = {
      id_registro_ont: o.id_registro_ont,
      id_cliente: o.id_cliente,
      clave_caja: clave,
      id_caja_nap: o.id_caja_nap,
      afectados: 1,
    };

    // Potencia: se evalúa siempre. Una ONT degradada dentro de una caja caída
    // es un problema aparte, que sigue estando cuando la caja se repare.
    const p = o.potencia_dbm;
    if (p != null && p < RANGO_POTENCIA_DBM.min) {
      propuestas.push({
        ...base,
        tipo: TIPO_ALERTA.POTENCIA_BAJA,
        severidad: p < -28 ? SEVERIDAD.ALTA : SEVERIDAD.MEDIA,
        mensaje: `Señal débil: ${p} dBm (mínimo ${RANGO_POTENCIA_DBM.min})`,
      });
    } else if (p != null && p > RANGO_POTENCIA_DBM.max) {
      propuestas.push({
        ...base,
        tipo: TIPO_ALERTA.POTENCIA_ALTA,
        severidad: SEVERIDAD.MEDIA,
        mensaje: `Señal excesiva: ${p} dBm (máximo ${RANGO_POTENCIA_DBM.max}) — revisar atenuación`,
      });
    }

    // Sin señal: solo si no está ya explicada por un nivel superior.
    if (explicadaArriba || !estaCaida(o) || !o.sin_senal_desde) continue;
    const minutos = Math.floor((ahora.getTime() - o.sin_senal_desde.getTime()) / 60_000);
    if (minutos < umbralMin) continue;

    propuestas.push({
      ...base,
      tipo: TIPO_ALERTA.SIN_SENAL,
      severidad: SEVERIDAD.ALTA,
      mensaje: `Sin señal hace ${minutos >= 120 ? `${Math.floor(minutos / 60)} h` : `${minutos} min`} (${o.estado_conexion})`,
    });
  }

  return propuestas;
}
