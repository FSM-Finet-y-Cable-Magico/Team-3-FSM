import { ConfigService } from '@nestjs/config';

/**
 * CUANDO se avisa el cierre a G1 y G8 (MOD RF-04, aprobacion del cierre).
 *
 *  - `CIERRE`: al cerrar el tecnico, como siempre. Es el valor por defecto.
 *  - `APROBACION`: recien cuando el jefe tecnico o el administrador aprueba.
 *
 * Existe porque mover el aviso cambia el contrato con dos grupos: el fan-out es
 * lo que dispara el descuento de stock en G1 y la activacion del cliente en G8.
 * Se pasa a `APROBACION` SOLO cuando los dos hayan acusado recibo del aviso
 * (B-02 del plan). Mientras tanto, un cierre rechazado ya fue avisado: es la
 * deuda documentada, no un descuido.
 *
 * Variable: `CIERRE_FAN_OUT_MOMENTO=APROBACION`. Cualquier otro valor, o
 * ninguno, es `CIERRE`: equivocarse en el nombre deja el comportamiento
 * conocido, no uno nuevo.
 */
export type MomentoFanOut = 'CIERRE' | 'APROBACION';

export const MOMENTO_FAN_OUT = Symbol('MOMENTO_FAN_OUT');

/**
 * Tipo de OT con el que G8 pide un retiro por morosidad. Vive aca y no en un
 * `enum` porque `orden_trabajo.tipo_ot` es texto libre en la base compartida.
 */
export const TIPO_OT_BAJA = 'BAJA';

/**
 * El momento efectivo para UNA OT, que no siempre es el global.
 *
 * Una BAJA avisa SIEMPRE al aprobar, aunque la variable diga `CIERRE`. Lo pidio
 * G8 el 12-11-2026 y hay dos razones para concederlo sin condicionarlo a la
 * variable:
 *
 *  1. El aviso de una baja es lo que hace que G8 corte el servicio y devuelva al
 *     cliente a Prospectos. Avisarlo antes de la aprobacion significa cortarle
 *     el internet a alguien por un cierre que el jefe tecnico todavia puede
 *     rechazar.
 *  2. Resuelve el choque de claves que G8 levanto. `fecha_completada` se
 *     conserva tras un rechazo a proposito (ver cerrarOT), asi que un cierre
 *     corregido reusa la clave `id_ot + fecha_completada`. Con un unico aviso
 *     por OT no hay dos avisos que distinguir y la clave deja de importar.
 *
 * La variable sigue mandando en INSTALACION y REPARACION: ahi el aviso al
 * cierre es el comportamiento que G1 y G8 ya tienen en produccion, y moverlo es
 * el cambio coordinado que todavia esta pendiente (B-02 del plan).
 */
export function momentoPara(tipo_ot: string, global: MomentoFanOut): MomentoFanOut {
  return tipo_ot === TIPO_OT_BAJA ? 'APROBACION' : global;
}

export function leerMomentoFanOut(valor: string | undefined): MomentoFanOut {
  return valor?.trim().toUpperCase() === 'APROBACION' ? 'APROBACION' : 'CIERRE';
}

export const momentoFanOutProvider = {
  provide: MOMENTO_FAN_OUT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): MomentoFanOut =>
    leerMomentoFanOut(config.get<string>('CIERRE_FAN_OUT_MOMENTO')),
};

/**
 * Estados de OT cuyo cierre ya se aviso a G1 y G8, y que por lo tanto el GET de
 * reconciliacion tiene que poder devolver. Con el aviso al cierre del tecnico,
 * una OT que espera aprobacion ya fue avisada.
 *
 * Para una BAJA hay que pasar `momentoPara('BAJA', ...)`, no el global: una baja
 * que espera aprobacion NO se aviso, y devolverla por el GET le diria a G8 que
 * el retiro esta cerrado cuando todavia puede rechazarse.
 */
export function estadosAvisados(momento: MomentoFanOut): string[] {
  return momento === 'APROBACION' ? ['COMPLETADA'] : ['COMPLETADA', 'PENDIENTE_APROBACION'];
}
