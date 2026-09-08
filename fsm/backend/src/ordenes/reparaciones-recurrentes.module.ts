import { Module } from '@nestjs/common';
import { ReparacionesRecurrentesService } from './reparaciones-recurrentes.service.js';

/**
 * Modulo minimo para que la regla de RF-08 la compartan el cierre de OT y la
 * ficha del cliente sin que ninguno de los dos dependa del otro.
 */
@Module({
  providers: [ReparacionesRecurrentesService],
  exports: [ReparacionesRecurrentesService],
})
export class ReparacionesRecurrentesModule {}
