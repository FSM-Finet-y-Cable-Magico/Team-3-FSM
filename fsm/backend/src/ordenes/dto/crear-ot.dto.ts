import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsInt,
  IsPositive,
  IsDateString,
  MaxLength,
} from 'class-validator';

export class CrearOtDto {
  @IsString()
  @IsNotEmpty()
  rut_cliente: string;

  @IsIn(['INSTALACION', 'REPARACION', 'REEMPLAZO', 'PREVENTIVO', 'BAJA'])
  tipo_ot: string;

  @IsOptional()
  @IsIn(['CRITICA', 'ALTA', 'MEDIA', 'BAJA'])
  prioridad?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  id_tecnico?: number;

  @IsOptional()
  @IsDateString()
  bloque_horario?: string;

  @IsOptional()
  @IsInt()
  id_direccion?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observaciones?: string;

  /**
   * CU-35, excepcion 1: el administrador anula el bloqueo por lista roja con
   * una justificacion escrita. Solo lo acepta si quien crea la OT es ADMIN.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  justificacion_lista_roja?: string;
}
