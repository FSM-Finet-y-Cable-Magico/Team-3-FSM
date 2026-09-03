import { Logger, Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientesModule } from '../clientes/clientes.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { OrdenesController } from './ordenes.controller.js';
import { OrdenesService } from './ordenes.service.js';
import { FAN_OUT_CIERRE, type FanOutCierre } from './fan-out/fan-out-cierre.js';
import { WebhookFanOut } from './fan-out/webhook-fan-out.js';
import { NoOpFanOut } from './fan-out/noop-fan-out.js';

/**
 * Elige el mecanismo de fan-out del cierre según haya URLs de webhook
 * configuradas (`CIERRE_WEBHOOK_G1_URL` / `CIERRE_WEBHOOK_G8_URL`). Sin URLs →
 * NoOp (el cierre queda para reconciliación por GET).
 */
const fanOutProvider = {
  provide: FAN_OUT_CIERRE,
  inject: [ConfigService],
  useFactory: (config: ConfigService): FanOutCierre => {
    const log = new Logger('OrdenesModule');
    const destinos = (
      [
        { nombre: 'G1', url: config.get<string>('CIERRE_WEBHOOK_G1_URL'), apiKey: config.get<string>('CIERRE_WEBHOOK_G1_KEY') },
        { nombre: 'G8', url: config.get<string>('CIERRE_WEBHOOK_G8_URL'), apiKey: config.get<string>('CIERRE_WEBHOOK_G8_KEY') },
      ] as const
    )
      .filter((d) => !!d.url)
      .map((d) => ({ nombre: d.nombre, url: d.url as string, apiKey: d.apiKey }));

    if (destinos.length === 0) {
      log.log('Fan-out del cierre: noop (sin CIERRE_WEBHOOK_*_URL)');
      return new NoOpFanOut();
    }
    log.log(`Fan-out del cierre: webhook → ${destinos.map((d) => d.nombre).join(', ')}`);
    return new WebhookFanOut(destinos);
  },
};

@Module({
  imports: [ClientesModule, forwardRef(() => DashboardModule)],
  controllers: [OrdenesController],
  providers: [OrdenesService, fanOutProvider],
  exports: [OrdenesService],
})
export class OrdenesModule {}
