import { Logger } from '@nestjs/common';
import type { FanOutCierre, PayloadCierre } from './fan-out-cierre.js';

/**
 * No hace nada (solo loguea). Es el default cuando no hay URLs de webhook
 * configuradas. El cierre queda igualmente disponible para reconciliación por
 * `GET /api/integraciones/ordenes/:id/cierre`.
 */
export class NoOpFanOut implements FanOutCierre {
  readonly nombre = 'noop';
  private readonly logger = new Logger(NoOpFanOut.name);

  async notificar(payload: PayloadCierre): Promise<void> {
    this.logger.log(
      `cierre ${payload.id_ot} (sin webhooks configurados) — disponible para reconciliación por GET`,
    );
  }
}
