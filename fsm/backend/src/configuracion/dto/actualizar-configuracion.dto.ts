import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  UMBRAL_DESCONEXION_MAX,
  UMBRAL_DESCONEXION_MIN,
} from '../../monitoreo/monitoreo.constants.js';

export class ActualizarConfiguracionDto {
  /**
   * RF-46: "El valor de N es configurable por el administrador en un rango de
   * 10 a 120 minutos". El rango sale de las constantes del modulo de monitoreo,
   * que es quien lee el valor: si alguna vez cambia, cambia en un solo lugar.
   *
   * `null` explicito devuelve la empresa al valor por defecto del sistema;
   * omitir el campo deja el que tenga.
   */
  @IsOptional()
  @IsInt({ message: 'El umbral debe ser un número entero de minutos' })
  @Min(UMBRAL_DESCONEXION_MIN, {
    message: `El umbral no puede ser menor a ${UMBRAL_DESCONEXION_MIN} minutos`,
  })
  @Max(UMBRAL_DESCONEXION_MAX, {
    message: `El umbral no puede ser mayor a ${UMBRAL_DESCONEXION_MAX} minutos`,
  })
  umbral_desconexion_min?: number | null;
}
