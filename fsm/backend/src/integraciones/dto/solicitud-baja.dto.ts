import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { validarRut } from '../../common/utils/rut.util.js';

/**
 * Contrato G8 → G3 de la solicitud de OT de BAJA por morosidad (documento de G8
 * del 12-11-2026, "Flujo propuesto para G3", y nuestra respuesta).
 *
 * Se valida aca aunque G8 valide antes de enviar: un 400 con el campo que falla
 * le dice a G8 que corregir, y un dato malo guardado le llega al tecnico que
 * tiene que ir al domicilio.
 */

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

@ValidatorConstraint({ name: 'rutClienteValido' })
class RutValido implements ValidatorConstraintInterface {
  validate(valor: unknown) {
    return typeof valor === 'string' && validarRut(valor);
  }
  defaultMessage() {
    return 'rut_cliente: digito verificador invalido';
  }
}

/**
 * `request_id` de una baja: `g8-retiro-{id_empresa}-{id_solicitud_retiro}`.
 *
 * NO es UUID v4, al contrario que en instalaciones. Lo fijo asi G8 y G1 ya lo
 * dio por acordado en su documento (§4), asi que cambiarlo ahora romperia a los
 * dos. Se valida la forma igual: el `request_id` es lo que G1 reenvia y lo que
 * G8 usa despues para encontrar su recepcion, asi que uno mal armado no falla
 * al crear la OT sino tres pasos mas adelante, cuando ya nadie lo relaciona.
 *
 * El largo maximo, 150, es el que declaro G1 para su parametro de consulta.
 */
export const PATRON_REQUEST_ID_BAJA = /^g8-retiro-\d+-[A-Za-z0-9_-]{1,100}$/;

export class SolicitudBajaDto {
  @Transform(recortar)
  @IsString()
  @MaxLength(150)
  @Matches(PATRON_REQUEST_ID_BAJA, {
    message: 'request_id: formato g8-retiro-{id_empresa}-{id_solicitud_retiro}',
  })
  request_id: string;

  @IsUUID('4')
  trace_id: string;

  /**
   * Se aceptan y se ignoran: el endpoint ya es el de bajas por morosidad, asi
   * que son redundantes. Se declaran para que `forbidNonWhitelisted` no rechace
   * un cuerpo que los traiga --el documento de G8 los incluye-- y para que el
   * dia que exista otro motivo de baja el campo ya este en el contrato.
   */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tipo_ot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  motivo?: string;

  @IsInt()
  @IsPositive()
  id_empresa: number;

  @IsInt()
  @IsPositive()
  id_cliente_externo: number;

  @IsInt()
  @IsPositive()
  id_contrato_externo: number;

  @IsInt()
  @IsPositive()
  id_servicio_externo: number;

  @IsInt()
  @IsPositive()
  id_solicitud_retiro_externa: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  id_ticket_externo?: number;

  @IsString()
  @Matches(/^\d{7,8}-[\dK]$/, { message: 'rut_cliente: formato 12345678-5, sin puntos y con K mayuscula' })
  @Validate(RutValido)
  rut_cliente: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  direccion_retiro: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  comuna_retiro: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(1000)
  observaciones?: string | null;
}

/**
 * Cancelacion de un retiro: el cliente pago con la OT en curso.
 *
 * El `motivo` es obligatorio. Una OT cancelada sin explicacion deja al jefe
 * tecnico sin saber si reasignar al tecnico o no, y es el unico registro de por
 * que se abandono una visita ya programada.
 */
export class CancelarBajaDto {
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  motivo: string;

  @IsOptional()
  @IsUUID('4')
  trace_id?: string;
}
