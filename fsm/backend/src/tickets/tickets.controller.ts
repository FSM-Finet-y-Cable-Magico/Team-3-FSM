import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';
import { AsignarTicketDto, CrearTicketDto, ReclasificarTicketDto, ResolverTicketDto } from './dto/tickets.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';

/**
 * Panel de tickets del jefe tecnico (CU-29 registro interno, CU-30, CU-32).
 * Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales, y
 * `roles-declarados.spec.ts` revisa que cada handler lleve su @Roles.
 */
@Controller('tickets')
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get()
  listar(
    @CurrentUser() user: UsuarioAutenticado,
    @Query('estado') estado?: string,
    @Query('prioridad') prioridad?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tickets.listar(user.id_empresa, { estado, prioridad, page, limit });
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UsuarioAutenticado) {
    return this.tickets.obtener(id, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post()
  crear(@Body() dto: CrearTicketDto, @CurrentUser() user: UsuarioAutenticado) {
    return this.tickets.crear(dto, user);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/asignar')
  asignar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AsignarTicketDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.tickets.asignar(id, dto.id_usuario, user);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/tomar')
  tomar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: UsuarioAutenticado) {
    return this.tickets.tomar(id, user);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/resolver')
  resolver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolverTicketDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.tickets.resolver(id, dto, user);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/reclasificar')
  reclasificar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReclasificarTicketDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.tickets.reclasificar(id, dto.id_categoria, user);
  }
}
