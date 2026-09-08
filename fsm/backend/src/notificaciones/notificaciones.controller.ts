import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service.js';
import { CrearPlantillaDto, EditarPlantillaDto } from './dto/plantilla.dto.js';
import { NotificarAlertaDto } from './dto/notificar.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  CANAL_NOTIFICACION,
  TIPO_EVENTO,
  VARIABLES_PLANTILLA,
  HORAS_OT_INACTIVA,
} from './notificaciones.constants.js';

interface UsuarioAutenticado {
  userId: number;
  rol: string;
  id_empresa: number;
}

@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly svc: NotificacionesService) {}

  /** Canales, eventos y variables, para poblar el formulario de plantillas. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('opciones')
  opciones() {
    return {
      canales: Object.values(CANAL_NOTIFICACION),
      tipos_evento: Object.values(TIPO_EVENTO),
      variables: VARIABLES_PLANTILLA,
      horas_ot_inactiva: HORAS_OT_INACTIVA,
      // Se declara para que la pantalla pueda advertirlo en vez de que el jefe
      // tecnico crea que el cliente ya fue avisado.
      envio_real_disponible: false,
    };
  }

  // --- RF-43: plantillas ------------------------------------------------------

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('plantillas')
  listarPlantillas(@CurrentUser() user: UsuarioAutenticado, @Query('empresa') empresa?: string) {
    return this.svc.listarPlantillas(this.empresaDe(user, empresa));
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post('plantillas')
  crearPlantilla(
    @CurrentUser() user: UsuarioAutenticado,
    @Body() dto: CrearPlantillaDto,
    @Query('empresa') empresa?: string,
  ) {
    return this.svc.crearPlantilla(this.empresaDe(user, empresa), dto);
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch('plantillas/:id')
  editarPlantilla(
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: EditarPlantillaDto,
    @Query('empresa') empresa?: string,
  ) {
    return this.svc.editarPlantilla(+id, this.empresaDe(user, empresa), dto);
  }

  /** Desactiva; no borra. Ver el comentario del servicio. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Patch('plantillas/:id/desactivar')
  desactivarPlantilla(
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id') id: string,
    @Query('empresa') empresa?: string,
  ) {
    return this.svc.desactivarPlantilla(+id, this.empresaDe(user, empresa));
  }

  // --- RF-42: aviso masivo ----------------------------------------------------

  /** A quienes alcanzaria el aviso. Se mira ANTES de mandar. */
  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('alertas/:id/destinatarios')
  destinatarios(
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id') id: string,
    @Query('empresa') empresa?: string,
  ) {
    return this.svc.destinatariosDeAlerta(+id, this.empresaDe(user, empresa));
  }

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Post('alertas/:id/notificar')
  notificar(
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() dto: NotificarAlertaDto,
    @Query('empresa') empresa?: string,
  ) {
    return this.svc.notificarAlerta(+id, this.empresaDe(user, empresa), dto);
  }

  /**
   * Lo que se le avisó a un cliente.
   *
   * TECNICO tambien puede leerlo: llega al domicilio y el cliente le pregunta
   * si le avisaron. Es lectura de lo ya enviado, no permite mandar nada.
   */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Get('cliente/:id_cliente')
  historialCliente(
    @CurrentUser() user: UsuarioAutenticado,
    @Param('id_cliente') idCliente: string,
    @Query('empresa') empresa?: string,
  ) {
    return this.svc.historialCliente(+idCliente, this.empresaDe(user, empresa));
  }

  // --- RF-45: OT detenidas ----------------------------------------------------

  @Roles('ADMIN', 'JEFE_TECNICO')
  @Get('ot-detenidas')
  otDetenidas(
    @CurrentUser() user: UsuarioAutenticado,
    @Query('horas') horas?: string,
    @Query('empresa') empresa?: string,
  ) {
    const h = horas ? Number(horas) : undefined;
    return this.svc.otDetenidas(
      this.empresaDe(user, empresa),
      Number.isFinite(h) && h! > 0 ? h : undefined,
    );
  }

  /** Igual que en el resto: solo ADMIN puede mirar otra empresa. */
  private empresaDe(user: UsuarioAutenticado, empresa?: string) {
    return user.rol === 'ADMIN' && empresa ? +empresa : user.id_empresa;
  }
}
