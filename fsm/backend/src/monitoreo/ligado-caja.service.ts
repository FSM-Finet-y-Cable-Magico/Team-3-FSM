import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  emparejar,
  referenciaDeCajaEnTexto,
  RADIO_DEFECTO_M,
  type StatsLigado,
} from './ligado-caja.js';

export interface ResumenLigado extends StatsLigado {
  ligadas: number;
  ya_ligadas: number;
  radio_m: number;
  ms: number;
}

/**
 * Resuelve `registro_ont.id_caja_nap` cruzando el nombre de caja que trae la
 * fuente contra las cajas importadas del KML. Ver `ligado-caja.ts` para el
 * porqué del algoritmo.
 *
 * Idempotente y no destructivo: solo toca las ONT que todavía no tienen caja,
 * así nunca pisa un enlace que vino de `unidad_equipo` (que es la fuente
 * autoritativa cuando existe, ver `RegistroOntService.enriquecer`).
 */
@Injectable()
export class LigadoCajaService {
  private readonly logger = new Logger(LigadoCajaService.name);

  constructor(private prisma: PrismaService) {}

  async ligarCajas(id_empresa: number, radioM = RADIO_DEFECTO_M): Promise<ResumenLigado> {
    const t0 = Date.now();

    // Solo cajas de la empresa (o sin empresa asignada, mismo criterio que
    // `PlantaExternaService.listarCajas`): el aislamiento del ligado sale de
    // acá, porque `registro_ont` no tiene `id_empresa` propio todavía.
    const cajas = await this.prisma.caja_nap.findMany({
      where: { OR: [{ id_empresa }, { id_empresa: null }] },
      select: { id_caja_nap: true, identificador_unico: true, latitud: true, longitud: true },
    });

    // Se cargan TODAS, no solo las pendientes: las ya ligadas son evidencia
    // fija para la votación del grupo PON (ver `OntParaLigar.id_caja_nap`).
    const filas = await this.prisma.registro_ont.findMany({
      select: {
        numero_serie: true,
        odb: true,
        direccion_cliente_ext: true,
        olt_externo: true,
        board: true,
        puerto_pon: true,
        id_caja_nap: true,
      },
    });

    // Cuando el campo de caja viene vacío, se intenta rescatar la referencia
    // desde la dirección: una parte de los instaladores la anota ahí.
    const todas = filas.map((f) => ({
      ...f,
      odb: f.odb && f.odb.trim() !== '' ? f.odb : referenciaDeCajaEnTexto(f.direccion_cliente_ext),
    }));

    const ya_ligadas = todas.filter((o) => o.id_caja_nap != null).length;

    const { asignaciones, stats } = emparejar(
      todas,
      cajas.map((c) => ({
        id_caja_nap: c.id_caja_nap,
        identificador_unico: c.identificador_unico,
        lat: c.latitud == null ? null : Number(c.latitud),
        lon: c.longitud == null ? null : Number(c.longitud),
      })),
      radioM,
    );

    // Una sola sentencia por caja destino en vez de una por ONT: son ~700
    // updates que se agrupan en unas pocas decenas de `updateMany`.
    const porCaja = new Map<number, string[]>();
    for (const [sn, idCaja] of asignaciones) {
      const lista = porCaja.get(idCaja);
      if (lista) lista.push(sn);
      else porCaja.set(idCaja, [sn]);
    }

    await this.prisma.$transaction(
      [...porCaja].map(([id_caja_nap, sns]) =>
        this.prisma.registro_ont.updateMany({
          where: { numero_serie: { in: sns }, id_caja_nap: null },
          data: { id_caja_nap },
        }),
      ),
    );

    const resumen: ResumenLigado = {
      ...stats,
      ligadas: asignaciones.size,
      ya_ligadas,
      radio_m: radioM,
      ms: Date.now() - t0,
    };
    this.logger.log(
      `Ligado ONT→caja: ${resumen.ligadas} ligadas de ${resumen.ont_evaluadas} pendientes ` +
        `(${resumen.match_unico} por nombre único, ${resumen.resueltas_por_pon} por cercanía PON), ` +
        `${resumen.sin_caja_candidata} sin caja, ${resumen.ms}ms`,
    );
    return resumen;
  }
}
