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
} from 'class-validator';
import { Type } from 'class-transformer';

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
