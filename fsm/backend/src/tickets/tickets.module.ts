import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

// PrismaModule es global. Se exporta el servicio porque la escalacion a OT
// --que va al final del track-- lo va a necesitar desde OrdenesModule.
@Module({
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
