import { IsIn } from 'class-validator';

/** Las cuatro que usa el sistema; `prioridad` es VARCHAR(10) en la base. */
export const PRIORIDADES = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'] as const;

export class CambiarPrioridadDto {
  @IsIn(PRIORIDADES, { message: 'Prioridad no válida' })
  prioridad: (typeof PRIORIDADES)[number];
}
