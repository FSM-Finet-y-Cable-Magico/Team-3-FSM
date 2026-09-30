import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IntegracionesService } from './integraciones.service.js';
import { InstalacionesService } from './instalaciones.service.js';
import { SolicitudInstalacionDto } from './dto/solicitud-instalacion.dto.js';
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
  constructor(
    private svc: IntegracionesService,
    private instalaciones: InstalacionesService,
  ) {}

  private ok(data: unknown) {
    return { success: true, data };
  }

  // ---- instalaciones (P0-a del acuerdo con G8) ----

  /**
   * G8 pide la instalacion de una persona que todavia no es cliente. 201 si es
   * una solicitud nueva; 200 con `duplicado: true` si es un reintento del mismo
   * comando (Respuesta de G8, §4.4). `passthrough` deja a Nest serializar la
   * respuesta: solo se cambia el codigo.
   */
  @Post('instalaciones')
  async instalacion(
    @Req() req: ConScope,
    @Body() dto: SolicitudInstalacionDto,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ) {
    const r = await this.instalaciones.crear(req.apiScope, dto);
    res.status(r.creado ? 201 : 200);
    return r.creado
      ? { success: true, data: r.data, message: 'Solicitud de instalación aceptada' }
      : this.ok(r.data);
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

  /**
   * P0-b del acuerdo con G8: estado de una OT. Va DESPUES de `ordenes/cierres`:
   * Nest resuelve las rutas en el orden en que se declaran, y antes que ella
   * este `:id` se tragaria "cierres" como id.
   */
  @Get('ordenes/:id')
  async orden(
    @Req() req: ConScope,
    @Param('id') id: string,
    @Query('id_empresa') id_empresa: string,
  ) {
    return this.ok(await this.svc.orden(req.apiScope, +id, +id_empresa));
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
