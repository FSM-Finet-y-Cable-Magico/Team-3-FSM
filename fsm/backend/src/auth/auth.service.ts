import {
  Injectable,
  Logger,
  NotFoundException,
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

  /**
   * `incluir_inactivos` es para CU-43: una cuenta desactivada desaparecia del
   * listado, asi que no habia desde donde reactivarla. Va como parametro y no
   * como cambio del comportamiento por defecto para no alterar a quien ya
   * consume este endpoint esperando solo los activos.
   */
  async listarUsuarios(id_empresa: number, incluir_inactivos = false) {
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        id_empresa,
        ...(incluir_inactivos ? {} : { activo: true }),
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
      // Sin esto la Vista no puede dibujar el interruptor en la posicion
      // correcta, y el listado con inactivos no se distingue del normal.
      activo: u.activo,
      fecha_creacion: u.fecha_creacion,
      rol: u.roles[0]?.rol?.nombre_rol ?? '',
    }));
  }

  /**
   * CU-43 "Desactivando una cuenta de usuario".
   *
   * `usuario.activo` ya lo comprueba `login()`, asi que desactivar corta el
   * acceso en el siguiente intento. Lo que NO hace es invalidar un token ya
   * emitido: el JWT es autocontenido y sigue sirviendo hasta que expire
   * (JWT_EXPIRES_IN, 8h). Revocar de verdad necesitaria una lista de tokens
   * vivos, que no existe y no esta en el alcance del incremento.
   *
   * Tres cosas que este metodo no deja hacer, todas por la misma razon --que
   * el sistema quede sin quien lo administre--:
   */
  async cambiarActivo(
    id_objetivo: number,
    activo: boolean,
    admin: { userId: number; id_empresa: number },
  ) {
    // 1. Desactivarse a si mismo. El ADMIN perderia su propia sesion en el
    //    siguiente login y tendria que pedirle a otro que lo reactive.
    if (id_objetivo === admin.userId) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }

    // 2. Tocar una cuenta de otra empresa. El listado ya filtra por empresa;
    //    sin esto, el endpoint seria la puerta de atras a ese aislamiento.
    const usuario = await this.prisma.usuario.findFirst({
      where: { id_usuario: id_objetivo, id_empresa: admin.id_empresa },
      include: { roles: { include: { rol: true } } },
    });
    if (!usuario) {
      throw new NotFoundException(`Usuario ${id_objetivo} no encontrado`);
    }

    if (usuario.activo === activo) {
      throw new ConflictException(
        `La cuenta de ${usuario.nombre_completo} ya está ${activo ? 'activa' : 'inactiva'}`,
      );
    }

    // 3. Dejar a la empresa sin ningun ADMIN activo. Es el unico rol que puede
    //    reactivar cuentas, asi que desactivar al ultimo deja a la empresa sin
    //    forma de volver atras sin tocar la base a mano.
    const esAdmin = usuario.roles.some((r) => r.rol?.nombre_rol === 'ADMIN');
    if (!activo && esAdmin) {
      const otrosAdmins = await this.prisma.usuario.count({
        where: {
          id_empresa: admin.id_empresa,
          activo: true,
          id_usuario: { not: id_objetivo },
          roles: { some: { rol: { nombre_rol: 'ADMIN' } } },
        },
      });
      if (otrosAdmins === 0) {
        throw new ConflictException(
          'No puedes desactivar al último administrador activo de la empresa',
        );
      }
    }

    // Se guarda ANTES de la transaccion a proposito. Leerlo despues del update
    // ata el valor auditado al orden de las escrituras, y ese es justo el tipo
    // de acoplamiento que hace que la auditoria mienta sin que nadie lo note.
    const activoAnterior = usuario.activo;

    const actualizado = await this.prisma.$transaction(async (tx) => {
      const fila = await tx.usuario.update({
        where: { id_usuario: id_objetivo },
        data: { activo },
      });

      // `valor_anterior` y `valor_nuevo` son Json? y existen para esto: dejan
      // reconstruir quien desactivo a quien y cuando, sin releer el historial.
      await tx.log_auditoria.create({
        data: {
          id_usuario: admin.userId,
          accion: activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO',
          entidad_afectada: 'usuario',
          id_entidad_afectada: id_objetivo,
          valor_anterior: { activo: activoAnterior },
          valor_nuevo: { activo },
          fecha_hora: new Date(),
        },
      });

      return fila;
    });

    this.logger.log(
      `Usuario ${id_objetivo} ${activo ? 'activado' : 'desactivado'} por ${admin.userId}`,
    );

    return {
      id_usuario: actualizado.id_usuario,
      nombre_completo: actualizado.nombre_completo,
      nombre_usuario: actualizado.nombre_usuario,
      activo: actualizado.activo,
    };
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
