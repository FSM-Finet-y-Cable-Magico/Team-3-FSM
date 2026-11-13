import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegistrarCorteDto {
  @IsIn(['CORTE', 'REACTIVACION'])
  accion!: 'CORTE' | 'REACTIVACION';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacion?: string;
}
