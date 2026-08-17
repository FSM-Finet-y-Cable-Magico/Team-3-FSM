import { Controller, Get, Param, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface UserPayload {
  userId: number;
  id_empresa: number;
  rol: string;
}

// Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales.
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get()
  indicadores(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.dashboardService.indicadoresDelDia(id);
  }

  @Roles('ADMIN')
  @Get('empresas')
  listarEmpresas() {
    return this.dashboardService.listarEmpresas();
  }

  @Roles('ADMIN')
  @Get('empresa/:id')
  datosPorEmpresa(@Param('id') id: string) {
    return this.dashboardService.datosPorEmpresa(+id);
  }
}
