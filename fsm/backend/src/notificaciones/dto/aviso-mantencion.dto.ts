import { IsBoolean, IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { CANAL_NOTIFICACION } from '../notificaciones.constants.js';

/** CU-50: programar el aviso anticipado de una OT de mantencion. */
export class AvisoMantencionDto {
  /** Plantilla de tipo MANTENCION_PROGRAMADA (CU-49). */
  @IsInt()
  @IsPositive()
  id_plantilla: number;

  @IsOptional()
  @IsIn(Object.values(CANAL_NOTIFICACION))
  canal?: string;

  /**
   * Excepcion 1: con menos de 24 horas, el jefe tecnico confirma que se envie
   * de inmediato.
   */
  @IsOptional()
  @IsBoolean()
  inmediato?: boolean;
}
