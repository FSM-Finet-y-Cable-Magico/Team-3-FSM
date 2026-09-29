/**
 * Notificación del cierre de OT a los otros sistemas (ACUERDO G1↔G3).
 *
 * El cierre se compromete SIEMPRE en local primero (OT→COMPLETADA, fotos,
 * uso_material_ot, llamada, historial). Esto es best-effort y nunca bloquea ni
 * revierte el cierre: si falla, G1 reconcilia por `GET /api/integraciones/
 * ordenes/:id/cierre`.
 *
 * Destinos:
 *   - G1: valida saldo y descuenta stock una sola vez; aplica transiciones de
 *     equipo según `accion`; genera el SRV-YYYY-XXXXX.
 *   - G8: activa el cliente tras la instalación (G8-CU-07).
 */

export interface EquipoDeclarado {
  numero_serie: string;
  accion: string;
  /** Literal de G1 al que mapea `accion` (tentativo, G1 confirma). */
  estado_g1: string;
  motivo?: string;
  observacion_estado_fisico?: string;
  /**
   * Diagnostico de la lista fija de G1. Solo tiene sentido al retirar.
   * Si no viene, G1 asume "Causa desconocida" y usa `motivo` (acordado).
   */
  diagnostico?: string;
}

export interface PayloadCierre {
  /** id_ot + fecha_completada ISO. El receptor ignora duplicados. */
  clave_idempotencia: string;
  id_ot: number;
  id_empresa: number | null;
  tipo_ot: string;
  fecha_completada: string;
  resultado_llamada: string;
  potencia_optica_dbm: number;
  resuelto_remotamente: boolean;
  /**
   * Tecnico que ejecuto y cerro la OT. Lo pidio G1 el 28-09 para atribuir el
   * movimiento de equipos a una persona.
   *
   * Es inequivoco: `cerrarOT` exige rol TECNICO y que `ot.id_tecnico` sea el
   * usuario autenticado, asi que quien cierra ES el asignado. Va el id y no el
   * nombre por minima exposicion; si G1 necesita mostrarlo, lo consulta.
   *
   * Nullable porque el tipo del modelo lo es, aunque en la practica una OT
   * cerrada siempre lo trae: sin tecnico asignado no se puede cerrar.
   */
  id_tecnico: number | null;
  cliente: { rut: string | null; nombre: string } | null;
  direccion: { direccion_completa: string; comuna: string } | null;
  categoria_falla: { id_categoria: number; nombre: string } | null;
  categoria_falla_otro: string | null;
  materiales: { id_tipo_equipo: number; cantidad: number }[];
  equipos_instalados: EquipoDeclarado[];
  equipos_retirados: EquipoDeclarado[];
  /**
   * P0-c del acuerdo con G8: correlacion con la solicitud de instalacion que
   * origino la OT. G8 la usa para activar al cliente del contrato correcto.
   *
   * Opcionales, y van null en toda OT que no pidio G8 --hoy, casi todas--. El
   * mismo payload lo recibe G1, que no conoce el CRM: si fueran obligatorios,
   * cualquier cierre ajeno a G8 quedaria invalido contra el contrato.
   */
  request_id: string | null;
  trace_id: string | null;
  id_prospecto: number | null;
  id_contrato: number | null;
  id_plan: number | null;
}

export interface FanOutCierre {
  readonly nombre: string;
  /** Best-effort. NUNCA lanza. */
  notificar(payload: PayloadCierre): Promise<void>;
}

export const FAN_OUT_CIERRE = Symbol('FAN_OUT_CIERRE');
