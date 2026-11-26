import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CortesService } from './cortes.service.js';
import { RegistrarCorteDto } from './dto/registrar-corte.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';

/**
 * Cortes y reactivaciones por morosidad. El ADMIN cambia de empresa con la
 * cabecera de empresa activa, que ya resuelve el JwtStrategy.
 */
@Controller('cortes')
export class CortesController {
  constructor(private cortes: CortesService) {}

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get()
  listar(@CurrentUser() user: UsuarioAutenticado) {
    return this.cortes.listar(user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post(':id/hecho')
  hecho(
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegistrarCorteDto,
  ) {
    return this.cortes.registrar(user.id_empresa, id, dto.accion, dto.observacion, user.userId);
  }
}
