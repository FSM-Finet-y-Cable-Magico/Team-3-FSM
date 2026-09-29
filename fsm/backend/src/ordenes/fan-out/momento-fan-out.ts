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
 */
export function estadosAvisados(momento: MomentoFanOut): string[] {
  return momento === 'APROBACION' ? ['COMPLETADA'] : ['COMPLETADA', 'PENDIENTE_APROBACION'];
}
