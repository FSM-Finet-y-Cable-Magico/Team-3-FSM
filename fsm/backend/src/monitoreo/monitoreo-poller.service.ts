import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoreoService } from './monitoreo.service.js';

/**
 * Dispara `ingestarLecturas()` cada `MONITOREO_POLL_INTERVAL_MS`.
 *
 * Es un `setInterval` propio, no `@nestjs/schedule`, para no sumar dependencia:
 * el poller corre en una sola instancia (igual que el resto del backend, ver
 * nota en el Dockerfile). Si el backend pasa a varias réplicas, mover esto a un
 * job aparte con lock.
 *
 * Apagado por defecto (`MONITOREO_POLL_ENABLED=false`). En dev se puede dejar
 * prendido con la fuente `mock`; contra SmartOLT real, subir el intervalo para
 * no chocar con los rate limits (señales cada 5-15 min).
 */
@Injectable()
export class MonitoreoPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoreoPollerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private corriendo = false;

  constructor(
    private config: ConfigService,
    private monitoreo: MonitoreoService,
  ) {}

  onModuleInit() {
    const habilitado = this.config.get<string>('MONITOREO_POLL_ENABLED') === 'true';
    if (!habilitado) {
      this.logger.log('Poller deshabilitado (MONITOREO_POLL_ENABLED != true)');
      return;
    }

    const intervalo = Number(this.config.get('MONITOREO_POLL_INTERVAL_MS') ?? 300_000);
    this.logger.log(`Poller habilitado — cada ${Math.round(intervalo / 1000)}s`);

    // Primer tick a los 10s del arranque, después al intervalo configurado.
    setTimeout(() => void this.tick(), 10_000);
    this.timer = setInterval(() => void this.tick(), intervalo);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.corriendo) {
      this.logger.warn('El tick anterior sigue corriendo — se salta este');
      return;
    }
    this.corriendo = true;
    try {
      await this.monitoreo.ingestarLecturas();
    } catch (e) {
      this.logger.error(`Fallo en la ingesta: ${(e as Error).message}`);
    } finally {
      this.corriendo = false;
    }
  }
}
