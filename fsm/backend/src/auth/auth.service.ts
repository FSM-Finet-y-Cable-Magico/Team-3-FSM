import {
  Injectable,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { CambiarPasswordDto } from './dto/cambiar-password.dto.js';
import { CrearUsuarioDto } from './dto/crear-usuario.dto.js';
import type { UsuarioAutenticado } from '../common/types/usuario-autenticado.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, ip: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { nombre_usuario: dto.nombre_usuario },
      // Unico punto que necesita el hash: se compara con bcrypt y no se retorna.
      omit: { password_hash: false },
    });

    if (!usuario) {
      await this.registrarIntentoFallido(null, ip, dto.nombre_usuario);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    if (!usuario.activo) {
      throw new ForbiddenException('Tu cuenta está inactiva. Contacta al administrador');
    }

    const intentoBloqueo = await this.prisma.intento_fallido.findFirst({
      where: {
        rut_intentado: dto.nombre_usuario,
        bloqueado_hasta: { gt: new Date() },
      },
      orderBy: { bloqueado_hasta: 'desc' },
    });

    if (intentoBloqueo) {
      throw new ForbiddenException(
        'Tu cuenta está bloqueada hasta ' + intentoBloqueo.bloqueado_hasta!.toLocaleString('es-CL'),
      );
    }

    const passwordValido = await bcrypt.compare(dto.password, usuario.password_hash);
    if (!passwordValido) {
      await this.registrarIntentoFallido(usuario.id_empresa, ip, dto.nombre_usuario);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const usuarioRol = await this.prisma.usuario_rol.findFirst({
      where: { id_usuario: usuario.id_usuario },
      include: { rol: true },
    });

    const nombreRol = usuarioRol?.rol?.nombre_rol ?? '';

    const payload = {
      userId: usuario.id_usuario,
      nombre_usuario: usuario.nombre_usuario,
      rol: nombreRol,
      id_empresa: usuario.id_empresa,
    };

    const token = this.jwtService.sign(payload);

    return {
      token,
      rol: nombreRol,
      id_empresa: usuario.id_empresa,
      cambiar_password: usuario.es_password_temporal,
    };
  }

  async cambiarPassword(userId: number, dto: CambiarPasswordDto) {
    if (dto.nueva_password !== dto.confirmar_password) {
      throw new BadRequestException('Las contraseñas no coinciden');
    }

    const passwordHash = await bcrypt.hash(dto.nueva_password, 12);

    await this.prisma.usuario.update({
      where: { id_usuario: userId },
      data: {
        password_hash: passwordHash,
        es_password_temporal: false,
      },
    });

    await this.prisma.log_auditoria.create({
      data: {
        id_usuario: userId,
        accion: 'CAMBIO_PASSWORD',
        entidad_afectada: 'usuario',
        id_entidad_afectada: userId,
        fecha_hora: new Date(),
      },
    });
  }

  async crearUsuario(dto: CrearUsuarioDto, creadorId: number) {
    const existente = await this.prisma.usuario.findUnique({
      where: { nombre_usuario: dto.nombre_usuario },
    });

    if (existente) {
      throw new ConflictException('El nombre de usuario ya está registrado. Elige uno diferente');
    }

    const passwordHash = await bcrypt.hash(dto.password_temporal, 12);

    const result = await this.prisma.$transaction(async (tx) => {
      const nuevoUsuario = await tx.usuario.create({
        data: {
          nombre_completo: dto.nombre_completo,
          nombre_usuario: dto.nombre_usuario,
          password_hash: passwordHash,
          activo: true,
          es_password_temporal: true,
          empresa: { connect: { id_empresa: dto.id_empresa } },
        },
      });

      const rol = await tx.rol.findUnique({
        where: { nombre_rol: dto.rol },
      });

      if (rol) {
        await tx.usuario_rol.create({
          data: {
            usuario: { connect: { id_usuario: nuevoUsuario.id_usuario } },
            rol: { connect: { id_rol: rol.id_rol } },
          },
        });
      }

      await tx.log_auditoria.create({
        data: {
          id_usuario: creadorId,
          accion: 'CREAR_USUARIO',
          entidad_afectada: 'usuario',
          id_entidad_afectada: nuevoUsuario.id_usuario,
          fecha_hora: new Date(),
        },
      });

      return nuevoUsuario;
    });

    return result;
  }

  async listarUsuarios(id_empresa: number) {
    // CU-43: tambien las desactivadas. Si no aparecen, no hay como reactivarlas.
    const usuarios = await this.prisma.usuario.findMany({
      where: { id_empresa },
      include: {
        roles: {
          include: {
            rol: true,
          },
        },
      },
      orderBy: { fecha_creacion: 'desc' },
    });

    return usuarios.map((u) => ({
      id_usuario: u.id_usuario,
      id_empresa: u.id_empresa,
      nombre_completo: u.nombre_completo,
      nombre_usuario: u.nombre_usuario,
      email: u.email,
      fecha_creacion: u.fecha_creacion,
      activo: u.activo,
      rol: u.roles[0]?.rol?.nombre_rol ?? '',
    }));
  }

  /**
   * CU-43: desactivar (o reactivar) una cuenta. Una cuenta desactivada no
   * puede iniciar sesion, y la estrategia JWT rechaza tambien los tokens que
   * ya tenia emitidos: el corte es inmediato, no a las 8 horas.
   *
   * No se borra nada: el historial, las OT y la auditoria de esa persona
   * siguen apuntando a su fila. Devuelve cuantas OT activas le quedan para
   * que la Vista avise y el jefe tecnico las reasigne (RF-45).
   */
  async cambiarActivo(id_usuario: number, activo: boolean, actor: UsuarioAutenticado) {
    if (id_usuario === actor.userId && !activo) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }
    const usuario = await this.prisma.usuario.findFirst({
      where: { id_usuario, id_empresa: actor.id_empresa },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    if (usuario.activo !== activo) {
      await this.prisma.$transaction(async (tx) => {
        await tx.usuario.update({ where: { id_usuario }, data: { activo } });
        await tx.log_auditoria.create({
          data: {
            id_usuario: actor.userId,
            accion: activo ? 'REACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO',
            entidad_afectada: 'usuario',
            id_entidad_afectada: id_usuario,
            valor_anterior: { activo: usuario.activo },
            valor_nuevo: { activo },
          },
        });
      });
    }

    const ot_activas = await this.prisma.orden_trabajo.count({
      where: { id_tecnico: id_usuario, id_empresa: actor.id_empresa, estado: { in: ['ASIGNADA', 'EN_CURSO'] } },
    });
    return { id_usuario, activo, ot_activas };
  }

  /**
   * Anota el intento fallido para el bloqueo de C6 (#19).
   *
   * No propaga el error a proposito. Esta escritura es contabilidad: ocurre
   * ANTES de lanzar el 401, asi que si falla se lleva puesta la respuesta y el
   * usuario recibe un 500 "Internal server error" en vez de "usuario o
   * contrasena incorrectos". Fue exactamente lo que paso con `rut_intentado`
   * en VarChar(12): todo login fallido de una cuenta con nombre de mas de 12
   * caracteres --casi todos los tecnicos-- salia como 500, y encima parecia
   * una caida del servidor en vez de una clave mala.
   *
   * Pero callarse tampoco sirve: si esto falla, el bloqueo por intentos
   * fallidos deja de protegerte y nadie se entera. Por eso se registra como
   * error en el log, con el nombre de usuario, para que quede a la vista.
   */
  private async registrarIntentoFallido(id_empresa: number | null, ip: string, rut_intentado: string) {
    try {
      await this.prisma.intento_fallido.create({
        data: {
          id_empresa,
          ip_address: ip,
          rut_intentado,
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el intento fallido de "${rut_intentado}": el bloqueo por ` +
          'intentos no se esta aplicando para esa cuenta',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
