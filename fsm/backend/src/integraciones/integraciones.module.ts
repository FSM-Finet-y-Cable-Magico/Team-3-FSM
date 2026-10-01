import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { IntegracionesController } from './integraciones.controller.js';
import { IntegracionesService } from './integraciones.service.js';
import { InstalacionesService } from './instalaciones.service.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import { momentoFanOutProvider } from '../ordenes/fan-out/momento-fan-out.js';
import { ClaveWifiService } from './clave-wifi.service.js';
import { ClaveWifiController } from './clave-wifi.controller.js';

@Module({
  imports: [TicketsModule],
  // PrismaModule y ConfigModule son globales.
  controllers: [IntegracionesController, ClaveWifiController],
  providers: [
    IntegracionesService,
    InstalacionesService,
    ClaveWifiService,
    ApiKeyGuard,
    momentoFanOutProvider,
  ],
})
export class IntegracionesModule {}
