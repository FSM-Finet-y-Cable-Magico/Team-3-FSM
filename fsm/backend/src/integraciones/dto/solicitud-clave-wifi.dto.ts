import {
  IsBase64,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Contrato G2 → G3 del cambio de clave WiFi (documento de G2 del 30-09, §3, y
 * nuestra respuesta del mismo dia).
 *
 * Se valida aca aunque G2 valide antes de enviar: un 400 con el campo que falla
 * le dice a G2 que corregir, y una solicitud mal formada que entra termina en
 * un tecnico mirando una clave que no se puede descifrar.
 */
export class SolicitudClaveWifiDto {
  /** La clave cifrada con nuestra llave publica, RSA-OAEP/SHA-256, en base64. */
  @IsString()
  @Transform(recortar)
  @IsBase64({}, { message: 'ciphertext: debe venir en base64' })
  // 3072 bits cifran en bloques de 384 bytes, que en base64 son 512
  // caracteres. El techo deja margen para una llave mayor sin quedar abierto.
  @MaxLength(2048, { message: 'ciphertext: excede el largo de un bloque RSA' })
  ciphertext: string;

  /** El ticket del CRM de G8. Solo para correlacionar; no lo creamos nosotros. */
  @IsString()
  @Transform(recortar)
  @MaxLength(64)
  id_ticket: string;

  @Type(() => Number)
  @IsInt({ message: 'id_contrato: debe ser un numero JSON, no un string' })
  @Min(1)
  id_contrato: number;

  @Type(() => Number)
  @IsInt({ message: 'id_empresa: debe ser un numero JSON, no un string' })
  @Min(1)
  id_empresa: number;

  @IsUUID('4', { message: 'request_id: debe ser UUID v4' })
  request_id: string;

  @IsUUID('4', { message: 'trace_id: debe ser UUID v4' })
  trace_id: string;
}
