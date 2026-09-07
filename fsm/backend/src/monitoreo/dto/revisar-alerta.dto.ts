import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevisarAlertaDto {
  /** Qué se encontró / qué se hizo. Queda en el registro de la alerta. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacion?: string;
}
