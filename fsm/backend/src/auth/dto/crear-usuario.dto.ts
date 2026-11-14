import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CrearUsuarioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre_completo: string;

  // "nombre.apellido" en minusculas; despues del punto se aceptan numeros
  // para las cuentas que se repiten, como tecnico.prueba1.
  @IsString()
  @MaxLength(50)
  @Matches(/^[a-z]+\.[a-z0-9]+$/, { message: 'Formato: nombre.apellido en minúsculas (puede terminar en número)' })
  nombre_usuario: string;

  @IsString()
  @MinLength(8)
  password_temporal: string;

  @IsIn(['ADMIN', 'JEFE_TECNICO', 'TECNICO', 'COORDINADOR', 'COMERCIAL'])
  rol: string;

  @IsInt()
  @IsPositive()
  id_empresa: number;

  /** Los otros grupos identifican al tecnico por RUT. El digito se valida en el servicio. */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  rut?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(120)
  email?: string;
}
