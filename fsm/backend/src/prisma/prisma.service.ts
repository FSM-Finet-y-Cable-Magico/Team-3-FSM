import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
      // Guarda global (C1-C4 del informe de auditoria): ninguna query devuelve
      // los hashes de password, ni a nivel raiz ni anidados en un `include`.
      // Se aplica aqui y no query por query porque la fuga original nacio de
      // cuatro consultas distintas que retornaban la entidad completa a un
      // controller; centralizarlo lo vuelve fail-closed, y cualquier consulta
      // nueva queda cubierta sin que nadie tenga que acordarse del `omit`.
      //
      // Quien realmente necesite el hash debe pedirlo explicitamente con
      // `omit: { <campo>: false }`. Hoy el unico caso es AuthService.login, que
      // compara el hash con bcrypt y no lo incluye en la respuesta.
      omit: {
        usuario: { password_hash: true },
        cliente: { password_portal_hash: true },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
