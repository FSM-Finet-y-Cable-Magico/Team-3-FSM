import { IsInt, IsOptional, IsPositive, Max } from 'class-validator';
import { Type } from 'class-transformer';

/** Query params de `GET /api/monitoreo/ont`. */
export class ConsultaLecturasDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(200)
  limit?: number = 50;
}
