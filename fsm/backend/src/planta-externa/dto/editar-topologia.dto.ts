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
  /**
   * RF-17 nombra tres estados: ocupado, libre o en mantencion. Este faltaba
   * porque la columna era VARCHAR(10) y la palabra tiene 13 caracteres. La
   * migracion que ensancha a VARCHAR(20) va junto con este cambio.
   */
  EN_MANTENCION: 'EN_MANTENCION',
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
   * Los tres estados que nombra RF-17, mas RESERVADO, que usa CU-20 para
   * apartar un puerto al crear la OT.
   *
   * `EN_MANTENCION` estuvo fuera hasta ahora porque la columna era VARCHAR(10)
   * y la palabra tiene 13 caracteres: Postgres la habria rechazado. La columna
   * es de la base compartida, asi que ensancharla hay que avisarlo a los otros
   * grupos; el cambio es aditivo y no toca ningun dato existente.
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
