import { IsDateString, IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { ORIGENES_DIGITALES, ORIGENES_INTERNOS, type OrigenTicket } from '../tickets.constants.js';

/**
 * CU-29 desde la Vista: el jefe tecnico registra el problema que el cliente
 * reporta por telefono, en persona o por correo. El RUT se valida en el
 * servicio para responder con el mensaje del CU.
 */
export class CrearTicketDto {
  @IsString()
  @MaxLength(12)
  rut_cliente: string;

  @IsInt()
  @IsPositive()
  id_categoria: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsIn(ORIGENES_INTERNOS)
  origen: OrigenTicket;
}

/** CU-29 desde un canal digital de otro grupo (portal, bot, WhatsApp). */
export class CrearTicketIntegracionDto {
  @IsInt()
  @IsPositive()
  id_empresa: number;

  @IsString()
  @MaxLength(12)
  rut_cliente: string;

  @IsInt()
  @IsPositive()
  id_categoria: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsIn(ORIGENES_DIGITALES)
  origen: OrigenTicket;
}

export class AsignarTicketDto {
  @IsInt()
  @IsPositive()
  id_usuario: number;
}

export class ResolverTicketDto {
  /** CU-30: "cierra el ticket con estado RESUELTO y una observacion". */
  @IsString()
  @MaxLength(1000)
  observacion: string;
}

/**
 * CU-30: derivar el ticket a una OT de terreno. Solo tipos de OT que resuelven
 * un problema de servicio: una instalacion o una baja no nacen de un reclamo.
 */
export class EscalarTicketDto {
  @IsOptional()
  @IsIn(['REPARACION', 'REEMPLAZO', 'PREVENTIVO'])
  tipo_ot?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  id_tecnico?: number;

  @IsOptional()
  @IsDateString()
  bloque_horario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;
}

export class ReclasificarTicketDto {
  @IsInt()
  @IsPositive()
  id_categoria: number;
}
