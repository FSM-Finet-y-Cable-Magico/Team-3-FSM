/**
 * De donde sale la direccion de una OT.
 *
 * Normalmente de `direccion_servicio`, la tabla del cliente. Pero la OT de
 * instalacion que pide G8 no tiene cliente todavia --esa es la razon de ser
 * del P0-d del acuerdo-- y su direccion viene en el propio payload de la
 * solicitud.
 *
 * Antes se creaba una fila en `direccion_servicio` con `id_cliente` en null
 * para colgarla de ahi. Eso ya no se puede: en la base compartida
 * `finet_global_validacion`, que es la que va a usar FiNet, `g3_app` tiene
 * SELECT sobre esa tabla y nada mas --es del CRM de G8-- asi que el INSERT
 * falla y con el toda la solicitud de instalacion.
 *
 * Y tampoco hacia falta: `solicitud_instalacion_integracion` YA guardaba la
 * misma direccion. Estaba escrita dos veces. Ahora se guarda una sola vez,
 * del lado que si nos pertenece, y se arma al leer.
 *
 * El objeto resultante tiene la MISMA forma que la relacion de Prisma, asi
 * que el frontend no distingue una de otra y no hubo que tocarlo.
 */

export type DireccionOt = { direccion_completa: string; comuna: string };

type OtConDireccion = {
  direccion: DireccionOt | null;
  solicitud_integracion?: DireccionOt | null;
};

/**
 * Devuelve la OT con `direccion` resuelta.
 *
 * No pisa nada: si la OT ya tiene su fila de `direccion_servicio` --que es el
 * caso de todas las que no vienen de G8-- se devuelve tal cual. Solo rellena
 * cuando esta en null y hay una solicitud de la que sacarla.
 */
export function conDireccionResuelta<T extends OtConDireccion>(ot: T): T {
  if (ot.direccion || !ot.solicitud_integracion) return ot;

  const { direccion_completa, comuna } = ot.solicitud_integracion;
  return { ...ot, direccion: { direccion_completa, comuna } };
}
