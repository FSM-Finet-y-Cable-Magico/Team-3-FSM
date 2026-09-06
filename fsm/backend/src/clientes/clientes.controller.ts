import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { ClientesService } from './clientes.service.js';
import { RegistrarClienteDto } from './dto/registrar-cliente.dto.js';
import { EditarClienteDto } from './dto/editar-cliente.dto.js';
import { MarcarConflictivoDto } from './dto/marcar-conflictivo.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

// Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales.
@Controller('clientes')
export class ClientesController {
  constructor(private clientesService: ClientesService) {}

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get()
  listarClientes(
    @CurrentUser() user: { id_empresa: number },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('nombre') nombre?: string,
    @Query('rut') rut?: string,
    @Query('telefono') telefono?: string,
    @Query('direccion') direccion?: string,
  ) {
    return this.clientesService.listarClientes(
      user.id_empresa,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      nombre,
      rut,
      telefono,
      direccion,
    );
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('planes')
  listarPlanes(@CurrentUser() user: { id_empresa: number }) {
    return this.clientesService.listarPlanes(user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('rut/:rut')
  consultarPorRut(
    @Param('rut') rut: string,
    @CurrentUser() user: { id_empresa: number },
  ) {
    return this.clientesService.consultarPorRut(rut, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post()
  registrarCliente(
    @Body() dto: RegistrarClienteDto,
    @CurrentUser() user: { userId: number; id_empresa: number },
  ) {
    return this.clientesService.registrarCliente(dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id')
  editarFicha(
    @Param('id') id: string,
    @Body() dto: EditarClienteDto,
    @CurrentUser() user: { userId: number; id_empresa: number },
  ) {
    return this.clientesService.editarFicha(+id, dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post(':id/conflictivo')
  marcarConflictivo(
    @Param('id') id: string,
    @Body() dto: MarcarConflictivoDto,
    @CurrentUser() user: { userId: number; id_empresa: number },
  ) {
    return this.clientesService.marcarConflictivo(+id, dto, user.userId, user.id_empresa);
  }
}
