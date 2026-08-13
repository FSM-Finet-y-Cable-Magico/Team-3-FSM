import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ActualizarEstadoDto {
  @IsIn(['PENDIENTE', 'ASIGNADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA', 'PENDIENTE_CLIENTE_AUSENTE'])
  estado: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  obs_cancelacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  obs_cliente_ausente?: string;
}
