import { Controller, Get, Param, Query } from '@nestjs/common';
import { ClientesService } from './clientes.service.js';
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
    @Query('zona') zona?: string,
  ) {
    // page y limit se pasan crudos: normalizarPaginacion en el servicio ya
    // recorta el rango y descarta lo que no sea un numero utilizable.
    return this.clientesService.listarClientes(user.id_empresa, page, limit, {
      nombre,
      rut,
      telefono,
      direccion,
      zona,
    });
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('planes')
  listarPlanes(@CurrentUser() user: { id_empresa: number }) {
    return this.clientesService.listarPlanes(user.id_empresa);
  }

  /** CU-07: clientes actuales y anteriores de una direccion. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('por-direccion')
  buscarPorDireccion(
    @CurrentUser() user: { id_empresa: number },
    @Query('calle') calle?: string,
    @Query('numero') numero?: string,
    @Query('comuna') comuna?: string,
  ) {
    return this.clientesService.buscarPorDireccion(user.id_empresa, { calle, numero, comuna });
  }

  /** CU-35: lista roja por RUT y por direccion, antes de crear una OT. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('lista-roja/verificar')
  verificarListaRoja(
    @CurrentUser() user: { id_empresa: number },
    @Query('rut') rut?: string,
    @Query('direccion_completa') direccion_completa?: string,
    @Query('comuna') comuna?: string,
  ) {
    return this.clientesService.verificarListaRoja(user.id_empresa, { rut, direccion_completa, comuna });
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('rut/:rut')
  consultarPorRut(
    @Param('rut') rut: string,
    @CurrentUser() user: { id_empresa: number },
  ) {
    return this.clientesService.consultarPorRut(rut, user.id_empresa);
  }
}
