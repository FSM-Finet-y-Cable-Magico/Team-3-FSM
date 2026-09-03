import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MonitoreoController } from './monitoreo.controller.js';
import { MonitoreoService } from './monitoreo.service.js';
import { MonitoreoPollerService } from './monitoreo-poller.service.js';
import { DescubrimientoService } from './descubrimiento.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { FUENTE_MONITOREO, type FuenteMonitoreo } from './fuente/fuente-monitoreo.js';
import { MockMonitoreo } from './fuente/mock-monitoreo.js';
import { SmartOltClient } from './fuente/smartolt.client.js';

/**
 * Elige la implementación de la fuente según `MONITOREO_FUENTE`:
 *   - "smartolt" → API real (requiere SMARTOLT_BASE_URL + SMARTOLT_API_TOKEN)
 *   - cualquier otra cosa (incluido ausente) → "mock"
 */
const fuenteProvider = {
  provide: FUENTE_MONITOREO,
  inject: [ConfigService],
  useFactory: (config: ConfigService): FuenteMonitoreo => {
    const log = new Logger('MonitoreoModule');
    if (config.get<string>('MONITOREO_FUENTE') === 'smartolt') {
      log.log('Fuente de monitoreo: SmartOLT (API real)');
      return new SmartOltClient(
        config.get<string>('SMARTOLT_BASE_URL') ?? '',
        config.get<string>('SMARTOLT_API_TOKEN') ?? '',
      );
    }
    log.log('Fuente de monitoreo: mock (payload de ejemplo)');
    return new MockMonitoreo();
  },
};

@Module({
  // PrismaModule es @Global y ConfigModule es global: no hace falta importarlos.
  controllers: [MonitoreoController],
  providers: [
    fuenteProvider,
    RegistroOntService,
    MonitoreoService,
    MonitoreoPollerService,
    DescubrimientoService,
  ],
  exports: [MonitoreoService],
})
export class MonitoreoModule {}
