import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ClientesModule } from './clientes/clientes.module.js';
import { OrdenesModule } from './ordenes/ordenes.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { MonitoreoModule } from './monitoreo/monitoreo.module.js';
import { PlantaExternaModule } from './planta-externa/planta-externa.module.js';
import { IntegracionesModule } from './integraciones/integraciones.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ClientesModule,
    OrdenesModule,
    DashboardModule,
    MonitoreoModule,
    PlantaExternaModule,
    IntegracionesModule,
  ],
  providers: [
    // Ambos guards son globales: todo endpoint nace exigiendo token y rol, y
    // las excepciones se declaran con @Public(). Antes la proteccion dependia
    // de que cada controller se acordara de poner @UseGuards, asi que un
    // controller nuevo nacia sin autenticacion ni autorizacion.
    //
    // EL ORDEN DE ESTOS DOS IMPORTA Y NO LO VERIFICA EL COMPILADOR.
    // Nest los ejecuta en el orden de este array. JwtAuthGuard tiene que ir
    // primero porque es el que valida el token y escribe request.user;
    // RolesGuard lee request.user.rol. Invertidos, RolesGuard corre con
    // request.user todavia undefined y responde 403 a todo, siempre.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
