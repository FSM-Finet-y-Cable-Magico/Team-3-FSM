import { Module } from '@nestjs/common';
import { SinReagendarService } from './sin-reagendar.service.js';

/**
 * Modulo minimo para que la regla de RF-09 la compartan el listado de OT y el
 * indicador del dashboard (RF-37), que es justo donde nacen las copias.
 */
@Module({
  providers: [SinReagendarService],
  exports: [SinReagendarService],
})
export class SinReagendarModule {}
