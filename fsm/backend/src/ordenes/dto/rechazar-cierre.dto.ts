import { IsString, MaxLength } from 'class-validator';

export class RechazarCierreDto {
  /**
   * Obligatorio: el tecnico tiene que saber que corregir. El servicio ademas
   * rechaza un motivo que solo trae espacios.
   */
  @IsString()
  @MaxLength(500)
  motivo: string;
}
