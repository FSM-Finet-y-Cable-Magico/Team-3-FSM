import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { FUENTE_MONITOREO, type FuenteMonitoreo } from './fuente/fuente-monitoreo.js';

export interface ResumenDescubrimiento {
  olts_creados: number;
  olts_actualizados: number;
  cajas_nap_creadas: number;
  cajas_nap_actualizadas: number;
  ont_sin_odb: number;
}

/**
 * Sincroniza la topología que expone la fuente (OLTs y cajas NAP) hacia las
 * tablas locales `olt` y `caja_nap`.
 *
 * SmartOLT ES la fuente de topología: no hace falta que FiNet entregue un
 * inventario aparte. Del censo de ONTs salen OLT → zona/ODB → caja NAP.
 *
 * APAGADO por defecto (`MONITOREO_TOPOLOGIA_ENABLED=false`). Escribe en tablas
 * que en el reparto quedan de G3, pero el vínculo ONT→unidad_equipo→cliente
 * toca a G1 y G8: no lo activamos hasta que la reunión defina de quién es el
 * registro de ONT. Mientras tanto la ingesta de lecturas funciona igual, con
 * los enlaces en null.
 */
@Injectable()
export class DescubrimientoService {
  private readonly logger = new Logger(DescubrimientoService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Inject(FUENTE_MONITOREO) private fuente: FuenteMonitoreo,
  ) {}

  async sincronizarTopologia(): Promise<ResumenDescubrimiento> {
    if (this.config.get<string>('MONITOREO_TOPOLOGIA_ENABLED') !== 'true') {
      throw new ForbiddenException(
        'Sincronización de topología deshabilitada. Pendiente del acuerdo de ' +
          'propiedad de la topología / registro de ONT con G1 y G8 (ver reunión de integración).',
      );
    }

    const r: ResumenDescubrimiento = {
      olts_creados: 0,
      olts_actualizados: 0,
      cajas_nap_creadas: 0,
      cajas_nap_actualizadas: 0,
      ont_sin_odb: 0,
    };

    // ---- OLTs ----
    for (const o of await this.fuente.listarOlts()) {
      if (!o.nombre) continue;
      const existente = await this.prisma.olt.findFirst({ where: { nombre: o.nombre } });
      if (existente) {
        await this.prisma.olt.update({
          where: { id_olt: existente.id_olt },
          data: { ip_gestion: o.ip_gestion, ubicacion: o.ubicacion },
        });
        r.olts_actualizados++;
      } else {
        await this.prisma.olt.create({
          data: { nombre: o.nombre, ip_gestion: o.ip_gestion, ubicacion: o.ubicacion },
        });
        r.olts_creados++;
      }
    }

    // ---- Cajas NAP (de los ODB del censo de ONTs) ----
    const detalles = await this.fuente.listarOntDetalles();
    const odbs = new Map<string, string | null>(); // identificador_unico -> zona
    for (const d of detalles) {
      if (!d.odb) {
        r.ont_sin_odb++;
        continue;
      }
      if (!odbs.has(d.odb)) odbs.set(d.odb, d.zona);
    }

    for (const [identificador_unico, zona] of odbs) {
      const existente = await this.prisma.caja_nap.findUnique({ where: { identificador_unico } });
      if (existente) {
        await this.prisma.caja_nap.update({
          where: { id_caja_nap: existente.id_caja_nap },
          data: { zona },
        });
        r.cajas_nap_actualizadas++;
      } else {
        await this.prisma.caja_nap.create({ data: { identificador_unico, zona } });
        r.cajas_nap_creadas++;
      }
    }

    this.logger.log(
      `Topología sincronizada: OLT +${r.olts_creados}/~${r.olts_actualizados}, ` +
        `NAP +${r.cajas_nap_creadas}/~${r.cajas_nap_actualizadas}`,
    );
    return r;
  }
}
