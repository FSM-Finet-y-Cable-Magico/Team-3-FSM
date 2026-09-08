import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';
import { CANAL_NOTIFICACION } from '../notificaciones.constants.js';

export class NotificarAlertaDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  id_plantilla: number;

  /** Si no viene, se usa el canal de la plantilla. */
  @IsOptional()
  @IsIn(Object.values(CANAL_NOTIFICACION))
  canal?: string;
}
