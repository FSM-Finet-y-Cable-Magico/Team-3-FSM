import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { CambiarPasswordDto } from './dto/cambiar-password.dto.js';
import { CrearUsuarioDto } from './dto/crear-usuario.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, ip: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { nombre_usuario: dto.nombre_usuario },
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
        omit: { password_hash: true },
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
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        id_empresa,
        activo: true,
      },
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
      rol: u.roles[0]?.rol?.nombre_rol ?? '',
    }));
  }

  private async registrarIntentoFallido(id_empresa: number | null, ip: string, rut_intentado: string) {
    await this.prisma.intento_fallido.create({
      data: {
        id_empresa,
        ip_address: ip,
        rut_intentado,
      },
    });
  }
}
