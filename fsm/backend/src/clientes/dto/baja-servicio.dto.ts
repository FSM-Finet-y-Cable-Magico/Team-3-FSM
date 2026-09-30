import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** CU-25: catalogo de motivos de baja. */
export const MOTIVOS_BAJA = ['VOLUNTARIA', 'MOROSIDAD', 'FUERZA_MAYOR', 'MUDANZA_SIN_COBERTURA'] as const;
export type MotivoBaja = (typeof MOTIVOS_BAJA)[number];

export class BajaServicioDto {
  @IsIn(MOTIVOS_BAJA)
  motivo: MotivoBaja;

  /**
   * CU-25, excepcion 1. G3 no tiene la deuda del cliente (es del dominio
   * comercial; CU-36 quedo fuera de alcance por eso), asi que quien registra la
   * baja confirma que no hay deuda pendiente. Sin esto no se registra.
   */
  @IsBoolean()
  confirma_sin_deuda: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;
}
