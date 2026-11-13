import {
  IsArray,
  ValidateNested,
  IsNumber,
  IsNotEmpty,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsBoolean,
  IsInt,
  IsPositive,
  Matches,
  IsUrl,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  ACCION_EQUIPO,
  DIAGNOSTICO_RETIRO,
  type AccionEquipo,
  type DiagnosticoRetiro,
} from '../estado-equipo.constants.js';
import {
  LARGO_MAX_TEXTO_REPARACION,
  LARGO_MIN_TEXTO_REPARACION,
  RESULTADO_REPARACION,
  type ResultadoReparacion,
} from '../reparacion-cierre.constants.js';

/**
 * Recorta los espacios ANTES de validar el largo.
 *
 * Sin esto, cinco espacios pasan `MinLength(5)` y G1 recibe un texto vacio;
 * y un texto de 300 caracteres con un espacio al final se rechaza por pasarse
 * del maximo cuando en realidad no se pasa.
 */
const recortado = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class FotoDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_valid_protocol: true })
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
 * Va sobre `numero_serie` y NO sobre `id_unidad`: `unidad_equipo` es dominio de
 * G1 y el id no viaja entre sistemas. El técnico teclea la serie (el formulario
 * le sugiere las que lleva asignadas); el FSM la valida contra el inventario
 * antes de cerrar (ordenes/validar-equipos.ts) y G1 aplica la transición al
 * procesar el cierre.
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

  /**
   * El equipo volvio dañado. Lo pidio G1 el 12-11-2026, con este nombre: es el
   * campo con el que deciden si la recepcion es `RECIBIDO` o
   * `RECIBIDO_CON_DANO`.
   *
   * Ya existia `observacion_estado_fisico`, pero es texto libre: sirve para que
   * un humano lea el detalle, no para que G1 ramifique. Un sistema no puede
   * decidir mirando "venia con la tapa suelta". Los dos campos convivien: este
   * dice SI, el otro dice QUE.
   */
  @IsOptional()
  @IsBoolean()
  con_dano?: boolean;

  /**
   * Que le pasa al equipo, de la lista fija de G1 (confirmada el 4-sept).
   *
   * OPCIONAL a proposito, aunque G1 lo "exige" al retirar para diagnostico.
   * Javier ofrecio asumir "Causa desconocida" si no viene, y se toma esa
   * salida: un contrato que rechaza el cierre completo por un campo que el
   * tecnico no lleno deja al cliente sin servicio y al tecnico atrapado en el
   * domicilio. La obligatoriedad se impone en el formulario, donde se puede
   * corregir en el momento, no en el contrato entre sistemas.
   *
   * Los literales van exactos, con tildes: los compara G1.
   */
  @IsOptional()
  @IsIn(Object.values(DIAGNOSTICO_RETIRO))
  diagnostico?: DiagnosticoRetiro;
}

/**
 * Un equipo que el tecnico NO pudo recuperar del domicilio.
 *
 * Es su propia lista y no una `accion` mas de `EquipoOtDto` porque no describe
 * un movimiento de inventario: nada se movio. G1 lo registra como
 * `NO_RECIBIDO` y G8 deja la baja bloqueada esperando una decision comercial
 * (acuerdo del 12-11-2026, §5 del documento de G1).
 *
 * El `motivo` es OBLIGATORIO, al contrario que en `EquipoOtDto`. Un equipo que
 * no se recupero es plata que alguien va a tener que cobrar o perdonar, y la
 * persona que decide eso no estuvo en el domicilio: si el tecnico no explica
 * por que falta, la decision se toma a ciegas. Es el unico campo del cierre
 * donde se eligio molestar al tecnico antes que perder el dato.
 */
export class EquipoFaltanteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'numero_serie: solo A-Z, 0-9 y guión (formato de G1)',
  })
  numero_serie: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  motivo: string;
}

export class CerrarOtDto {
  /**
   * CU-56: obligatorias si la resolucion es PRESENCIAL, opcionales si es
   * REMOTA (`resuelto_remotamente`). Lo decide el servicio, porque depende de
   * otro campo.
   */
  @IsArray()
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

  /**
   * Equipos que debian retirarse y no se pudieron recuperar.
   *
   * NO se validan contra el inventario como los otros dos: `validarSeries`
   * comprueba que la serie este asignada al tecnico que cierra, y un equipo que
   * no se recupero es justo el que el tecnico no tiene. Validarlos ahi haria
   * imposible declarar un faltante.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EquipoFaltanteDto)
  equipos_faltantes?: EquipoFaltanteDto[];

  @IsNumber()
  @IsNotEmpty()
  potencia_optica_dbm: number;

  // La llamada de cortesia (CU-31) NO va en el cierre: la registra siempre el
  // jefe tecnico, con la OT ya completada, desde `POST /ordenes/:id/llamada-cortesia`.
  // Si un cliente viejo manda `resultado_llamada` aca, el ValidationPipe
  // (whitelist) lo descarta.

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

  /**
   * Que problema encontro el tecnico. Obligatorio en REPARACION (lo exige el
   * servicio, que es quien conoce el `tipo_ot`); ausente en los demas tipos.
   */
  @IsOptional()
  @IsString()
  @recortado()
  @MinLength(LARGO_MIN_TEXTO_REPARACION)
  @MaxLength(LARGO_MAX_TEXTO_REPARACION)
  falla_reportada?: string;

  /** Que hizo para resolverlo. Mismas reglas que `falla_reportada`. */
  @IsOptional()
  @IsString()
  @recortado()
  @MinLength(LARGO_MIN_TEXTO_REPARACION)
  @MaxLength(LARGO_MAX_TEXTO_REPARACION)
  solucion_aplicada?: string;

  /** Como quedo: RESUELTO, PARCIAL o SIN_SOLUCION. */
  @IsOptional()
  @IsIn(Object.values(RESULTADO_REPARACION))
  resultado_reparacion?: ResultadoReparacion;
}
