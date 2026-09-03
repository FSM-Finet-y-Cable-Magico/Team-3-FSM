
import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { MonitoreoService } from './monitoreo.service.js';
import { DescubrimientoService } from './descubrimiento.service.js';
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
  ) {}

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
  detalle(@Param('sn') sn: string) {
    return this.monitoreo.detalleOnt(sn);
  }

  /**
   * Estado de conexión de las ONT de un cliente.
   * Pensado para que G8 lo consuma (CU-49 "estado de conexión del cliente").
   */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('cliente/:id_cliente')
  porCliente(@Param('id_cliente') idCliente: string) {
    return this.monitoreo.estadoCliente(+idCliente);
  }

  /** Dispara una ingesta manual. Útil para dev y para la demo. */
  @Roles('ADMIN')
  @Post('ingestar')
  ingestar() {
    return this.monitoreo.ingestarLecturas();
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
