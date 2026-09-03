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
  cliente: { rut: string | null; nombre: string } | null;
  direccion: { direccion_completa: string; comuna: string } | null;
  categoria_falla: { id_categoria: number; nombre: string } | null;
  categoria_falla_otro: string | null;
  materiales: { id_tipo_equipo: number; cantidad: number }[];
  equipos_instalados: EquipoDeclarado[];
  equipos_retirados: EquipoDeclarado[];
}

export interface FanOutCierre {
  readonly nombre: string;
  /** Best-effort. NUNCA lanza. */
  notificar(payload: PayloadCierre): Promise<void>;
}

export const FAN_OUT_CIERRE = Symbol('FAN_OUT_CIERRE');
