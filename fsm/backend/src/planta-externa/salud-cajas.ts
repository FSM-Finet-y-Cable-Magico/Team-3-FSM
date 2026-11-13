import { afectaAlGrupo, esInactiva, type EstadoOnt } from '../monitoreo/reglas-alerta.js';
import {
  ESTADO_CONEXION,
  MIN_ONT_PARA_FALLA_CAJA,
  TIPO_ALERTA,
  UMBRAL_FALLA_CAJA_PCT,
  potenciaFueraDeRango,
} from '../monitoreo/monitoreo.constants.js';

/**
 * Salud de las cajas de la topologia: el mapa de red de `/admin/topologia`.
 *
 * POR QUE EXISTE. La pagina de topologia mostraba la ocupacion de `puerto_nap`,
 * que casi nadie llena (7 puertos marcados en 912 cajas): no le decia nada al
 * jefe tecnico. Lo que la topologia de Tomodat SI tiene, y ninguna otra fuente,
 * es la UBICACION de cada caja. Cruzada con el estado de sus ONT (que el ligado
 * ya dejo en `registro_ont.id_caja_nap`), sus alertas y sus OT, responde lo que
 * importa: donde esta fallando la red y a donde mandar una cuadrilla.
 *
 * Las reglas son las del motor de alertas, no unas nuevas: `afectaAlGrupo`,
 * `esInactiva`, el umbral de falla de caja y el padron minimo. Con criterios
 * propios, el mapa podria pintar roja una caja que el panel de alertas da por
 * sana.
 */

export type EstadoCaja = 'CAIDA' | 'DEGRADADA' | 'OK' | 'SIN_ONT';

/** De la mas grave a la mas sana. Es el orden de la lista. */
const GRAVEDAD: Record<EstadoCaja, number> = { CAIDA: 0, DEGRADADA: 1, OK: 2, SIN_ONT: 3 };

export interface ConteoOnts {
  total: number;
  en_linea: number;
  caidas: number;
  potencia_fuera: number;
  /** Sin servicio O con potencia fuera de rango: el cliente critico de CU-15. */
  afectadas: number;
  potencia_promedio: number | null;
}

/** Cuenta las ONT activas. Los equipos dados de baja no son incidente. */
export function resumirOnts(onts: EstadoOnt[], ahora: Date): ConteoOnts {
  const activas = onts.filter((o) => !esInactiva(o, ahora));
  const potencias = activas.map((o) => o.potencia_dbm).filter((p): p is number => p != null);
  return {
    total: activas.length,
    en_linea: activas.filter((o) => o.estado_conexion === ESTADO_CONEXION.ONLINE).length,
    caidas: activas.filter((o) => o.estado_conexion != null && o.estado_conexion !== ESTADO_CONEXION.ONLINE).length,
    potencia_fuera: activas.filter((o) => potenciaFueraDeRango(o.potencia_dbm)).length,
    afectadas: activas.filter(afectaAlGrupo).length,
    potencia_promedio: potencias.length
      ? Math.round((potencias.reduce((a, p) => a + p, 0) / potencias.length) * 100) / 100
      : null,
  };
}

export function clasificarCaja(c: {
  total: number;
  afectadas: number;
  caidas: number;
  potencia_fuera: number;
  alertas_abiertas: number;
  falla_caja_abierta: boolean;
}): EstadoCaja {
  if (c.total === 0) return 'SIN_ONT';
  if (c.falla_caja_abierta) return 'CAIDA';
  // El padron minimo es el mismo del motor: con 2 ONT conocidas de 16 en la
  // calle, "100 % caida" manda a buscar una falla que no existe.
  if (c.total >= MIN_ONT_PARA_FALLA_CAJA && (c.afectadas * 100) / c.total >= UMBRAL_FALLA_CAJA_PCT) {
    return 'CAIDA';
  }
  if (c.caidas > 0 || c.potencia_fuera > 0 || c.alertas_abiertas > 0) return 'DEGRADADA';
  return 'OK';
}

type Coordenada = number | { toString(): string } | null;

export interface CajaTopologia {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  numero_poste: string | null;
  latitud: Coordenada;
  longitud: Coordenada;
}

export interface SaludCaja {
  id_caja_nap: number;
  identificador_unico: string | null;
  zona: string | null;
  numero_poste: string | null;
  latitud: number | null;
  longitud: number | null;
  estado: EstadoCaja;
  onts: ConteoOnts;
  alertas_abiertas: number;
  ots_abiertas: number;
}

export interface ResumenSalud {
  cajas: number;
  por_estado: Record<EstadoCaja, number>;
  con_alerta_u_ot: number;
  sin_ubicacion: number;
  clientes_afectados: number;
}

const aNumero = (v: Coordenada): number | null => (v == null ? null : Number(v.toString()));

/** Agrupa por `id_caja_nap`, descartando lo que no cuelga de ninguna caja. */
function porCaja<T extends { id_caja_nap: number | null }>(items: T[]): Map<number, T[]> {
  const m = new Map<number, T[]>();
  for (const it of items) {
    if (it.id_caja_nap == null) continue;
    m.set(it.id_caja_nap, [...(m.get(it.id_caja_nap) ?? []), it]);
  }
  return m;
}

export function saludDeCaja(
  caja: CajaTopologia,
  onts: EstadoOnt[],
  alertas: { tipo: string }[],
  ots_abiertas: number,
  ahora: Date,
): SaludCaja {
  const conteo = resumirOnts(onts, ahora);
  return {
    id_caja_nap: caja.id_caja_nap,
    identificador_unico: caja.identificador_unico,
    zona: caja.zona,
    numero_poste: caja.numero_poste,
    latitud: aNumero(caja.latitud),
    longitud: aNumero(caja.longitud),
    estado: clasificarCaja({
      ...conteo,
      alertas_abiertas: alertas.length,
      falla_caja_abierta: alertas.some((a) => a.tipo === TIPO_ALERTA.FALLA_CAJA_NAP),
    }),
    onts: conteo,
    alertas_abiertas: alertas.length,
    ots_abiertas,
  };
}

export function armarSaludCajas(
  cajas: CajaTopologia[],
  onts: EstadoOnt[],
  alertasAbiertas: { id_caja_nap: number | null; tipo: string }[],
  otsAbiertas: { id_caja_nap: number | null }[],
  ahora: Date,
): { resumen: ResumenSalud; cajas: SaludCaja[] } {
  const ontsPorCaja = porCaja(onts);
  const alertasPorCaja = porCaja(alertasAbiertas);
  const otsPorCaja = porCaja(otsAbiertas);

  const salud = cajas
    .map((c) =>
      saludDeCaja(
        c,
        ontsPorCaja.get(c.id_caja_nap) ?? [],
        alertasPorCaja.get(c.id_caja_nap) ?? [],
        otsPorCaja.get(c.id_caja_nap)?.length ?? 0,
        ahora,
      ),
    )
    .sort(
      (a, b) =>
        GRAVEDAD[a.estado] - GRAVEDAD[b.estado] ||
        b.onts.afectadas - a.onts.afectadas ||
        (a.identificador_unico ?? '').localeCompare(b.identificador_unico ?? ''),
    );

  const por_estado: Record<EstadoCaja, number> = { CAIDA: 0, DEGRADADA: 0, OK: 0, SIN_ONT: 0 };
  for (const c of salud) por_estado[c.estado]++;

  return {
    resumen: {
      cajas: salud.length,
      por_estado,
      con_alerta_u_ot: salud.filter((c) => c.alertas_abiertas > 0 || c.ots_abiertas > 0).length,
      sin_ubicacion: salud.filter((c) => c.latitud == null || c.longitud == null).length,
      clientes_afectados: salud.reduce((a, c) => a + c.onts.afectadas, 0),
    },
    cajas: salud,
  };
}
