import { IsInt, IsPositive } from 'class-validator';

/**
 * Reasignar no es lo mismo que asignar: `asignar` toma una OT en PENDIENTE y la
 * pasa a ASIGNADA, y aca la OT ya tiene tecnico. Es la accion que RF-45 pide
 * desde el panel de OT detenidas, donde las OT estan en ASIGNADA o EN_CURSO.
 */
export class ReasignarTecnicoDto {
  @IsInt()
  @IsPositive()
  id_tecnico: number;
}
