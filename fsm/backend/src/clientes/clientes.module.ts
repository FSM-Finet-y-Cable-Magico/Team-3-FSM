import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller.js';
import { ClientesService } from './clientes.service.js';
import { ReparacionesRecurrentesModule } from '../ordenes/reparaciones-recurrentes.module.js';

@Module({
  imports: [ReparacionesRecurrentesModule],
  controllers: [ClientesController],
  providers: [ClientesService],
  exports: [ClientesService],
})
export class ClientesModule {}
