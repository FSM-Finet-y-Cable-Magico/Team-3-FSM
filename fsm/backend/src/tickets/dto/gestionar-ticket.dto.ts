import { IsBoolean, IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { ESTADO_TICKET, PRIORIDAD_TICKET } from '../tickets.constants.js';

/**
 * CU-30 parte 2 "Gestionando un ticket": asignar, cambiar estado y cerrar.
 *
 * Va todo en un PATCH y no en tres endpoints porque son el mismo gesto del
 * jefe tecnico sobre la misma fila, y separarlos obligaria a la Vista a
 * encadenar llamadas para "asignar y pasar a EN_ATENCION", que es el caso
 * normal. El servicio rechaza un cuerpo vacio.
 */
export class GestionarTicketDto {
  /**
   * `null` explicito desasigna. Por eso no lleva @IsPositive: null es un valor
   * valido aca, igual que en `EditarPuertoDto.id_cliente_asociado`.
   */
  @IsOptional()
  @IsInt()
  id_usuario_asignado?: number | null;

  @IsOptional()
  @IsIn(Object.values(ESTADO_TICKET))
  estado?: string;

  @IsOptional()
  @IsIn(Object.values(PRIORIDAD_TICKET))
  prioridad?: string;

  /**
   * CU-56 "modalidad de resolucion". Vive en el ticket y no en la OT porque el
   * caso que interesa es justamente el que se resolvio SIN ir a terreno.
   */
  @IsOptional()
  @IsBoolean()
  resuelto_remotamente?: boolean;

  /** Se concatena a la descripcion con fecha; no la reemplaza. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  nota?: string;
}

/**
 * CU-32 "Reclasificando un ticket".
 *
 * Va aparte del PATCH general porque no es un campo mas: cambiar la categoria
 * recalcula el SLA, y eso mueve el plazo comprometido con el cliente. Tiene su
 * propio endpoint para que quede auditado como lo que es, y para poder exigir
 * un motivo.
 */
export class ReclasificarTicketDto {
  @IsInt()
  @IsPositive()
  id_categoria: number;

  @IsString()
  @MinLength(10, { message: 'El motivo debe tener al menos 10 caracteres' })
  @MaxLength(500)
  motivo: string;
}
