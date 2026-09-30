import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';
import { CrearTicketDto } from './dto/crear-ticket.dto.js';
import { GestionarTicketDto, ReclasificarTicketDto } from './dto/gestionar-ticket.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

// Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales.
@Controller('tickets')
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get()
  listar(
    @CurrentUser() user: { id_empresa: number },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('estado') estado?: string,
    @Query('prioridad') prioridad?: string,
    @Query('id_categoria') id_categoria?: string,
    @Query('id_usuario_asignado') id_usuario_asignado?: string,
    @Query('codigo') codigo?: string,
    @Query('abiertos') abiertos?: string,
  ) {
    // page y limit van crudos: `normalizarPaginacion` en el servicio recorta el
    // rango y descarta lo que no sea un numero utilizable.
    return this.tickets.listarTickets(user.id_empresa, page, limit, {
      estado,
      prioridad,
      id_categoria,
      id_usuario_asignado,
      codigo,
      abiertos,
    });
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: { id_empresa: number }) {
    return this.tickets.obtenerTicket(id, user.id_empresa);
  }

  /** CU-29. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post()
  crear(
    @Body() dto: CrearTicketDto,
    @CurrentUser() user: { userId: number; id_empresa: number },
  ) {
    return this.tickets.crearTicket(dto, user.userId, user.id_empresa);
  }

  /** CU-30 parte 2: asignar, cambiar estado, cerrar. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id')
  gestionar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GestionarTicketDto,
    @CurrentUser() user: { userId: number; id_empresa: number },
  ) {
    return this.tickets.gestionar(id, dto, user.userId, user.id_empresa);
  }

  /**
   * CU-32. Endpoint propio y no un campo del PATCH porque cambiar la categoría
   * recalcula el SLA, o sea el plazo comprometido con el cliente. Merece quedar
   * auditado como lo que es, y poder exigir un motivo.
   */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/categoria')
  reclasificar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReclasificarTicketDto,
    @CurrentUser() user: { userId: number; id_empresa: number },
  ) {
    return this.tickets.reclasificar(id, dto, user.userId, user.id_empresa);
  }
}
