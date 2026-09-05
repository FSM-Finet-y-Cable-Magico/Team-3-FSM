import { BadRequestException, Inject, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UploadApiOptions, v2 } from 'cloudinary';

export const CLOUDINARY_CLIENT = Symbol('CLOUDINARY_CLIENT');

export interface EvidenciaSubida {
  url_cloudinary: string;
  formato: string;
  tamano_kb: number;
}

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly opciones: UploadApiOptions;
  private readonly configurado: boolean;

  constructor(
    config: ConfigService,
    @Inject(CLOUDINARY_CLIENT) private readonly client: Pick<typeof v2, 'uploader'>,
  ) {
    this.opciones = {
      cloud_name: config.get<string>('CLOUDINARY_CLOUD_NAME')?.trim(),
      api_key: config.get<string>('CLOUDINARY_API_KEY')?.trim(),
      api_secret: config.get<string>('CLOUDINARY_API_SECRET')?.trim(),
      folder: 'fsm_evidencias',
      resource_type: 'image',
    };
    this.configurado = Boolean(this.opciones.cloud_name && this.opciones.api_key && this.opciones.api_secret);
  }

  onModuleInit() {
    if (!this.configurado) {
      this.logger.warn('Cloudinary sin configurar: la subida de evidencias devolverá 503. Las demás funciones siguen disponibles.');
    }
  }

  async subirEvidencia(file?: Express.Multer.File): Promise<EvidenciaSubida> {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    if (!this.configurado) {
      throw new ServiceUnavailableException('Cloudinary no está configurado. No se puede subir evidencia.');
    }
    try {
      return await new Promise<EvidenciaSubida>((resolve, reject) => {
        this.client.uploader.upload_stream(this.opciones, (error, result) => {
          if (error || !result) {
            reject(new Error('Error de subida'));
            return;
          }
          resolve({
            url_cloudinary: result.secure_url,
            formato: result.format,
            tamano_kb: Math.round(result.bytes / 1024),
          });
        }).end(file.buffer);
      });
    } catch {
      throw new ServiceUnavailableException('No se pudo subir la evidencia a Cloudinary. Inténtalo nuevamente.');
    }
  }
}
