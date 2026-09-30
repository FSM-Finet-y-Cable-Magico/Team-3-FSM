import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { OrdenesModule } from '../ordenes/ordenes.module.js';

@Module({
  // La derivacion a OT usa OrdenesService.crearOT. Ordenes no importa tickets:
  // lo que le hace al ticket (resolverlo, reabrirlo) lo escribe por Prisma.
  imports: [OrdenesModule],
  // PrismaModule y ConfigModule son globales.
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
