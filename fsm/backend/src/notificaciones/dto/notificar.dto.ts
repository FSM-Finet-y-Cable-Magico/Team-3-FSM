import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
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

  /**
   * RF-42: el tiempo estimado de ESTE incidente. Si no viene se usa el de la
   * plantilla. Va aca y no solo en la plantilla porque dos cortes de la misma
   * caja no duran lo mismo, y el jefe tecnico lo sabe recien cuando ocurre.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tiempo_estimado?: string;
}
