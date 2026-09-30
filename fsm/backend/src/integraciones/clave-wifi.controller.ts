import { Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ClaveWifiService } from './clave-wifi.service.js';

interface UsuarioActual {
  id_empresa: number;
}

/**
 * Cara humana del canal de clave WiFi: lo que usa el tecnico, con JWT.
 *
 * Aparte del controlador de integraciones a proposito. Ese va con `@Public()` y
 * clave de API porque lo llama otro sistema; este exige sesion y rol, y de
 * mezclarlos en un controlador quedaria un endpoint humano heredando el
 * `@Public()` de la clase.
 */
@Controller('clave-wifi')
export class ClaveWifiController {
  constructor(private claveWifi: ClaveWifiService) {}

  /**
   * Entrega la clave en claro, UNA SOLA VEZ.
   *
   * Es POST y no GET aunque parezca una lectura: consume la solicitud y la deja
   * marcada como entregada. Un GET invitaria a reintentos, precarga del
   * navegador y registro en logs de proxies, y cada uno de esos quemaria la
   * unica lectura que tiene el tecnico.
   */
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Post(':id/entregar')
  entregar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: UsuarioActual,
  ) {
    return this.claveWifi.entregar(id, user.id_empresa);
  }
}
