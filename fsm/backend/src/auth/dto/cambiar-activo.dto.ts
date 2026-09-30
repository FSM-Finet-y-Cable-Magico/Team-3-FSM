import { IsBoolean } from 'class-validator';

/** CU-43: activar o desactivar una cuenta. */
export class CambiarActivoDto {
  @IsBoolean()
  activo: boolean;
}
