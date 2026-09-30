import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { ORIGEN_TICKET, PRIORIDAD_TICKET } from '../tickets.constants.js';

/**
 * CU-29 "Creando un ticket de soporte".
 *
 * `id_cliente` es opcional a proposito: el modelo lo tiene como `Int?` y un
 * ticket puede entrar por telefono antes de saber quien llama. Un ticket sin
 * cliente NO puede escalar a OT --`crearOT` necesita el RUT--, y eso se valida
 * en la escalacion, no aca: rechazarlo al crear obligaria al operador a tener
 * identificado al cliente antes de poder anotar el caso.
 */
export class CrearTicketDto {
  @IsInt()
  @IsPositive()
  id_categoria: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  id_cliente?: number;

  @IsString()
  @MinLength(10, { message: 'La descripción debe tener al menos 10 caracteres' })
  @MaxLength(2000)
  descripcion: string;

  @IsOptional()
  @IsIn(Object.values(PRIORIDAD_TICKET))
  prioridad?: string;

  @IsOptional()
  @IsIn(Object.values(ORIGEN_TICKET))
  origen?: string;

  /** Si se manda, el ticket queda asignado desde el minuto cero. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  id_usuario_asignado?: number;
}
