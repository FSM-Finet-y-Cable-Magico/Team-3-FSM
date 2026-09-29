import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
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

export class ReclasificarTicketDto {
  @IsInt()
  @IsPositive()
  id_categoria: number;
}
