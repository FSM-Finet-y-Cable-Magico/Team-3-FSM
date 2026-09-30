import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IntegracionesService } from './integraciones.service.js';
import { InstalacionesService } from './instalaciones.service.js';
import { SolicitudInstalacionDto } from './dto/solicitud-instalacion.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiKeyGuard, exigirEmpresaEnScope, type ApiScope } from '../common/guards/api-key.guard.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { CrearTicketIntegracionDto } from '../tickets/dto/tickets.dto.js';
import { ClaveWifiService } from './clave-wifi.service.js';
import { SolicitudClaveWifiDto } from './dto/solicitud-clave-wifi.dto.js';

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
    private tickets: TicketsService,
    private claveWifi: ClaveWifiService,
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

  // ---- tickets de soporte (CU-29 desde canales digitales) ----

  /**
   * CU-29: el cliente reporta desde el portal o el bot de otro grupo. El ticket
   * queda a nombre del sistema (sin usuario) y responde el codigo de
   * seguimiento y el vencimiento del SLA, que el canal le muestra al cliente.
   */
  @Post('tickets')
  async crearTicket(@Req() req: ConScope, @Body() dto: CrearTicketIntegracionDto) {
    const id_empresa = exigirEmpresaEnScope(req.apiScope, dto.id_empresa);
    const { rut_cliente, id_categoria, descripcion, origen } = dto;
    return this.ok(
      await this.tickets.crear({ rut_cliente, id_categoria, descripcion, origen }, { userId: null, id_empresa }),
    );
  }

  /** Seguimiento por codigo TK-XXXXXXX, para que el canal le muestre el estado. */
  @Get('tickets/:codigo')
  async seguimientoTicket(
    @Req() req: ConScope,
    @Param('codigo') codigo: string,
    @Query('id_empresa') id_empresa: string,
  ) {
    const empresa = exigirEmpresaEnScope(req.apiScope, +id_empresa);
    return this.ok(await this.tickets.porCodigo(codigo, empresa));
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
  // ---- clave WiFi desde el portal de G2 (acuerdo §6.4) ----

  /**
   * G2 manda la clave WiFi que el cliente eligio, cifrada con nuestra llave
   * publica. Va por endpoint y no por la base compartida porque el §6.5
   * prohibe que G8 pueda leerla.
   *
   * 201 si es nueva; 200 con `duplicado: true` si es un reintento del mismo
   * `request_id` con el mismo contenido (§3.6 de nuestra respuesta a G2), que
   * es lo que les deja reintentar sin aplicar el cambio dos veces.
   */
  @Post('contrasena-wifi')
  async contrasenaWifi(
    @Req() req: ConScope,
    @Body() dto: SolicitudClaveWifiDto,
    @Res({ passthrough: true }) res: { status(code: number): unknown },
  ) {
    const r = await this.claveWifi.recibir(dto, req.apiScope);
    res.status(r.duplicado ? 200 : 201);
    return this.ok(r);
  }
}

