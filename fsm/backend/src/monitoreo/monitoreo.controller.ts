
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MonitoreoService } from './monitoreo.service.js';
import { DescubrimientoService } from './descubrimiento.service.js';
import { LigadoCajaService } from './ligado-caja.service.js';
import { AlertasService } from './alertas.service.js';
import { RevisarAlertaDto } from './dto/revisar-alerta.dto.js';
import { ConsultaLecturasDto } from './dto/consulta-lecturas.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface UserPayload {
  userId: number;
  id_empresa: number;
  rol: string;
}

// Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales.
// Todo endpoint lleva @Roles(...) — sin él, RolesGuard responde 403.
@Controller('monitoreo')
export class MonitoreoController {
  constructor(
    private monitoreo: MonitoreoService,
    private descubrimiento: DescubrimientoService,
    private ligado: LigadoCajaService,
    private alertas: AlertasService,
  ) {}

  // --- Alertas (CU-13 / CU-15 / CU-17 / CU-52 / CU-53) -----------------------

  /** Contadores de alertas abiertas, para la cabecera del panel. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('alertas/resumen')
  resumenAlertas(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.alertas.resumen(id);
  }

  /** Zonas y cajas con alertas abiertas, para poblar los filtros del panel. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('alertas/facetas')
  facetasAlertas(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.alertas.facetas(id);
  }

  /** Listado de alertas. Por defecto las pendientes. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('alertas')
  listarAlertas(
    @CurrentUser() user: UserPayload,
    @Query('resueltas') resueltas?: string,
    @Query('tipo') tipo?: string,
    @Query('limit') limit?: string,
    @Query('zona') zona?: string,
    @Query('caja') caja?: string,
    @Query('empresa') empresa?: string,
  ) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.alertas.listar(id, resueltas === 'true', tipo, limit ? +limit : 100, zona, caja);
  }

  /** El jefe técnico marca la alerta como revisada (CU-52, sirve a CU-08). */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch('alertas/:id/revisar')
  revisarAlerta(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Body() dto: RevisarAlertaDto,
    @Query('empresa') empresa?: string,
  ) {
    const idEmpresa = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.alertas.revisar(+id, idEmpresa, user.userId, dto.observacion);
  }

  /**
   * Corre el motor de alertas. Manual acá; en producción lo dispara el poller
   * después de cada ingesta.
   */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post('alertas/evaluar')
  evaluarAlertas(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.alertas.evaluarEmpresa(id);
  }

  /** Contadores para el dashboard de monitoreo. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('resumen')
  resumen(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.monitoreo.resumen(id);
  }

  /** Última lectura por ONT. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('ont')
  lecturas(
    @CurrentUser() user: UserPayload,
    @Query() q: ConsultaLecturasDto,
    @Query('empresa') empresa?: string,
  ) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.monitoreo.lecturasRecientes(id, q.page, q.limit);
  }

  /** Detalle de una ONT por número de serie: última lectura + historial. */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('ont/:sn')
  detalle(@CurrentUser() user: UserPayload, @Param('sn') sn: string, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.monitoreo.detalleOnt(sn, id);
  }

  /**
   * Estado de conexión de las ONT de un cliente.
   * Pensado para que G8 lo consuma (CU-49 "estado de conexión del cliente").
   */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('cliente/:id_cliente')
  porCliente(
    @CurrentUser() user: UserPayload,
    @Param('id_cliente') idCliente: string,
    @Query('empresa') empresa?: string,
  ) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.monitoreo.estadoCliente(+idCliente, id);
  }

  /** Dispara una ingesta manual. Útil para dev y para la demo. */
  @Roles('ADMIN')
  @Post('ingestar')
  ingestar() {
    return this.monitoreo.ingestarLecturas();
  }

  /**
   * Liga las ONT sin caja a su caja NAP, cruzando el nombre que trae la fuente
   * contra las cajas del KML (Precondición 2 del Incremento 2). Idempotente:
   * solo toca las que están sin ligar, nunca pisa un enlace ya resuelto.
   */
  @Roles('ADMIN')
  @Post('ligar-cajas')
  ligarCajas(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.ligado.ligarCajas(id);
  }

  /**
   * Sincroniza la topología (OLTs, cajas NAP) desde la fuente.
   * Responde 403 mientras `MONITOREO_TOPOLOGIA_ENABLED` sea false.
   */
  @Roles('ADMIN')
  @Post('sincronizar-topologia')
  sincronizar() {
    return this.descubrimiento.sincronizarTopologia();
  }
}
