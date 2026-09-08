import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';

// BigInt fields (e.g. historial_ot.id_historial_ot) must be serializable
(BigInt.prototype as unknown as Record<string, unknown>).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
    // Sin esto el navegador NO deja leer `Content-Disposition` desde fetch, y la
    // descarga de un reporte pierde el nombre que fija CU-46
    // (`Reporte_FSM_FiNet_2026-04.xlsx`): el archivo cae como "reporte.xlsx".
    // Es solo de lectura de una cabecera que ya se manda; no abre nada nuevo.
    exposedHeaders: ['Content-Disposition'],
  });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('FSM API')
    .setDescription('Sistema de Gestión de Instalaciones y Monitoreo Técnico')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
