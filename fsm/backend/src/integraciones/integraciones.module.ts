import { Module } from '@nestjs/common';
import { IntegracionesController } from './integraciones.controller.js';
import { IntegracionesService } from './integraciones.service.js';
import { InstalacionesService } from './instalaciones.service.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';
import { momentoFanOutProvider } from '../ordenes/fan-out/momento-fan-out.js';

@Module({
  // PrismaModule y ConfigModule son globales.
  controllers: [IntegracionesController],
  providers: [IntegracionesService, InstalacionesService, ApiKeyGuard, momentoFanOutProvider],
})
export class IntegracionesModule {}
