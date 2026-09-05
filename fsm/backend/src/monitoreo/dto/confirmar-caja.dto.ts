import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class ConfirmarCajaDto {
  /**
   * Caja que el técnico verificó en terreno. `null` es válido y significa
   * "no cuelga de ninguna caja del mapa" (instalación interna de un edificio).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  id_caja_nap?: number | null;

  /** Aplicar también a las ONT del mismo puerto PON y misma caja. Por defecto sí. */
  @IsOptional()
  @IsBoolean()
  propagar?: boolean;
}
