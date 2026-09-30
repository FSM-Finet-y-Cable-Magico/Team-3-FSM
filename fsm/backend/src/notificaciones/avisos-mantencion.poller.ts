import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AvisosMantencionService } from './avisos-mantencion.service.js';

/**
 * CU-50: emite los avisos de mantencion cuando llega su hora. Mismo patron que
 * `MonitoreoPollerService` --un `setInterval` propio, sin `@nestjs/schedule`--
 * y con la misma nota: corre en una sola instancia; con varias replicas habria
 * que moverlo a un job con lock.
 *
 * Prendido por defecto, porque solo lee y escribe la base propia. Se apaga con
 * `AVISOS_MANTENCION_ENABLED=false`, y en las pruebas (NODE_ENV=test) no
 * arranca para no dejar timers vivos.
 */
@Injectable()
export class AvisosMantencionPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvisosMantencionPoller.name);
  private timer?: ReturnType<typeof setInterval>;
  private corriendo = false;

  constructor(
    private config: ConfigService,
    private avisos: AvisosMantencionService,
  ) {}

  onModuleInit() {
    const apagado =
      this.config.get<string>('AVISOS_MANTENCION_ENABLED') === 'false' || this.config.get<string>('NODE_ENV') === 'test';
    if (apagado) return;
    const intervalo = Number(this.config.get('AVISOS_MANTENCION_INTERVAL_MS') ?? 300_000);
    this.logger.log(`Avisos de mantención: revisión cada ${Math.round(intervalo / 1000)}s`);
    this.timer = setInterval(() => void this.tick(), intervalo);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      await this.avisos.enviarVencidos();
    } catch (e) {
      this.logger.error(`Fallo al emitir avisos de mantención: ${(e as Error).message}`);
    } finally {
      this.corriendo = false;
    }
  }
}
