import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { NIVELES_RIESGO, type NivelRiesgo } from '../lista-roja.js';

/**
 * MOD RF-32. El minimo de 20 caracteres para AMARILLO y ROJO lo valida el
 * servicio, porque depende del nivel y el mensaje es el del CU.
 */
export class CambiarNivelRiesgoDto {
  @IsIn(NIVELES_RIESGO)
  nivel: NivelRiesgo;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
