import {
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { validarRut } from '../../common/utils/rut.util.js';

/**
 * Contrato G8 → G3 de la solicitud de instalacion (Respuesta de G8 del 24-09,
 * §3 y §4.2). Los formatos son los canonicos del §3: RUT sin puntos y con
 * guion, telefono E.164, ids como numero JSON y request_id/trace_id UUID v4.
 *
 * G8 valida antes de enviar, pero se valida aca igual: un 400 con el campo que
 * falla le dice a G8 que corregir; un dato malo guardado le llega al tecnico.
 */

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

@ValidatorConstraint({ name: 'rutValido' })
class RutValido implements ValidatorConstraintInterface {
  validate(valor: unknown) {
    return typeof valor === 'string' && validarRut(valor);
  }
  defaultMessage() {
    return 'persona.rut: digito verificador invalido';
  }
}

export class PersonaSolicitudDto {
  @IsString()
  @Matches(/^\d{7,8}-[\dK]$/, { message: 'persona.rut: formato 12345678-5, sin puntos y con K mayuscula' })
  @Validate(RutValido)
  rut: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre_completo: string;

  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'persona.telefono: formato E.164, ej. +56912345678' })
  telefono: string;

  // Se acepta porque el contrato lo trae, pero NO se guarda: G8 pidio no
  // replicar el email si no hace falta para ejecutar la OT (§6).
  @IsOptional()
  @IsEmail()
  email?: string | null;
}

export class DireccionSolicitudDto {
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  direccion_completa: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  comuna: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(80)
  ciudad?: string | null;

  // P1: llegan cuando G8 incorpore geocodificacion. Hoy vienen null.
  @IsOptional()
  @IsNumber()
  latitud?: number | null;

  @IsOptional()
  @IsNumber()
  longitud?: number | null;
}

export class SolicitudInstalacionDto {
  @IsUUID('4')
  request_id: string;

  @IsUUID('4')
  trace_id: string;

  @IsInt()
  @IsPositive()
  id_empresa: number;

  @IsInt()
  @IsPositive()
  id_prospecto: number;

  @IsInt()
  @IsPositive()
  id_contrato: number;

  @IsInt()
  @IsPositive()
  id_plan: number;

  @ValidateNested()
  @Type(() => PersonaSolicitudDto)
  @IsNotEmpty()
  persona: PersonaSolicitudDto;

  @ValidateNested()
  @Type(() => DireccionSolicitudDto)
  @IsNotEmpty()
  direccion: DireccionSolicitudDto;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observaciones?: string | null;

  @IsOptional()
  @IsArray()
  requisitos_equipamiento?: unknown[];
}
