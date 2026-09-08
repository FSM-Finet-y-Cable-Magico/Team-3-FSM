import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller.js';
import { ReportesService } from './reportes.service.js';
import { ExportacionService } from './exportacion.service.js';
import { ReparacionesRecurrentesModule } from '../ordenes/reparaciones-recurrentes.module.js';

@Module({
  // La regla de RF-08 se reusa para la seccion de clientes recurrentes de RF-39.
  imports: [ReparacionesRecurrentesModule],
  controllers: [ReportesController],
  providers: [ReportesService, ExportacionService],
  exports: [ReportesService, ExportacionService],
})
export class ReportesModule {}
