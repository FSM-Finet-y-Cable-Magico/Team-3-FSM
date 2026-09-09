import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';
import { ConfiguracionService } from './configuracion.service.js';
import { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto.js';

/** RF-46: configuracion de la empresa. Hoy es solo el umbral de desconexion. */
@Controller('configuracion')
export class ConfiguracionController {
  constructor(private readonly svc: ConfiguracionService) {}

  /**
   * JEFE_TECNICO tambien lee: el umbral explica por que una alerta aparecio
   * cuando aparecio, y no poder verlo obliga a preguntar. Escribir es solo de
   * ADMIN, que es lo que dice el RF.
   */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get()
  obtener(@CurrentUser() user: UsuarioAutenticado, @Query('empresa') empresa?: string) {
    return this.svc.obtener(this.empresaDe(user, empresa));
  }

  @Roles('ADMIN')
  @Patch()
  actualizar(
    @CurrentUser() user: UsuarioAutenticado,
    @Body() dto: ActualizarConfiguracionDto,
    @Query('empresa') empresa?: string,
  ) {
    return this.svc.actualizar(this.empresaDe(user, empresa), dto);
  }

  /** Igual que en el resto: solo ADMIN puede mirar otra empresa. */
  private empresaDe(user: UsuarioAutenticado, empresa?: string) {
    return user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
  }
}
