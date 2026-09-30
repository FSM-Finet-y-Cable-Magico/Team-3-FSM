import { ZONA_OPERACION } from '../common/utils/dia-habil.util.js';
import { ESTADO_CONEXION } from './monitoreo.constants.js';

/**
 * CU-14 / RF-12: historial de microdesconexiones de una ONT.
 *
 * `historial_conexion_ont` guarda cada CAMBIO de estado, no interrupciones. Una
 * interrupcion empieza cuando la ONT pasa a un estado caido y termina cuando
 * vuelve a ONLINE; pasar de un estado caido a otro (LOS → POWER_FAIL) sigue
 * siendo la misma interrupcion. DESCONOCIDO no es una caida: es no tener
 * lectura, y contarlo inventaria cortes que nadie vio.
 *
 * Los umbrales son PROVISIONALES: la pregunta 5.7 a FiNet ("¿cuantos cortes, y
 * de que duracion, se consideran recurrentes?") sigue sin respuesta. Salen de
 * lo que cita el CU: "varias interrupciones cortas en el dia" y "una
 * interrupcion continua de mas de cuatro horas".
 */
export const MINUTOS_INTERRUPCION_CORTA = 30;
export const MINUTOS_INTERRUPCION_LARGA = 240;
/** Cortas en un mismo dia a partir de las cuales el dia se marca. */
export const CORTAS_POR_DIA_PARA_MARCAR = 3;
/** Dias distintos con un corte a la misma hora para hablar de patron diario. */
export const DIAS_PARA_HORARIO_RECURRENTE = 3;

const CAIDOS: string[] = [ESTADO_CONEXION.OFFLINE, ESTADO_CONEXION.LOS, ESTADO_CONEXION.POWER_FAIL];

/**
 * Indicio, no causa: el CU lo dice explicito. El historial solo sabe que
 * estado reporto la OLT; lo demas es orientacion para el diagnostico.
 */
const INDICIO: Record<string, string> = {
  [ESTADO_CONEXION.POWER_FAIL]: 'La ONT reportó falta de energía eléctrica en el domicilio',
  [ESTADO_CONEXION.LOS]: 'Pérdida de señal óptica: conector, cable de acometida o fibra',
  [ESTADO_CONEXION.OFFLINE]: 'La ONT dejó de responder: equipo apagado o falla de la ONT',
};

export interface Interrupcion {
  desde: Date;
  /** Null si la ONT sigue caida al final del periodo. */
  hasta: Date | null;
  /** El estado con el que se cayo. */
  estado: string;
  minutos: number;
  en_curso: boolean;
  /** Ya estaba caida al empezar el periodo: `desde` es el inicio del periodo. */
  empezo_antes: boolean;
  indicio: string;
}

export interface AnalisisInterrupciones {
  interrupciones: Interrupcion[];
  indicadores: {
    total: number;
    cortas: number;
    largas: number;
    minutos_totales: number;
    dias_con_varias_cortas: { dia: string; cortas: number }[];
    /** Horas del dia (0-23, hora de Chile) en que se repiten cortes. */
    horario_recurrente: { hora: number; dias: number }[];
  };
}

const partesLocales = (instante: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_OPERACION,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(instante);
  const v = (tipo: string) => p.find((x) => x.type === tipo)?.value ?? '';
  return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')) % 24 };
};

export function analizarInterrupciones(entrada: {
  /** Estado vigente al empezar el periodo (ultimo evento anterior), o null. */
  previo: string | null;
  /** Eventos del periodo, en orden cronologico. */
  eventos: { evento: string | null; timestamp: Date }[];
  desde: Date;
  hasta: Date;
}): AnalisisInterrupciones {
  const { eventos, desde, hasta } = entrada;
  const interrupciones: Interrupcion[] = [];
  const minutos = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

  let abierta: { desde: Date; estado: string; empezo_antes: boolean } | null =
    entrada.previo && CAIDOS.includes(entrada.previo)
      ? { desde, estado: entrada.previo, empezo_antes: true }
      : null;

  const cerrar = (fin: Date | null) => {
    if (!abierta) return;
    interrupciones.push({
      desde: abierta.desde,
      hasta: fin,
      estado: abierta.estado,
      minutos: minutos(abierta.desde, fin ?? hasta),
      en_curso: fin === null,
      empezo_antes: abierta.empezo_antes,
      indicio: INDICIO[abierta.estado] ?? 'Sin indicio para este estado',
    });
    abierta = null;
  };

  for (const e of eventos) {
    const estado = e.evento ?? '';
    if (CAIDOS.includes(estado)) {
      if (!abierta) abierta = { desde: e.timestamp, estado, empezo_antes: false };
    } else if (estado === ESTADO_CONEXION.ONLINE) {
      cerrar(e.timestamp);
    }
  }
  cerrar(null);

  const cortas = interrupciones.filter((i) => !i.en_curso && i.minutos <= MINUTOS_INTERRUPCION_CORTA);

  const cortasPorDia = new Map<string, number>();
  for (const i of cortas) {
    const { dia } = partesLocales(i.desde);
    cortasPorDia.set(dia, (cortasPorDia.get(dia) ?? 0) + 1);
  }

  // Patron diario: la misma hora de inicio en dias distintos. Se agrupa por
  // hora de reloj; la tolerancia de "horario similar" tambien esta en la 5.7.
  const diasPorHora = new Map<number, Set<string>>();
  for (const i of interrupciones) {
    if (i.empezo_antes) continue;
    const { dia, hora } = partesLocales(i.desde);
    const dias = diasPorHora.get(hora) ?? new Set<string>();
    dias.add(dia);
    diasPorHora.set(hora, dias);
  }

  return {
    interrupciones,
    indicadores: {
      total: interrupciones.length,
      cortas: cortas.length,
      largas: interrupciones.filter((i) => i.minutos > MINUTOS_INTERRUPCION_LARGA).length,
      minutos_totales: interrupciones.reduce((a, i) => a + i.minutos, 0),
      dias_con_varias_cortas: [...cortasPorDia]
        .filter(([, n]) => n >= CORTAS_POR_DIA_PARA_MARCAR)
        .map(([dia, n]) => ({ dia, cortas: n }))
        .sort((a, b) => a.dia.localeCompare(b.dia)),
      horario_recurrente: [...diasPorHora]
        .filter(([, dias]) => dias.size >= DIAS_PARA_HORARIO_RECURRENTE)
        .map(([hora, dias]) => ({ hora, dias: dias.size }))
        .sort((a, b) => b.dias - a.dias || a.hora - b.hora),
    },
  };
}
