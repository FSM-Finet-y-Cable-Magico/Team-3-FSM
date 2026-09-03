import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PlantaExternaService } from './planta-externa.service.js';
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
  constructor(private planta: PlantaExternaService) {}

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
  caja(@Param('id') id: string) {
    return this.planta.detalleCaja(+id);
  }

  /** Cajas con coordenadas, para el mapa. */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('mapa')
  mapa(@CurrentUser() user: UserPayload, @Query('empresa') empresa?: string) {
    const id = user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
    return this.planta.mapa(id);
  }

  /**
   * Importa un KML de topología (exportado de Tomodat o cualquier GIS).
   * Campo `kml` en multipart/form-data. `empresa` opcional en el query.
   */
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
