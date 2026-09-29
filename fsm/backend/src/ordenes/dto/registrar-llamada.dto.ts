import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** CU-31: lo que el jefe tecnico anota despues de llamar al cliente. */
export class RegistrarLlamadaDto {
  @IsIn(['CONFORME', 'NO_CONFORME', 'SIN_RESPUESTA'])
  resultado: 'CONFORME' | 'NO_CONFORME' | 'SIN_RESPUESTA';

  /** Obligatorio con NO_CONFORME: es el reclamo que va a la OT nueva. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;
}
