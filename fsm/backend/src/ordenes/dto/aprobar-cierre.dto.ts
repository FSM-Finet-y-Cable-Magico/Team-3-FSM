import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AprobarCierreDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;
}
