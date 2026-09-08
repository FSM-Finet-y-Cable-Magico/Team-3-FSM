import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO de CU-18 "Registrando elemento de topologia".
 *
 * Un archivo para los cuatro niveles porque son un solo caso de uso: el jefe
 * tecnico registra "un elemento", y el nivel lo elige el endpoint.
 *
 * Las coordenadas se acotan a Chile continental e insular con holgura, el mismo
 * criterio que usa `coordenadaPlausible` en el parser de KML. Sin eso, un dedazo
 * al teclear pone una caja en el Golfo de Guinea y el mapa del jefe tecnico
 * queda inutilizable -- ya paso con 592 marcadores del KML real.
 */
const LAT_MIN = -56;
const LAT_MAX = -17;
const LON_MIN = -110;
const LON_MAX = -66;

export class CrearOltDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ubicacion?: string;

  /** IPv4 o IPv6 de gestion. Se guarda como texto: no lo consulta nadie por rango. */
  @IsOptional()
  @IsString()
  @MaxLength(45)
  ip_gestion?: string;
}

export class CrearTarjetaDto {
  @IsInt()
  @IsPositive()
  id_olt: number;

  @IsInt()
  @Min(0)
  @Max(32767)
  numero_tarjeta: number;

  /** Puertos PON de la placa. 8 y 16 son los tipicos; se deja abierto. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(256)
  total_puertos?: number;
}

export class CrearMufaDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  id_tarjeta_pon?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  identificador: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  ubicacion?: string;
}

export class CrearCajaDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  id_mufa?: number;

  /**
   * El nombre con el que los instaladores la conocen ("NAP 42").
   *
   * NO se impone un formato rigido tipo "NAP-00042": el importador de KML crea
   * cajas con el nombre que trae Tomodat, y el ligado ONT->caja compara nombres
   * NORMALIZADOS. Un formato propio para las cajas manuales las dejaria fuera
   * de ese cruce, que es justamente para lo que sirven.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  identificador_unico: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  numero_poste?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  zona?: string;

  /** Puertos fisicos de la caja. Las tipicas son de 8, 16 o 32. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(256)
  capacidad_puertos?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(LAT_MIN)
  @Max(LAT_MAX)
  latitud?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(LON_MIN)
  @Max(LON_MAX)
  longitud?: number;
}
