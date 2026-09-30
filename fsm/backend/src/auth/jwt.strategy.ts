import { BadRequestException, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * CU-33: empresa con la que trabaja el ADMIN. Los headers llegan en minuscula.
 * La Vista lo manda en toda peticion cuando el ADMIN eligio una empresa.
 */
export const HEADER_EMPRESA_ACTIVA = 'x-empresa-activa';

interface PayloadJwt {
  userId: number;
  nombre_usuario: string;
  rol: string;
  id_empresa: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
      passReqToCallback: true,
    });
  }

  /**
   * CU-33, cambio de empresa activa. El ADMIN administra las dos empresas y
   * elige con cual trabaja: si manda el header, `id_empresa` pasa a ser esa, y
   * todo endpoint --que ya filtra por `user.id_empresa`-- trabaja sobre ella
   * sin cambios. Se resuelve aca, en un solo lugar, en vez de que cada
   * controller lea un parametro: antes solo cuatro aceptaban `?empresa=` y el
   * resto ignoraba la eleccion en silencio.
   *
   * Los demas roles quedan siempre en la empresa de su token, manden lo que
   * manden. Una empresa que no existe es 400: sin esto una escritura fallaria
   * con 500 por la FK, o una lectura devolveria vacio sin explicar por que.
   */
  async validate(req: { headers: Record<string, string | string[] | undefined> }, payload: PayloadJwt) {
    const usuario = {
      userId: payload.userId,
      nombre_usuario: payload.nombre_usuario,
      rol: payload.rol,
      id_empresa: payload.id_empresa,
    };

    const pedida = req.headers?.[HEADER_EMPRESA_ACTIVA];
    if (payload.rol !== 'ADMIN' || pedida === undefined || pedida === '') return usuario;

    const id = Number(pedida);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Empresa activa inválida');
    }
    if (id === payload.id_empresa) return usuario;

    const empresa = await this.prisma.empresa.findUnique({ where: { id_empresa: id }, select: { id_empresa: true } });
    if (!empresa) throw new BadRequestException(`La empresa ${id} no existe`);
    return { ...usuario, id_empresa: id };
  }
}
