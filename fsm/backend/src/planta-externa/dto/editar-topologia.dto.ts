import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO de CU-19 "Consultando y editando topologia de red".
 *
 * Todos los campos son opcionales: se edita lo que se manda y lo demas queda
 * como estaba. El servicio rechaza un cuerpo vacio para que un PATCH sin
 * cambios no ensucie el log de auditoria con una entrada que no cambio nada.
 */

/** Vocabulario de `puerto_nap.estado`. */
export const ESTADO_PUERTO = {
  LIBRE: 'LIBRE',
  RESERVADO: 'RESERVADO',
  OCUPADO: 'OCUPADO',
} as const;

export type EstadoPuerto = (typeof ESTADO_PUERTO)[keyof typeof ESTADO_PUERTO];

export class EditarCajaDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  id_mufa?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  identificador_unico?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  numero_poste?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  zona?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(256)
  capacidad_puertos?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-56)
  @Max(-17)
  latitud?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-110)
  @Max(-66)
  longitud?: number;
}

export class EditarPuertoDto {
  /**
   * `EN_MANTENCION` NO esta en la lista a proposito: la columna es VARCHAR(10)
   * y esa palabra tiene 13 caracteres, asi que Postgres la truncaria o
   * rechazaria. Agregarla exige ensanchar la columna, y `puerto_nap` es de la
   * base compartida: va con la coordinacion de la M-01, no por la ventana.
   */
  @IsOptional()
  @IsIn(Object.values(ESTADO_PUERTO))
  estado?: EstadoPuerto;

  /**
   * A quien atiende el puerto. `null` explicito lo libera; omitirlo lo deja
   * como estaba. Por eso no lleva @IsPositive: null es un valor valido aqui.
   */
  @IsOptional()
  @IsInt()
  id_cliente_asociado?: number | null;
}
