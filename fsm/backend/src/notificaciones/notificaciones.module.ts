import { Module } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller.js';
import { NotificacionesService } from './notificaciones.service.js';
import { AvisosMantencionService } from './avisos-mantencion.service.js';
import { AvisosMantencionPoller } from './avisos-mantencion.poller.js';
import { MonitoreoModule } from '../monitoreo/monitoreo.module.js';

@Module({
  // MonitoreoModule por `AlertasService`: la lista de destinatarios se reusa
  // del detalle de la alerta en vez de volver a resolverla.
  imports: [MonitoreoModule],
  controllers: [NotificacionesController],
  providers: [NotificacionesService, AvisosMantencionService, AvisosMantencionPoller],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
