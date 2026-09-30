import { IsString, MaxLength, IsOptional, IsEmail, IsIn } from 'class-validator';

export class EditarClienteDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre_completo?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;

  @IsOptional()
  @IsIn(['ACTIVO', 'SUSPENDIDO', 'CORTADO', 'BAJA', 'PENDIENTE'])
  estado?: string;

  // es_conflictivo y obs_conflictivo ya no se editan aca: solo el semaforo de
  // riesgo (PATCH /clientes/:id/riesgo) los cambia, con justificacion y
  // auditoria (MOD RF-32).

  @IsOptional()
  @IsString()
  @MaxLength(200)
  direccion_completa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  comuna?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ciudad?: string;
}
