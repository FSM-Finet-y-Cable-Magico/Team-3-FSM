import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CANAL_NOTIFICACION, TIPO_EVENTO } from '../notificaciones.constants.js';

export class CrearPlantillaDto {
  @IsOptional()
  @IsIn(Object.values(TIPO_EVENTO))
  tipo_evento?: string;

  @IsIn(Object.values(CANAL_NOTIFICACION))
  canal: string;

  /**
   * El texto, con `{{variable}}` donde corresponda. El limite no es caprichoso:
   * un SMS se corta en 160 caracteres y se factura por tramo, asi que un texto
   * largo se convierte en varios mensajes sin que nadie lo note hasta la
   * factura. 500 deja lugar a correo sin volverlo ilimitado.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  contenido_texto: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class EditarPlantillaDto {
  @IsOptional()
  @IsIn(Object.values(TIPO_EVENTO))
  tipo_evento?: string;

  @IsOptional()
  @IsIn(Object.values(CANAL_NOTIFICACION))
  canal?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  contenido_texto?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
