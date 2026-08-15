import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrdenesModule } from '../ordenes/ordenes.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { DashboardGateway } from './dashboard.gateway.js';

@Module({
  // AuthModule exporta JwtModule: el gateway valida el token con el mismo
  // JwtService y la misma configuracion que jwt.strategy.ts.
  imports: [forwardRef(() => OrdenesModule), AuthModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardGateway],
  exports: [DashboardGateway],
})
export class DashboardModule {}
