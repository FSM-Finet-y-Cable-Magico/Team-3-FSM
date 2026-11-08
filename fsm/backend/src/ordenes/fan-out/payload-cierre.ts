import type { Prisma } from '../../../generated/prisma/client.js';
import type { EquipoDeclarado, PayloadCierre } from './fan-out-cierre.js';
import { rutParaApi } from '../../common/utils/rut.util.js';
import { conDireccionResuelta } from '../direccion-ot.js';

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
} satisfies Prisma.orden_trabajoInclude;

export type OtParaPayload = Prisma.orden_trabajoGetPayload<{ include: typeof INCLUDE_PAYLOAD_CIERRE }>;

export function construirPayloadCierre(ot: OtParaPayload): PayloadCierre {
  const equipos = (ot.cierre_equipos as { instalados?: EquipoDeclarado[]; retirados?: EquipoDeclarado[] } | null) ?? {};
  const fecha = (ot.fecha_completada ?? ot.fecha_creacion).toISOString();
  const origen = ot.solicitud_integracion;

  return {
    clave_idempotencia: `${ot.id_ot}:${fecha}`,
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
    equipos_instalados: equipos.instalados ?? [],
    equipos_retirados: equipos.retirados ?? [],
    request_id: origen?.request_id ?? null,
    trace_id: origen?.trace_id ?? null,
    id_prospecto: origen?.id_prospecto_externo ?? null,
    id_contrato: origen?.id_contrato_externo ?? null,
    id_plan: origen?.id_plan_externo ?? null,
  };
}
