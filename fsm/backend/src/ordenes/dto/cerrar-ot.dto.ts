import {
  IsArray,
  ValidateNested,
  IsNumber,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  IsBoolean,
  ArrayMinSize,
  IsInt,
  IsPositive,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ACCION_EQUIPO, type AccionEquipo } from '../estado-equipo.constants.js';

export class FotoDto {
  @IsString()
  @IsNotEmpty()
  url_cloudinary: string;

  @IsString()
  @IsNotEmpty()
  formato: string;

  @IsNumber()
  tamano_kb: number;
}

export class MaterialDto {
  @IsNumber()
  id_tipo_equipo: number;

  @IsNumber()
  cantidad: number;

  @IsOptional()
  @IsString()
  numero_serie?: string;
}

/**
 * Un equipo individualizable que el técnico instaló o retiró en la visita.
 *
 * Va sobre `numero_serie` y NO sobre `id_unidad`: G3 no lee `unidad_equipo`
 * (dominio de G1), así que no conoce el id — el técnico teclea la serie y G1 la
 * resuelve al procesar el cierre.
 */
export class EquipoOtDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'numero_serie: solo A-Z, 0-9 y guión (formato de G1)',
  })
  numero_serie: string;

  @IsIn(Object.values(ACCION_EQUIPO))
  accion: AccionEquipo;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  observacion_estado_fisico?: string;
}

export class CerrarOtDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FotoDto)
  fotos: FotoDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialDto)
  materiales: MaterialDto[];

  /**
   * Equipos individualizables instalados en el cliente en esta visita.
   * G3 los declara; G1 mueve las unidades a "Instalado en cliente".
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquipoOtDto)
  equipos_instalados?: EquipoOtDto[];

  /**
   * Equipos individualizables retirados del cliente en esta visita.
   * G3 los declara; G1 aplica la transición según `accion`.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquipoOtDto)
  equipos_retirados?: EquipoOtDto[];

  @IsNumber()
  @IsNotEmpty()
  potencia_optica_dbm: number;

  @IsIn(['CONFORME', 'NO_CONFORME'])
  resultado_llamada: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  obs_llamada?: string;

  @IsOptional()
  @IsBoolean()
  resuelto_remotamente?: boolean;

  @IsOptional()
  @IsInt()
  @IsPositive()
  id_categoria_falla?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  categoria_falla_otro?: string;
}
