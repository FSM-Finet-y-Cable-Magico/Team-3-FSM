import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { OrdenesService } from './ordenes.service.js';
import { CrearOtDto } from './dto/crear-ot.dto.js';
import { AsignarTecnicoDto } from './dto/asignar-tecnico.dto.js';
import { ReasignarTecnicoDto } from './dto/reasignar-tecnico.dto.js';
import { CambiarPrioridadDto } from './dto/cambiar-prioridad.dto.js';
import { ActualizarEstadoDto } from './dto/actualizar-estado.dto.js';
import { CerrarOtDto } from './dto/cerrar-ot.dto.js';
import {
  ACCION_EQUIPO,
  ACCIONES_EQUIPO_RETIRO,
  ACCION_A_ESTADO_G1,
  DIAGNOSTICO_RETIRO,
  DIAGNOSTICO_POR_DEFECTO,
} from './estado-equipo.constants.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { rangoDiaOperacion } from '../common/utils/dia-habil.util.js';

import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';

// Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales.
@Controller('ordenes')
export class OrdenesController {
  constructor(private ordenesService: OrdenesService) {}

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get()
  listarOT(
    @CurrentUser() user: UsuarioAutenticado,
    @Query('estado') estado?: string,
    @Query('tipo_ot') tipo_ot?: string,
    @Query('prioridad') prioridad?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('mi_dia') mi_dia?: string,
  ) {
    const filtros: Record<string, unknown> = {
      estado,
      tipo_ot,
      prioridad,
      page: page ? +page : 1,
      limit: limit ? +limit : 20,
    };

    // El dia se resuelve aca y no en la Vista (CU-11, M11). Es el dia de
    // operacion de FiNet en America/Santiago, no el del dispositivo: el reloj
    // o el huso del telefono del tecnico no deben decidir que jornada ve. Se
    // recalcula en cada peticion, asi que una sesion abierta que cruza la
    // medianoche pasa al dia siguiente sola.
    if (mi_dia === 'true' || mi_dia === '1') {
      const { desde, hasta } = rangoDiaOperacion();
      filtros.dia_desde = desde;
      filtros.dia_hasta = hasta;
    }

    if (user.rol === 'TECNICO') {
      filtros.id_tecnico = user.userId;
    }

    return this.ordenesService.listarOT(user.id_empresa, filtros);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('tecnicos')
  listarTecnicos(@CurrentUser() user: UsuarioAutenticado) {
    return this.ordenesService.listarTecnicos(user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('historial-fallas/:id_cliente')
  historialFallas(@Param('id_cliente') idCliente: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.ordenesService.historialFallas(+idCliente, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('materiales')
  obtenerMateriales(@CurrentUser() user: UsuarioAutenticado) {
    return this.ordenesService.obtenerMateriales(user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('categorias-falla')
  listarCategoriasFalla() {
    return this.ordenesService.listarCategoriasFalla();
  }

  /**
   * Acciones de equipo y diagnosticos, para el formulario de cierre del tecnico.
   *
   * Sale del backend y no de una copia en la Vista porque los literales los
   * compara G1 con tildes ("Sin senal optica" no es "Sin señal óptica"): un
   * typo del lado del navegador rompe la integracion en silencio. Es la misma
   * fuente que sirve `GET /integraciones/estados-equipo` a G1, asi que los dos
   * lados leen exactamente lo mismo.
   */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('acciones-equipo')
  accionesEquipo() {
    return {
      acciones: Object.values(ACCION_EQUIPO).map((accion) => ({
        accion,
        // Para que el formulario sepa cuando exigir el diagnostico sin tener
        // que repetir aca cuales son las acciones de retiro.
        es_retiro: (ACCIONES_EQUIPO_RETIRO as readonly string[]).includes(accion),
        estado_g1: ACCION_A_ESTADO_G1[accion],
      })),
      diagnosticos: Object.values(DIAGNOSTICO_RETIRO),
      diagnostico_por_defecto: DIAGNOSTICO_POR_DEFECTO,
    };
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get(':id')
  obtenerOT(@Param('id') id: string, @CurrentUser() user: UsuarioAutenticado) {
    return this.ordenesService.obtenerOT(+id, user);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post()
  crearOT(@Body() dto: CrearOtDto, @CurrentUser() user: UsuarioAutenticado) {
    return this.ordenesService.crearOT(dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/asignar')
  asignarTecnico(
    @Param('id') id: string,
    @Body() dto: AsignarTecnicoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ordenesService.asignarTecnico(+id, dto, user.userId, user.id_empresa);
  }

  // RF-45: las dos acciones que el panel de OT detenidas necesita.
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/reasignar')
  reasignarTecnico(
    @Param('id') id: string,
    @Body() dto: ReasignarTecnicoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ordenesService.reasignarTecnico(+id, dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/prioridad')
  cambiarPrioridad(
    @Param('id') id: string,
    @Body() dto: CambiarPrioridadDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ordenesService.cambiarPrioridad(+id, dto, user.userId, user.id_empresa);
  }

  @Roles('TECNICO')
  @Post(':id/foto')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async subirFoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ordenesService.subirFoto(+id, file, user);
  }

  @Roles('TECNICO')
  @Post(':id/cerrar')
  cerrarOT(
    @Param('id') id: string,
    @Body() dto: CerrarOtDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ordenesService.cerrarOT(+id, dto, user);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Patch(':id/estado')
  async actualizarEstado(
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoDto,
    @CurrentUser() user: UsuarioAutenticado,
  ) {
    return this.ordenesService.actualizarEstado(+id, dto, user);
  }
}
