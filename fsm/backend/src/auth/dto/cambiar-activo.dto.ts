import { IsBoolean } from 'class-validator';

/**
 * CU-43 "Desactivando una cuenta de usuario".
 *
 * Lleva el valor destino en vez de ser un `POST /desactivar` sin cuerpo porque
 * el mismo endpoint tiene que servir para reactivar: si no, reactivar seria
 * otro endpoint, otro rol y otra entrada de auditoria para la operacion
 * inversa de la misma cosa.
 */
export class CambiarActivoDto {
  @IsBoolean()
  activo!: boolean;
}
