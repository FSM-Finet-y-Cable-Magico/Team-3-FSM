import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditoriaService, type FiltrosAuditoria } from './auditoria.service.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';

/** CU-41: consulta del log de auditoria. Solo el ADMIN. */
@Controller('auditoria')
export class AuditoriaController {
  constructor(private auditoria: AuditoriaService) {}

  @Roles('ADMIN')
  @Get()
  buscar(@CurrentUser() user: UsuarioAutenticado, @Query() filtros: FiltrosAuditoria) {
    return this.auditoria.buscar(user.id_empresa, filtros);
  }

  @Roles('ADMIN')
  @Get('acciones')
  acciones(@CurrentUser() user: UsuarioAutenticado) {
    return this.auditoria.acciones(user.id_empresa);
  }

  @Roles('ADMIN')
  @Get('exportar')
  async exportar(
    @CurrentUser() user: UsuarioAutenticado,
    @Query() filtros: FiltrosAuditoria,
    @Res() res: Response,
  ) {
    const archivo = await this.auditoria.exportar(user.id_empresa, filtros);
    res.setHeader('Content-Type', archivo.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${archivo.nombre}"; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`,
    );
    res.setHeader('Content-Length', String(archivo.contenido.length));
    res.end(archivo.contenido);
  }
}
