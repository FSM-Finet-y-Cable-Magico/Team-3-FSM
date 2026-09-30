import { Controller, Get, Query } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

/**
 * CU-41. Solo ADMIN: el log cruza todos los modulos y muestra quien hizo que,
 * incluidos los cambios de otros usuarios. Un JEFE_TECNICO no lo necesita para
 * su trabajo, y `RolesGuard` falla cerrado, asi que dejarlo fuera no es un
 * olvido sino la decision.
 */
@Controller('auditoria')
export class AuditoriaController {
  constructor(private auditoria: AuditoriaService) {}

  @Roles('ADMIN')
  @Get()
  listar(
    @CurrentUser() user: { id_empresa: number },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('accion') accion?: string,
    @Query('entidad') entidad?: string,
    @Query('id_entidad') id_entidad?: string,
    @Query('id_usuario') id_usuario?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.auditoria.listar(user.id_empresa, page, limit, {
      accion,
      entidad,
      id_entidad,
      id_usuario,
      desde,
      hasta,
    });
  }

  @Roles('ADMIN')
  @Get('acciones')
  acciones(@CurrentUser() user: { id_empresa: number }) {
    return this.auditoria.acciones(user.id_empresa);
  }
}
