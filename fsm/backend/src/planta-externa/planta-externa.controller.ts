import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PlantaExternaService } from './planta-externa.service.js';
import { TopologiaService } from './topologia.service.js';
import {
  CrearCajaDto,
  CrearMufaDto,
  CrearOltDto,
  CrearTarjetaDto,
} from './dto/crear-elemento.dto.js';
import { EditarCajaDto, EditarPuertoDto } from './dto/editar-topologia.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface UserPayload {
  userId: number;
  id_empresa: number;
  rol: string;
}

// Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales.
@Controller('planta-externa')
export class PlantaExternaController {
  constructor(
    private planta: PlantaExternaService,
    private topologia: TopologiaService,
  ) {}

  /** Árbol OLT → tarjetas → mufas → cajas. */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('olts')
  olts(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.planta.arbolOlts(id);
  }

  /** Cajas NAP con ocupación de puertos. */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('cajas')
  cajas(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.planta.listarCajas(id);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('cajas/:id')
  caja(@CurrentUser() user: UserPayload, @Param('id') id: string, @Query('empresa') empresa?: string) {
    const idEmpresa = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.planta.detalleCaja(+id, idEmpresa);
  }

  /** Cajas con coordenadas, para el mapa. */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('mapa')
  mapa(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.planta.mapa(id);
  }

  // -------------------------------------------------------------------------
  // CU-20 · Consultando disponibilidad de puertos NAP
  // -------------------------------------------------------------------------

  /** Cajas con al menos un puerto libre. `zona` acota la búsqueda. */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('cajas-disponibles')
  disponibles(
    @CurrentUser() user: UserPayload,
    @Query('zona') zona?: string,
    @Query('empresa') empresa?: string,
  ) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.topologia.cajasConDisponibilidad(id, zona);
  }

  /** Puertos de una caja, uno por uno, con su estado. */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('cajas/:id/puertos')
  puertos(
    @CurrentUser() user: UserPayload,
    @Param('id') id: string,
    @Query('empresa') empresa?: string,
  ) {
    const idEmpresa = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.topologia.puertosDeCaja(+id, idEmpresa);
  }

  // -------------------------------------------------------------------------
  // CU-18 · Registrando elemento de topología
  // -------------------------------------------------------------------------

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post('olts')
  crearOlt(@Body() dto: CrearOltDto, @CurrentUser() user: UserPayload) {
    return this.topologia.crearOlt(dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post('tarjetas')
  crearTarjeta(@Body() dto: CrearTarjetaDto, @CurrentUser() user: UserPayload) {
    return this.topologia.crearTarjeta(dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post('mufas')
  crearMufa(@Body() dto: CrearMufaDto, @CurrentUser() user: UserPayload) {
    return this.topologia.crearMufa(dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post('cajas')
  crearCaja(@Body() dto: CrearCajaDto, @CurrentUser() user: UserPayload) {
    return this.topologia.crearCaja(dto, user.userId, user.id_empresa);
  }

  // -------------------------------------------------------------------------
  // CU-19 · Consultando y editando topología
  // -------------------------------------------------------------------------

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch('cajas/:id')
  editarCaja(
    @Param('id') id: string,
    @Body() dto: EditarCajaDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.topologia.editarCaja(+id, dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch('puertos/:id')
  editarPuerto(
    @Param('id') id: string,
    @Body() dto: EditarPuertoDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.topologia.editarPuerto(+id, dto, user.userId, user.id_empresa);
  }

  /**
   * Importa un KML de topología (exportado de Tomodat o cualquier GIS).
   * Campo `kml` en multipart/form-data. `empresa` opcional en el query.
   */
  /**
   * Rellena la zona de las cajas que no la tienen, deduciendola de las ONT ya
   * ligadas. Va DESPUES de `POST /monitoreo/ligar-cajas`: sin ese paso no hay
   * de donde sacarla, porque el KML de Tomodat no trae zona.
   *
   * Es un endpoint y no un script suelto por el mismo motivo que `ligar-cajas`:
   * asi queda repetible, con permisos, y sin depender de que alguien corra SQL
   * a mano sobre la base compartida.
   */
  @Roles('ADMIN')
  @Post('derivar-zonas')
  derivarZonas(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.planta.derivarZonas(id);
  }

  @Roles('ADMIN')
  @Post('importar-kml')
  @UseInterceptors(FileInterceptor('kml', { storage: memoryStorage() }))
  importar(
    @UploadedFile() file: { buffer?: Buffer } | undefined,
    @CurrentUser() user: UserPayload,
    @Query('empresa') empresa?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Falta el archivo KML (campo "kml").');
    const id_empresa = empresa ? +empresa : user.id_empresa ?? null;
    return this.planta.importarKml(file.buffer.toString('utf-8'), id_empresa);
  }

  /**
   * Solo dev. Liga las ONT del mock a clientes y cajas para poder demostrar el
   * monitoreo sin credenciales. Requiere haber importado el KML de ejemplo.
   */
  @Roles('ADMIN')
  @Post('dev/sembrar-demo')
  sembrarDemo() {
    return this.planta.sembrarDemo();
  }
}
