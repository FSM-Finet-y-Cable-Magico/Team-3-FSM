import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { IntegracionesService } from './integraciones.service.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiKeyGuard, type ApiScope } from '../common/guards/api-key.guard.js';

interface ConScope {
  apiScope: ApiScope;
}

/**
 * Endpoints servidor-a-servidor para los otros grupos (ACUERDO G1↔G3 y guía
 * global). NO son los endpoints humanos: acá `id_empresa` es parámetro
 * obligatorio y se valida contra el scope de la API key.
 *
 * `@Public()` desactiva el JWT global; `ApiKeyGuard` exige `X-API-KEY`.
 * Respuesta con envoltorio `{ success, data }`.
 */
@Public()
@UseGuards(ApiKeyGuard)
@Controller('integraciones')
export class IntegracionesController {
  constructor(private svc: IntegracionesService) {}

  private ok(data: unknown) {
    return { success: true, data };
  }

  // ---- OTs ----

  @Get('ordenes')
  async ordenes(
    @Req() req: ConScope,
    @Query('id_empresa') id_empresa: string,
    @Query('estado') estado?: string,
    @Query('id_tecnico') id_tecnico?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ok(
      await this.svc.ordenes(req.apiScope, {
        id_empresa: +id_empresa,
        estado,
        id_tecnico: id_tecnico ? +id_tecnico : undefined,
        desde,
        hasta,
        page: page ? +page : undefined,
        limit: limit ? +limit : undefined,
      }),
    );
  }

  /** T1-CU-90: cierres con materiales en un rango ≤90 días. */
  @Get('ordenes/cierres')
  async cierres(
    @Req() req: ConScope,
    @Query('id_empresa') id_empresa: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('page') page?: string,
  ) {
    return this.ok(
      await this.svc.cierres(req.apiScope, {
        id_empresa: +id_empresa,
        desde,
        hasta,
        page: page ? +page : undefined,
      }),
    );
  }

  /** Reconciliación: payload completo de un cierre (igual que el webhook). */
  @Get('ordenes/:id/cierre')
  async cierre(
    @Req() req: ConScope,
    @Param('id') id: string,
    @Query('id_empresa') id_empresa: string,
  ) {
    return this.ok(await this.svc.cierre(req.apiScope, +id, +id_empresa));
  }

  // ---- catálogo / clientes ----

  @Get('categorias-falla')
  async categoriasFalla() {
    return this.ok(await this.svc.categoriasFalla());
  }

  @Get('estados-equipo')
  mapeoEstados() {
    return this.ok(this.svc.mapeoEstados());
  }

  @Get('clientes/rut/:rut')
  async clientePorRut(
    @Req() req: ConScope,
    @Param('rut') rut: string,
    @Query('id_empresa') id_empresa: string,
  ) {
    return this.ok(await this.svc.clientePorRut(req.apiScope, +id_empresa, rut));
  }

  @Get('clientes')
  async buscarClientes(
    @Req() req: ConScope,
    @Query('id_empresa') id_empresa: string,
    @Query('busqueda') busqueda: string,
  ) {
    return this.ok(await this.svc.buscarClientes(req.apiScope, +id_empresa, busqueda));
  }
}
