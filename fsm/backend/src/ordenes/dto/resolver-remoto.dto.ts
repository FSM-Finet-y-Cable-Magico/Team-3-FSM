import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** CU-56: el jefe tecnico resuelve una OT a distancia, sin visita. */
export class ResolverRemotoDto {
  /** Que se hizo. Obligatorio: es lo unico que queda de la resolucion. */
  @IsString()
  @MaxLength(1000)
  observaciones: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  id_categoria_falla?: number;
}
