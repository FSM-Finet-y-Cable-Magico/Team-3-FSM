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
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { OrdenesService } from './ordenes.service.js';
import { CrearOtDto } from './dto/crear-ot.dto.js';
import { AsignarTecnicoDto } from './dto/asignar-tecnico.dto.js';
import { ActualizarEstadoDto } from './dto/actualizar-estado.dto.js';
import { CerrarOtDto } from './dto/cerrar-ot.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

interface UserPayload {
  userId: number;
  id_empresa: number;
  rol: string;
}

// Sin @UseGuards: JwtAuthGuard y RolesGuard son APP_GUARD globales.
@Controller('ordenes')
export class OrdenesController {
  constructor(private ordenesService: OrdenesService) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get()
  listarOT(
    @CurrentUser() user: UserPayload,
    @Query('estado') estado?: string,
    @Query('tipo_ot') tipo_ot?: string,
    @Query('prioridad') prioridad?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('fecha_dia') fecha_dia?: string,
  ) {
    const filtros: Record<string, unknown> = {
      estado,
      tipo_ot,
      prioridad,
      page: page ? +page : 1,
      limit: limit ? +limit : 20,
      fecha_dia,
    };

    if (user.rol === 'TECNICO') {
      filtros.id_tecnico = user.userId;
    }

    return this.ordenesService.listarOT(user.id_empresa, filtros);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('tecnicos')
  listarTecnicos(@CurrentUser() user: UserPayload) {
    return this.ordenesService.listarTecnicos(user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('historial-fallas/:id_cliente')
  historialFallas(@Param('id_cliente') idCliente: string, @CurrentUser() user: UserPayload) {
    return this.ordenesService.historialFallas(+idCliente, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('materiales')
  obtenerMateriales(@CurrentUser() user: UserPayload) {
    return this.ordenesService.obtenerMateriales(user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('categorias-falla')
  listarCategoriasFalla() {
    return this.ordenesService.listarCategoriasFalla();
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get(':id')
  obtenerOT(@Param('id') id: string, @CurrentUser() user: UserPayload) {
    return this.ordenesService.obtenerOT(+id, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post()
  crearOT(@Body() dto: CrearOtDto, @CurrentUser() user: UserPayload) {
    return this.ordenesService.crearOT(dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch(':id/asignar')
  asignarTecnico(
    @Param('id') id: string,
    @Body() dto: AsignarTecnicoDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.ordenesService.asignarTecnico(+id, dto, user.userId, user.id_empresa);
  }

  @Roles('TECNICO')
  @Post(':id/foto')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async subirFoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserPayload,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');

    const ot = await this.ordenesService.obtenerOT(+id, user.id_empresa);
    if (ot.id_tecnico !== user.userId) {
      throw new ForbiddenException('Solo el técnico asignado puede subir evidencias a esta OT');
    }

    const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    const formato = this.formatoDesdeMime(file.mimetype);
    const tamano_kb = Math.round(file.size / 1024);
    const cloudinaryConfigurado =
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET;

    if (!cloudinaryConfigurado) {
      return {
        url_cloudinary: dataUri,
        formato,
        tamano_kb,
      };
    }

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'fsm_evidencias',
      resource_type: 'image',
    });
    return {
      url_cloudinary: result.secure_url,
      formato: result.format,
      tamano_kb: Math.round(result.bytes / 1024),
    };
  }

  @Roles('TECNICO')
  @Post(':id/cerrar')
  cerrarOT(
    @Param('id') id: string,
    @Body() dto: CerrarOtDto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.ordenesService.cerrarOT(+id, dto, user.userId, user.id_empresa);
  }

  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Patch(':id/estado')
  async actualizarEstado(
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoDto,
    @CurrentUser() user: UserPayload,
  ) {
    if (user.rol === 'TECNICO') {
      const ot = await this.ordenesService.obtenerOT(+id, user.id_empresa);
      const idTecnico = (ot as Record<string, unknown>).id_tecnico;
      if (idTecnico !== user.userId) {
        throw new ForbiddenException('Solo puedes actualizar OT asignadas a ti');
      }
    }
    return this.ordenesService.actualizarEstado(+id, dto, user.userId, user.id_empresa);
  }

  private formatoDesdeMime(mimetype: string) {
    const formato = mimetype.split('/')[1] ?? 'img';
    return formato === 'jpeg' ? 'jpg' : formato.slice(0, 5);
  }
}
