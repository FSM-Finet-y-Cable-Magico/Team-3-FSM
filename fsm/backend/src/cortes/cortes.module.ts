import { Module } from '@nestjs/common';
import { CortesController } from './cortes.controller.js';
import { CortesService } from './cortes.service.js';

@Module({
  // PrismaModule es global.
  controllers: [CortesController],
  providers: [CortesService],
})
export class CortesModule {}
