import { Module } from '@nestjs/common';
import { IntegracionesController } from './integraciones.controller.js';
import { IntegracionesService } from './integraciones.service.js';
import { ApiKeyGuard } from '../common/guards/api-key.guard.js';

@Module({
  // PrismaModule y ConfigModule son globales.
  controllers: [IntegracionesController],
  providers: [IntegracionesService, ApiKeyGuard],
})
export class IntegracionesModule {}
