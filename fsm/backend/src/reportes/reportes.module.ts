import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';
import { ExportacionService } from './exportacion.service.js';

@Module({
  controllers: [ReportesController],
  providers: [ReportesService, ExportacionService],
  exports: [ReportesService, ExportacionService],
})
export class ReportesModule {}
