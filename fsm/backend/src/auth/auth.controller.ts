import { Controller, Post, Get, Body, Ip } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { CambiarPasswordDto } from './dto/cambiar-password.dto.js';
import { CrearUsuarioDto } from './dto/crear-usuario.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Unico endpoint realmente publico del sistema: es quien emite el token,
  // asi que no puede exigirlo.
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  // Necesita token (usa user.userId) pero esta abierto a los tres roles por
  // diseño: CU-39 obliga a cambiar la password en el primer ingreso, y eso
  // aplica a cualquiera. Por eso lleva @Roles con los tres y NO @Public(),
  // que le quitaria la autenticacion y dejaria user.userId en undefined.
  @Roles('ADMIN', 'JEFE_TECNICO', 'TECNICO')
  @Post('cambiar-password')
  cambiarPassword(@CurrentUser() user: { userId: number }, @Body() dto: CambiarPasswordDto) {
    return this.authService.cambiarPassword(user.userId, dto);
  }

  @Roles('ADMIN')
  @Post('usuarios')
  crearUsuario(@Body() dto: CrearUsuarioDto, @CurrentUser() user: { userId: number }) {
    return this.authService.crearUsuario(dto, user.userId);
  }

  @Roles('ADMIN')
  @Get('usuarios')
  listarUsuarios(@CurrentUser() user: { id_empresa: number }) {
    return this.authService.listarUsuarios(user.id_empresa);
  }
}
