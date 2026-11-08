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
   * usuario autenticado, asi que quien cierra ES el asignado.
   *
   * ESTE ID NO SIRVE FUERA DEL FSM. Es nuestro `usuario.id_usuario` y no
   * existe en la base de G1 ni en la de G8: G8 reporto el 8-11 que la OT 56
   * venia con el tecnico 4 y que ese usuario no estaba registrado. Se mantiene
   * por compatibilidad con lo que ya consumen, pero para cruzar va `tecnico`.
   *
   * Nullable porque el tipo del modelo lo es, aunque en la practica una OT
   * cerrada siempre lo trae: sin tecnico asignado no se puede cerrar.
   */
  id_tecnico: number | null;
  /**
   * El mismo tecnico, por clave natural: `usuario.nombre_usuario`, que es
   * unico en el FSM y estable entre despliegues. Es con lo que los otros
   * grupos pueden cruzar sin conocer nuestros ids.
   *
   * SE MANTIENE LA MINIMA EXPOSICION. No viaja el nombre completo: lo que
   * faltaba no era la identidad de la persona sino un identificador que el
   * receptor pudiera resolver, y un nombre de usuario alcanza para atribuir
   * un movimiento de equipos sin mandar el nombre legal de un trabajador.
   *
   * El comentario anterior decia "si G1 necesita mostrarlos, los consulta",
   * pero no hay con que: `IntegracionesController` expone doce endpoints y
   * ninguno devuelve usuarios. Si G1 llega a necesitar el nombre para mostrar,
   * se agrega ese endpoint y se decide ahi que exponer, en vez de meterlo en
   * un payload que tambien recibe G8.
   *
   * Mismo criterio que el cliente, que viaja por `rut`, y que los equipos, que
   * viajan por `numero_serie` y nunca por `id_unidad`.
   */
  usuario_tecnico: string | null;
  cliente: { rut: string | null; nombre: string } | null;
  direccion: { direccion_completa: string; comuna: string } | null;
  categoria_falla: { id_categoria: number; nombre: string } | null;
  categoria_falla_otro: string | null;
  /**
   * Consumibles gastados en la visita (los equipos con numero de serie van en
   * `equipos_instalados` / `equipos_retirados`).
   *
   * `id_tipo_equipo` es nuestro y no significa nada en el inventario de G1:
   * sus catalogos se cargaron por separado y los ids no coinciden. Por eso va
   * `nombre`, que es con lo que pueden cruzar contra su propio catalogo.
   *
   * `nombre` puede venir vacio si la fila de uso quedo apuntando a un tipo
   * borrado; es una fila huerfana, no un caso normal.
   */
  materiales: { id_tipo_equipo: number; nombre: string; cantidad: number }[];
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
