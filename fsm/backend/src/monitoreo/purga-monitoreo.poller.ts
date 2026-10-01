import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PurgaMonitoreoService } from './purga-monitoreo.service.js';

/**
 * Corre la purga de monitoreo_ont cada `MONITOREO_PURGA_INTERVALO_MS`.
 *
 * Un `setInterval` propio, igual que MonitoreoPollerService y que
 * AvisosMantencionPoller, para no sumar `@nestjs/schedule`. Aplica de verdad:
 * una purga que solo informa no sirve de nada, y el endpoint manual esta
 * aparte para mirar antes de prenderla.
 *
 * Apagada por defecto (`MONITOREO_PURGA_ENABLED != true`). Se prende en
 * produccion despues de haber visto el resumen en seco.
 */
@Injectable()
export class PurgaMonitoreoPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurgaMonitoreoPoller.name);
  private timer?: ReturnType<typeof setInterval>;
  private corriendo = false;

  constructor(
    private config: ConfigService,
    private purga: PurgaMonitoreoService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('MONITOREO_PURGA_ENABLED') !== 'true') {
      this.logger.log('Purga deshabilitada (MONITOREO_PURGA_ENABLED != true)');
      return;
    }

    const intervalo = Number(
      this.config.get('MONITOREO_PURGA_INTERVALO_MS') ?? 86_400_000,
    );
    this.logger.log(
      `Purga habilitada — cada ${Math.round(intervalo / 3_600_000)}h`,
    );

    // A los 5 minutos del arranque, no de inmediato: que el backend termine de
    // levantar y atienda antes de ponerse a borrar.
    setTimeout(() => void this.tick(), 300_000);
    this.timer = setInterval(() => void this.tick(), intervalo);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.corriendo) {
      this.logger.warn('La purga anterior sigue corriendo — se salta esta');
      return;
    }
    this.corriendo = true;
    try {
      const conservar = this.config.get<string>(
        'MONITOREO_PURGA_CONSERVAR_POR_ONT',
      );
      await this.purga.purgar({
        aplicar: true,
        conservarPorOnt:
          conservar === undefined ? undefined : Number(conservar),
      });
    } catch (e) {
      this.logger.error(`Fallo la purga: ${(e as Error).message}`);
    } finally {
      this.corriendo = false;
    }
  }
}
