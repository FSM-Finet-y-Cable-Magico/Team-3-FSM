import {
  ACCION_EQUIPO,
  ORIGENES_VALIDOS_G1,
  type AccionEquipo,
} from './estado-equipo.constants.js';

/**
 * Validacion de la serie de un equipo declarado al cerrar una OT.
 *
 * POR QUE EXISTE. El tecnico escribe la serie a mano y antes nadie la miraba
 * hasta que G1 procesaba el cierre, ya aprobado y con el tecnico lejos del
 * domicilio. Javier (G1) lo habia pedido como lo mas urgente: "validar la serie
 * ANTES de que el tecnico cierre". El acuerdo original decia que G3 no lee
 * `unidad_equipo`, pero era porque estabamos en bases separadas; en la base
 * compartida `g3_app` la puede leer y la validacion no depende de una API.
 *
 * Las reglas son las de la maquina de estados de G1 (`ORIGENES_VALIDOS_G1`),
 * no unas propias: lo que aca se rechaza es exactamente lo que G1 rechazaria.
 *
 * Retirar una serie que NO esta en el inventario se deja pasar a proposito
 * (decision del 8-nov-2026): un equipo que ya estaba en la casa del cliente
 * puede ser anterior al inventario o tener la etiqueta gastada, y bloquear
 * dejaria al tecnico sin poder cerrar. G1 registra la discrepancia.
 */

export interface UnidadInventario {
  numero_serie: string;
  estado: string;
  id_empresa: number | null;
  id_tecnico_asignado: number | null;
}

export interface EquipoAValidar {
  numero_serie: string;
  accion: AccionEquipo;
}

/** El problema de un equipo, en palabras para el tecnico, o null si esta bien. */
export function problemaDeEquipo(
  equipo: EquipoAValidar,
  unidad: UnidadInventario | undefined,
  ctx: { id_empresa: number; id_tecnico: number },
): string | null {
  const serie = equipo.numero_serie;
  const estado = unidad?.estado.trim();
  const deOtraEmpresa = unidad != null && unidad.id_empresa !== ctx.id_empresa;

  if (equipo.accion === ACCION_EQUIPO.INSTALADO_EN_CLIENTE) {
    if (!unidad || deOtraEmpresa)
      return `El equipo ${serie} no existe en el inventario de la empresa`;
    if (!ORIGENES_VALIDOS_G1.INSTALADO_EN_CLIENTE.includes(estado!)) {
      return `El equipo ${serie} no se puede instalar: está "${estado}"`;
    }
    if (unidad.id_tecnico_asignado !== ctx.id_tecnico)
      return `El equipo ${serie} no está asignado a usted`;
    return null;
  }

  // Retiro.
  if (!unidad) return null;
  if (deOtraEmpresa) return `El equipo ${serie} pertenece a otra empresa`;
  if (!ORIGENES_VALIDOS_G1[equipo.accion].includes(estado!)) {
    return `El equipo ${serie} no se puede retirar: está "${estado}"`;
  }
  return null;
}
