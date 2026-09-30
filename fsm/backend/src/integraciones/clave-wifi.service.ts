import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolicitudClaveWifiDto } from './dto/solicitud-clave-wifi.dto.js';
import { descifrarClave, huellaSolicitud } from './clave-wifi.crypto.js';

export const MENSAJE_SIN_LLAVE =
  'El canal de claves WiFi no esta configurado. Reintente mas tarde.';
export const MENSAJE_NO_DESCIFRABLE =
  'ciphertext: no se pudo descifrar con la llave publica vigente';
export const MENSAJE_YA_LEIDA =
  'La clave ya fue entregada una vez y no se puede volver a ver';

/**
 * Cambio de clave WiFi pedido desde el portal de G2 (acuerdo §6.4).
 *
 * G2 cifra la clave con nuestra llave publica y nos la manda por endpoint, no
 * por la base compartida: el §6.5 prohibe que G8 pueda leerla.
 *
 * El ciphertext se guarda TAL COMO LLEGA. No se descifra para guardarlo ni se
 * recifra, porque ya viene cifrado con una llave que solo tenemos nosotros --
 * G8 puede leer la fila y no puede descifrarla. Al recibir se descifra una vez
 * solo para validar que es descifrable, y ese claro se descarta en el acto.
 */
@Injectable()
export class ClaveWifiService {
  private readonly logger = new Logger(ClaveWifiService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /** La llave privada en PEM, o `null` si no esta configurada. */
  private llavePrivada(): string | null {
    const pem = this.config.get<string>('WIFI_LLAVE_PRIVADA_PEM');
    if (!pem) return null;
    // El .env no admite saltos de linea, asi que la llave se guarda con `\n`
    // literales y hay que devolverlos antes de que node la lea.
    return pem.includes('\n') ? pem.replace(/\n/g, '\n') : pem;
  }

  async recibir(
    dto: SolicitudClaveWifiDto,
    scope: { grupo: string; empresas: number[] },
  ) {
    if (!scope.empresas.includes(dto.id_empresa)) {
      throw new ForbiddenException(
        'id_empresa fuera del alcance de la clave de API',
      );
    }

    const pem = this.llavePrivada();
    if (!pem) {
      // 503 y no 500: es configuracion que falta de nuestro lado, y le dice a
      // G2 que reintente en vez de descartar la solicitud del cliente.
      this.logger.error(
        'WIFI_LLAVE_PRIVADA_PEM no esta configurada — se rechaza la solicitud',
      );
      throw new ServiceUnavailableException(MENSAJE_SIN_LLAVE);
    }

    const huella = huellaSolicitud(dto);

    const previa = await this.prisma.solicitud_clave_wifi.findUnique({
      where: { request_id: dto.request_id },
    });

    if (previa) {
      // Mismo request_id y mismo contenido: es un reintento de G2 porque se le
      // corto la llamada. Se devuelve la original y NO se reaplica nada.
      if (previa.huella === huella) {
        return {
          duplicado: true,
          request_id: previa.request_id,
          id_solicitud: previa.id_solicitud,
          estado: previa.estado,
          fecha: previa.fecha_creacion.toISOString(),
        };
      }
      // Mismo request_id, otro contenido: ese id ya no identifica el mismo
      // hecho. Fallar es mejor que adivinar cual de los dos vale.
      throw new ConflictException(
        `request_id ${dto.request_id} ya existe con otro contenido`,
      );
    }

    // Se descifra solo para validar. El claro no se guarda ni se registra.
    if (descifrarClave(dto.ciphertext, pem) === null) {
      throw new BadRequestException(MENSAJE_NO_DESCIFRABLE);
    }

    const creada = await this.prisma.solicitud_clave_wifi.create({
      data: {
        request_id: dto.request_id,
        huella,
        id_empresa: dto.id_empresa,
        id_contrato: dto.id_contrato,
        id_ticket: dto.id_ticket,
        trace_id: dto.trace_id,
        clave_cifrada: dto.ciphertext,
      },
    });

    this.logger.log(
      `Solicitud de clave WiFi de ${scope.grupo}: ticket ${dto.id_ticket}, ` +
        `contrato ${dto.id_contrato}, trace ${dto.trace_id}`,
    );

    return {
      duplicado: false,
      request_id: creada.request_id,
      id_solicitud: creada.id_solicitud,
      estado: creada.estado,
      fecha: creada.fecha_creacion.toISOString(),
    };
  }

  /**
   * Entrega la clave en claro al tecnico, una sola vez.
   *
   * La lectura unica es a proposito: una clave de cliente que se puede volver a
   * mirar indefinidamente desde un panel es una clave filtrada con pasos
   * extra. Si el tecnico la pierde, el cliente la vuelve a pedir desde el
   * portal, que es mas barato que dejarla legible para siempre.
   */
  async entregar(id_solicitud: number, id_empresa: number) {
    const s = await this.prisma.solicitud_clave_wifi.findUnique({
      where: { id_solicitud },
    });
    if (!s || s.id_empresa !== id_empresa) {
      // Mismo 404 para "no existe" y "es de otra empresa": distinguirlos deja
      // averiguar que solicitudes tiene la otra empresa.
      throw new NotFoundException('Solicitud no encontrada');
    }
    if (s.leida_en) throw new ConflictException(MENSAJE_YA_LEIDA);

    const pem = this.llavePrivada();
    if (!pem) throw new ServiceUnavailableException(MENSAJE_SIN_LLAVE);

    const clave = descifrarClave(s.clave_cifrada, pem);
    if (clave === null) {
      // Llego descifrable y ahora no: la llave cambio. No se marca como leida,
      // para que no se pierda al rotar la llave por error.
      this.logger.error(
        `Solicitud ${id_solicitud} no se pudo descifrar: la llave privada no es la que la recibio`,
      );
      throw new ServiceUnavailableException(MENSAJE_NO_DESCIFRABLE);
    }

    // Se marca leida ANTES de devolverla: si el update falla, el tecnico no ve
    // la clave y puede reintentar. Al reves, un fallo aca la dejaria legible
    // otra vez despues de haberla mostrado.
    await this.prisma.solicitud_clave_wifi.update({
      where: { id_solicitud },
      data: { leida_en: new Date(), estado: 'ENTREGADA' },
    });

    return {
      id_solicitud,
      id_ticket: s.id_ticket,
      id_contrato: s.id_contrato,
      clave,
    };
  }
}
