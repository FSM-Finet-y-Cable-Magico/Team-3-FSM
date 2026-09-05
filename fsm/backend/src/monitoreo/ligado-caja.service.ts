import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  emparejar,
  normalizarNombreCaja,
  referenciaDeCajaEnTexto,
  RADIO_DEFECTO_M,
  type StatsLigado,
} from './ligado-caja.js';

export interface ResumenLigado extends StatsLigado {
  ligadas: number;
  ya_ligadas: number;
  /** Verificadas en terreno como "sin caja del mapa"; quedan fuera del algoritmo. */
  confirmadas_sin_caja: number;
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

  /**
   * Registra la caja de una ONT confirmada por una persona (CU-20: el técnico
   * la confirma al cerrar la OT).
   *
   * A diferencia del ligado automático, esto es un dato SABIDO, no deducido:
   * queda marcado con quién y cuándo, y el proceso automático no lo vuelve a
   * tocar.
   *
   * Se propaga al resto del grupo PON con el mismo nombre de caja, porque es
   * la misma caja física: si el técnico confirma que el cliente X cuelga de la
   * NAP 7 del puerto 2/1/3, sus vecinos de ese puerto y esa caja también. Sin
   * propagar, además, la caja quedaría "tomada" y sus compañeros no podrían
   * ligarse a ninguna.
   *
   * `id_caja_nap = null` es válido y significa "verifiqué que no cuelga de
   * ninguna caja del mapa" (instalaciones dentro de edificios, por ejemplo).
   */
  async confirmarCaja(
    numero_serie: string,
    id_caja_nap: number | null,
    id_usuario: number,
    id_empresa: number,
    propagar = true,
  ) {
    const ont = await this.prisma.registro_ont.findFirst({
      where: { numero_serie, id_empresa },
    });
    if (!ont) throw new NotFoundException(`ONT ${numero_serie} no encontrada`);

    if (id_caja_nap != null) {
      const caja = await this.prisma.caja_nap.findFirst({
        where: { id_caja_nap, OR: [{ id_empresa }, { id_empresa: null }] },
      });
      if (!caja) throw new NotFoundException(`Caja ${id_caja_nap} no encontrada`);
    }

    const ahora = new Date();
    const marca = {
      id_caja_nap,
      caja_confirmada_por: id_usuario,
      caja_confirmada_en: ahora,
    };

    const hermanas =
      propagar && ont.odb
        ? await this.prisma.registro_ont.findMany({
            where: {
              id_empresa,
              olt_externo: ont.olt_externo,
              board: ont.board,
              puerto_pon: ont.puerto_pon,
              numero_serie: { not: numero_serie },
              // Nunca se pisa lo que ya confirmó otra persona.
              caja_confirmada_por: null,
            },
            select: { numero_serie: true, odb: true },
          })
        : [];

    // El nombre se compara normalizado: en la fuente conviven "NAP06" y "NAP 6".
    const clave = normalizarNombreCaja(ont.odb);
    const propagadas = hermanas
      .filter((h) => clave != null && normalizarNombreCaja(h.odb) === clave)
      .map((h) => h.numero_serie);

    await this.prisma.$transaction([
      this.prisma.registro_ont.update({ where: { numero_serie }, data: marca }),
      ...(propagadas.length
        ? [
            this.prisma.registro_ont.updateMany({
              where: { numero_serie: { in: propagadas } },
              data: marca,
            }),
          ]
        : []),
    ]);

    this.logger.log(
      `Caja confirmada por usuario ${id_usuario}: ${numero_serie} -> ` +
        `${id_caja_nap ?? 'sin caja'} (+${propagadas.length} del mismo grupo)`,
    );
    return { numero_serie, id_caja_nap, propagadas: propagadas.length, confirmada_en: ahora };
  }

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
        caja_confirmada_por: true,
      },
    });

    // Las confirmadas en terreno quedan fuera del algoritmo. Las que tienen
    // caja ya entran como evidencia fija por su `id_caja_nap`; las confirmadas
    // SIN caja ("verifiqué que no cuelga de ninguna") hay que excluirlas a
    // mano, porque si no el algoritmo les buscaría una y bloquearía esa caja
    // para el grupo que sí la necesita.
    const confirmadasSinCaja = filas.filter(
      (f) => f.caja_confirmada_por != null && f.id_caja_nap == null,
    ).length;

    // Cuando el campo de caja viene vacío, se intenta rescatar la referencia
    // desde la dirección: una parte de los instaladores la anota ahí.
    const todas = filas
      .filter((f) => !(f.caja_confirmada_por != null && f.id_caja_nap == null))
      .map((f) => ({
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
          // `caja_confirmada_por: null` protege lo verificado por una persona,
          // incluido un "verifiqué que no tiene caja" (id_caja_nap null).
          where: { numero_serie: { in: sns }, id_caja_nap: null, caja_confirmada_por: null },
          data: { id_caja_nap },
        }),
      ),
    );

    const resumen: ResumenLigado = {
      ...stats,
      ligadas: asignaciones.size,
      ya_ligadas,
      confirmadas_sin_caja: confirmadasSinCaja,
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
