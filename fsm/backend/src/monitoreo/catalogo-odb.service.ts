import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { FUENTE_MONITOREO, type FuenteMonitoreo } from './fuente/fuente-monitoreo.js';

/** Cada cuanto se vuelve a pedir el catalogo de cajas a la fuente. */
export const VIGENCIA_CATALOGO_MS = 24 * 3_600_000;

export interface ResumenCatalogo {
  /** False si la fuente no expone catalogo (CSV, mock). */
  disponible: boolean;
  /** Cajas que trajo la fuente y se guardaron. */
  cajas: number;
}

/**
 * Copia local del catalogo de cajas de SmartOLT (`odb_smartolt`).
 *
 * Existe por la capacidad: `nr_of_ports` no viene en el censo de ONT, y la
 * grilla de puertos la necesita cada vez que alguien abre una caja. Pedirla
 * en ese momento gastaria la cuota de la API, compartida con los otros
 * grupos; con la copia basta una llamada al dia.
 *
 * El catalogo es de la empresa duena de las credenciales de la fuente
 * (`idEmpresaFuente`), nunca de quien pida el refresco: si un ADMIN de otra
 * empresa lo dispara, igual se guarda donde corresponde.
 */
@Injectable()
export class CatalogoOdbService {
  private readonly logger = new Logger(CatalogoOdbService.name);

  constructor(
    private prisma: PrismaService,
    private registro: RegistroOntService,
    @Inject(FUENTE_MONITOREO) private fuente: FuenteMonitoreo,
  ) {}

  async refrescar(): Promise<ResumenCatalogo> {
    if (!this.fuente.listarOdbs) return { disponible: false, cajas: 0 };

    const id_empresa = this.registro.idEmpresaFuente;
    const odbs = (await this.fuente.listarOdbs()).filter((o) => o.id_externo && o.nombre);
    const ahora = new Date();

    await this.prisma.$transaction(
      odbs.map((o) =>
        this.prisma.odb_smartolt.upsert({
          where: { id_empresa_id_externo: { id_empresa, id_externo: o.id_externo } },
          create: {
            id_empresa,
            id_externo: o.id_externo,
            nombre: o.nombre,
            capacidad: o.capacidad,
            zona: o.zona,
            actualizado_en: ahora,
          },
          update: { nombre: o.nombre, capacidad: o.capacidad, zona: o.zona, actualizado_en: ahora },
        }),
      ),
    );

    this.logger.log(`Catalogo de cajas: ${odbs.length} cajas guardadas`);
    return { disponible: true, cajas: odbs.length };
  }

  /**
   * Refresca solo si el ultimo refresco tiene mas de `VIGENCIA_CATALOGO_MS`.
   * Lo llama el sondeo en cada tick. NUNCA lanza: un catalogo viejo es mejor
   * que un sondeo cortado.
   *
   * @returns true si refresco.
   */
  async refrescarSiVencido(ahora = new Date()): Promise<boolean> {
    if (!this.fuente.listarOdbs) return false;
    try {
      const ultimo = await this.prisma.odb_smartolt.findFirst({
        where: { id_empresa: this.registro.idEmpresaFuente },
        orderBy: { actualizado_en: 'desc' },
        select: { actualizado_en: true },
      });
      if (ultimo && ahora.getTime() - ultimo.actualizado_en.getTime() < VIGENCIA_CATALOGO_MS) {
        return false;
      }
      await this.refrescar();
      return true;
    } catch (e) {
      this.logger.error(`No se pudo refrescar el catalogo de cajas: ${(e as Error).message}`);
      return false;
    }
  }
}
