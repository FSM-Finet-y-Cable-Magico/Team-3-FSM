import { Prisma } from '../../../generated/prisma/client.js';
import type { EquipoDeclarado, EquipoFaltante, PayloadCierre } from './fan-out-cierre.js';
import { rutParaApi } from '../../common/utils/rut.util.js';
import { conDireccionResuelta } from '../direccion-ot.js';
import { TIPO_OT_BAJA } from './momento-fan-out.js';
import type { ReparacionDeclarada } from '../reparacion-cierre.constants.js';

/**
 * Lo que guarda `orden_trabajo.cierre_equipos`.
 *
 * El nombre de la columna quedo corto: nacio para los equipos declarados y hoy
 * guarda tambien los datos de reparacion que pide G1. Se reuso en vez de crear
 * columnas porque contra la base compartida `finet_global_validacion` no
 * tenemos CREATE, y agregarlas dependia de que el administrador las crease.
 *
 * Las dos secciones son INDEPENDIENTES: una reparacion puede no mover ningun
 * equipo, y una instalacion no tiene datos de reparacion.
 *
 * Se declara aca, junto a `construirPayloadCierre`, porque este es el unico
 * archivo que lee la columna: teniendo al lector y al escritor en el mismo
 * lugar, la forma no se puede desincronizar.
 */
export interface CierreGuardado {
  instalados?: EquipoDeclarado[];
  retirados?: EquipoDeclarado[];
  /** Equipos que no se recuperaron (acuerdo G1↔G3 del 12-11-2026). */
  faltantes?: EquipoFaltante[];
  reparacion?: ReparacionDeclarada;
}

/**
 * Arma el valor de la columna, o `JsonNull` si no hay nada que guardar.
 *
 * Se construye por partes y no con un `if` sobre los equipos: cuando lo decidia
 * solo la presencia de equipos, una reparacion sin equipos dejaba la columna en
 * null y los tres datos de G1 se perdian entre el cierre y la aprobacion, que
 * es cuando se leen para armar el aviso.
 */
export function cierreGuardado(
  instalados: EquipoDeclarado[],
  retirados: EquipoDeclarado[],
  reparacion: ReparacionDeclarada | null,
  faltantes: EquipoFaltante[] = [],
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const guardado: CierreGuardado = {};
  if (instalados.length || retirados.length) {
    guardado.instalados = instalados;
    guardado.retirados = retirados;
  }
  // En su propio `if`: un retiro puede no mover ningun equipo y traer solo
  // faltantes --es justo el caso de una baja donde el cliente no entrego
  // nada--, y colgarlo del `if` de arriba habria perdido la lista entera.
  if (faltantes.length) guardado.faltantes = faltantes;
  if (reparacion) guardado.reparacion = reparacion;

  return Object.keys(guardado).length
    ? (guardado as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;
}

/**
 * Lo que hay que leer de una OT cerrada para armar su payload. Lo usan el
 * webhook (`OrdenesService`) y el GET de reconciliacion
 * (`IntegracionesService.cierre`): leen la misma fila con el mismo `include` y
 * la pasan por el mismo constructor, y asi el acuerdo con G1 y G8 --"el GET
 * devuelve exactamente lo mismo que el webhook"-- se cumple por construccion y
 * no por disciplina.
 */
export const INCLUDE_PAYLOAD_CIERRE = {
  cliente: { select: { rut: true, nombre_completo: true } },
  direccion: { select: { direccion_completa: true, comuna: true } },
  categoria_falla: { select: { id_categoria: true, nombre: true } },
  // El nombre del tipo va junto al id porque el id es NUESTRO y no significa
  // nada en la base de G1 (ver `materiales` en PayloadCierre).
  materiales: {
    select: { id_tipo_equipo: true, cantidad: true, tipo_equipo: { select: { nombre: true } } },
  },
  // Solo el nombre de usuario: es la clave con la que los otros grupos
  // cruzan al tecnico. El nombre completo no viaja (ver PayloadCierre).
  tecnico: { select: { nombre_usuario: true } },
  llamada: { select: { resultado: true } },
  solicitud_integracion: {
    select: {
      request_id: true,
      trace_id: true,
      id_prospecto_externo: true,
      id_contrato_externo: true,
      id_plan_externo: true,
      // Para resolver la direccion cuando la OT no tiene fila propia en
      // `direccion_servicio`, que es el caso de las que pide G8.
      direccion_completa: true,
      comuna: true,
    },
  },
  // `solicitud_baja` NO va aca: ver `completarSolicitudBaja`.
} satisfies Prisma.orden_trabajoInclude;

/**
 * La otra fuente del `request_id`: las OT de BAJA que pide G8 por
 * `POST /integraciones/ordenes-baja`. Sin esto el `request_id` de un retiro
 * viajaba en null, G1 guardaba la recepcion sin clave y G8 no podia encontrar
 * su propia solicitud: el flujo no fallaba, devolvia vacio.
 */
const SELECT_SOLICITUD_BAJA = {
  request_id: true,
  trace_id: true,
  id_cliente_externo: true,
  id_contrato_externo: true,
  id_servicio_externo: true,
  id_solicitud_retiro_externa: true,
  id_ticket_externo: true,
} satisfies Prisma.solicitud_baja_integracionSelect;

export type SolicitudBajaPayload = Prisma.solicitud_baja_integracionGetPayload<{ select: typeof SELECT_SOLICITUD_BAJA }>;

export type OtParaPayload = Prisma.orden_trabajoGetPayload<{ include: typeof INCLUDE_PAYLOAD_CIERRE }> & {
  solicitud_baja: SolicitudBajaPayload | null;
};

/**
 * Le agrega a la OT su solicitud de retiro de G8, si la tiene.
 *
 * Va APARTE del `include` a proposito. En la base global la tabla
 * `solicitud_baja_integracion` la crea el admin, y mientras no exista, juntarla
 * en el `include` hacia fallar el aviso de cierre y la reconciliacion de TODAS
 * las OT, no solo de los retiros. Por eso se consulta solo para las OT de BAJA
 * --las unicas que pueden tener una-- y, si falla, la OT sigue sin ella y se
 * avisa en el log.
 */
export async function completarSolicitudBaja<T extends { id_ot: number; tipo_ot: string }>(
  prisma: { solicitud_baja_integracion: { findUnique: (a: any) => Promise<unknown> } },
  ot: T,
  logger?: { warn(m: string): void },
): Promise<T & { solicitud_baja: SolicitudBajaPayload | null }> {
  if (ot.tipo_ot !== TIPO_OT_BAJA) return { ...ot, solicitud_baja: null };
  try {
    const solicitud = (await prisma.solicitud_baja_integracion.findUnique({
      where: { id_ot: ot.id_ot },
      select: SELECT_SOLICITUD_BAJA,
    })) as SolicitudBajaPayload | null;
    return { ...ot, solicitud_baja: solicitud };
  } catch (e) {
    logger?.warn(`No se pudo leer la solicitud de retiro de la OT ${ot.id_ot}: ${(e as Error)?.message ?? e}`);
    return { ...ot, solicitud_baja: null };
  }
}

export function construirPayloadCierre(ot: OtParaPayload): PayloadCierre {
  const guardado = (ot.cierre_equipos as CierreGuardado | null) ?? {};
  const fecha = (ot.fecha_completada ?? ot.fecha_creacion).toISOString();
  const origen = ot.solicitud_integracion;
  const baja = ot.solicitud_baja;

  return {
    // Una BAJA lleva su propia clave, sin fecha. Se puede porque solo se avisa
    // al aprobar (ver momentoPara), asi que hay UN aviso por OT y no dos que
    // distinguir. Resuelve el choque que levanto G8: `fecha_completada` se
    // conserva tras un rechazo a proposito, asi que un cierre corregido reusaba
    // la clave `id_ot:fecha` --y para los otros tipos de OT sigue siendo lo
    // correcto, porque ahi el aviso al cierre ya esta en produccion--.
    clave_idempotencia: ot.tipo_ot === TIPO_OT_BAJA ? `baja:${ot.id_ot}` : `${ot.id_ot}:${fecha}`,
    id_ot: ot.id_ot,
    id_empresa: ot.id_empresa,
    tipo_ot: ot.tipo_ot,
    fecha_completada: fecha,
    resultado_llamada: ot.llamada?.resultado ?? '',
    potencia_optica_dbm: ot.potencia_optica_dbm == null ? 0 : Number(ot.potencia_optica_dbm),
    resuelto_remotamente: ot.resuelto_remotamente,
    id_tecnico: ot.id_tecnico,
    usuario_tecnico: ot.tecnico?.nombre_usuario ?? null,
    cliente: ot.cliente
      ? { rut: rutParaApi(ot.cliente.rut), nombre: ot.cliente.nombre_completo }
      : null,
    direccion: conDireccionResuelta(ot).direccion,
    categoria_falla: ot.categoria_falla
      ? { id_categoria: ot.categoria_falla.id_categoria, nombre: ot.categoria_falla.nombre }
      : null,
    categoria_falla_otro: ot.categoria_falla_otro,
    materiales: ot.materiales
      .filter((m): m is typeof m & { id_tipo_equipo: number } => m.id_tipo_equipo != null)
      .map((m) => ({
        id_tipo_equipo: m.id_tipo_equipo,
        nombre: m.tipo_equipo?.nombre ?? '',
        cantidad: Number(m.cantidad),
      })),
    equipos_instalados: guardado.instalados ?? [],
    equipos_retirados: guardado.retirados ?? [],
    equipos_faltantes: guardado.faltantes ?? [],
    // Los tres datos de reparacion que pide G1. Van null en todo tipo de OT
    // que no sea REPARACION: ahi no hay diagnostico que informar, y el mismo
    // payload lo recibe G8, que no los usa.
    falla_reportada: guardado.reparacion?.falla_reportada ?? null,
    solucion_aplicada: guardado.reparacion?.solucion_aplicada ?? null,
    resultado: guardado.reparacion?.resultado ?? null,
    // Los dos origenes posibles, en orden: una OT la pidio G8 como instalacion
    // o como retiro, nunca las dos cosas.
    request_id: origen?.request_id ?? baja?.request_id ?? null,
    trace_id: origen?.trace_id ?? baja?.trace_id ?? null,
    id_prospecto: origen?.id_prospecto_externo ?? null,
    id_contrato: origen?.id_contrato_externo ?? baja?.id_contrato_externo ?? null,
    id_plan: origen?.id_plan_externo ?? null,
    id_cliente_externo: baja?.id_cliente_externo ?? null,
    id_servicio: baja?.id_servicio_externo ?? null,
    id_solicitud_retiro: baja?.id_solicitud_retiro_externa ?? null,
    id_ticket_externo: baja?.id_ticket_externo ?? null,
  };
}
