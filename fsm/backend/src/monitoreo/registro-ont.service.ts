import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { OntDetalle } from './fuente/fuente-monitoreo.js';

export interface RegistroResuelto {
  id_registro_ont: number;
  id_unidad: number | null;
  id_cliente: number | null;
  id_caja_nap: number | null;
}

/**
 * Mantiene la tabla `registro_ont`: una fila por ONT vista en la fuente,
 * identificada por su número de serie.
 *
 * Es lo que le da identidad a una ONT antes de que exista como `unidad_equipo`
 * (G1) o esté ligada a un `cliente` (G8). Cuando esos enlaces se puedan
 * resolver (cruce por `numero_serie` contra `unidad_equipo`), se completan acá.
 */
@Injectable()
export class RegistroOntService {
  private readonly logger = new Logger(RegistroOntService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Garantiza una fila de `registro_ont` por cada SN. Crea las que falten (con
   * lo mínimo), y devuelve el mapa SN → ids resueltos.
   */
  async asegurarRegistros(sns: string[]): Promise<Map<string, RegistroResuelto>> {
    const mapa = new Map<string, RegistroResuelto>();
    if (sns.length === 0) return mapa;

    const existentes = await this.prisma.registro_ont.findMany({
      where: { numero_serie: { in: sns } },
    });
    const porSn = new Map(existentes.map((r) => [r.numero_serie, r]));

    const faltantes = sns.filter((sn) => !porSn.has(sn));
    for (const sn of faltantes) {
      const creada = await this.prisma.registro_ont.create({ data: { numero_serie: sn } });
      porSn.set(sn, creada);
    }
    if (faltantes.length) {
      this.logger.log(`registro_ont: ${faltantes.length} ONT nuevas`);
    }

    for (const [sn, r] of porSn) {
      mapa.set(sn, {
        id_registro_ont: r.id_registro_ont,
        id_unidad: r.id_unidad,
        id_cliente: r.id_cliente,
        id_caja_nap: r.id_caja_nap,
      });
    }
    return mapa;
  }

  /**
   * Enriquece los registros con el censo de la fuente (topología, datos de
   * cliente externos) y con el cruce por `numero_serie` contra `unidad_equipo`
   * para resolver `id_unidad` / `id_cliente` / `id_caja_nap`.
   *
   * Barato de llamar: solo escribe si algo cambió. El poller lo corre de vez en
   * cuando, no en cada tick.
   */
  async enriquecer(detalles: OntDetalle[]): Promise<number> {
    if (detalles.length === 0) return 0;

    const sns = detalles.map((d) => d.sn);
    const unidades = await this.prisma.unidad_equipo.findMany({
      where: { numero_serie: { in: sns } },
      select: {
        numero_serie: true,
        id_unidad: true,
        id_cliente_instalado: true,
        id_caja_nap: true,
      },
    });
    const unidadPorSn = new Map(unidades.map((u) => [u.numero_serie, u]));

    let tocados = 0;
    for (const d of detalles) {
      const u = unidadPorSn.get(d.sn);
      await this.prisma.registro_ont.upsert({
        where: { numero_serie: d.sn },
        create: {
          numero_serie: d.sn,
          id_externo: d.id_externo,
          olt_externo: d.olt_externo,
          board: d.board,
          puerto_pon: d.puerto_pon,
          zona: d.zona,
          odb: d.odb,
          modelo: d.modelo,
          nombre_cliente_ext: d.nombre_cliente,
          direccion_cliente_ext: d.direccion_cliente,
          id_unidad: u?.id_unidad ?? null,
          id_cliente: u?.id_cliente_instalado ?? null,
          id_caja_nap: u?.id_caja_nap ?? null,
        },
        update: {
          id_externo: d.id_externo,
          olt_externo: d.olt_externo,
          board: d.board,
          puerto_pon: d.puerto_pon,
          zona: d.zona,
          odb: d.odb,
          modelo: d.modelo,
          nombre_cliente_ext: d.nombre_cliente,
          direccion_cliente_ext: d.direccion_cliente,
          ...(u
            ? {
                id_unidad: u.id_unidad,
                id_cliente: u.id_cliente_instalado ?? null,
                id_caja_nap: u.id_caja_nap ?? null,
              }
            : {}),
        },
      });
      tocados++;
    }
    this.logger.log(`registro_ont: ${tocados} enriquecidas desde el censo`);
    return tocados;
  }
}
