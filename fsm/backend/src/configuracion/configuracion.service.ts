import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  UMBRAL_DESCONEXION_MAX,
  UMBRAL_DESCONEXION_MIN,
  UMBRAL_DESCONEXION_MIN_DEFECTO,
} from '../monitoreo/monitoreo.constants.js';
import type { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto.js';

/**
 * RF-46: "El valor de N es configurable por el administrador en un rango de 10
 * a 120 minutos".
 *
 * El motor de alertas ya LEIA `empresa.umbral_desconexion_min` y caia al valor
 * por defecto si estaba en null, pero no habia forma de escribirlo: ni endpoint
 * ni pantalla. El administrador solo podia cambiarlo con SQL directo, o sea que
 * en la practica el RF no estaba cumplido.
 */
@Injectable()
export class ConfiguracionService {
  constructor(private prisma: PrismaService) {}

  async obtener(id_empresa: number) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id_empresa },
      select: { id_empresa: true, nombre: true, umbral_desconexion_min: true },
    });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    return {
      id_empresa: empresa.id_empresa,
      nombre: empresa.nombre,
      /** null = la empresa no configuro ninguno y rige el del sistema. */
      umbral_desconexion_min: empresa.umbral_desconexion_min,
      /** Lo que se aplica hoy de verdad, ya resuelto el null. */
      umbral_vigente: empresa.umbral_desconexion_min ?? UMBRAL_DESCONEXION_MIN_DEFECTO,
      umbral_por_defecto: UMBRAL_DESCONEXION_MIN_DEFECTO,
      // Se publican para que la Vista no vuelva a escribir el rango a mano.
      umbral_min: UMBRAL_DESCONEXION_MIN,
      umbral_max: UMBRAL_DESCONEXION_MAX,
    };
  }

  async actualizar(id_empresa: number, dto: ActualizarConfiguracionDto) {
    // El rango lo valida el DTO. Aca solo se comprueba que la empresa exista,
    // para no crear una fila fantasma con un update a ciegas.
    const existe = await this.prisma.empresa.findUnique({
      where: { id_empresa },
      select: { id_empresa: true },
    });
    if (!existe) throw new NotFoundException('Empresa no encontrada');

    if (dto.umbral_desconexion_min !== undefined) {
      await this.prisma.empresa.update({
        where: { id_empresa },
        data: { umbral_desconexion_min: dto.umbral_desconexion_min },
      });
    }

    return this.obtener(id_empresa);
  }
}
