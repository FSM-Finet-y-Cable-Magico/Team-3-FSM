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
  /**
   * Cajas que recibieron zona derivada de sus ONT (ver `derivarZonas`).
   *
   * Baja en cada corrida hasta llegar a 0, por lo mismo que `ligadas`: ver la
   * nota sobre convergencia en `ligarCajas`.
   */
  zonas_derivadas: number;
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

  /**
   * ES CONVERGENTE, NO IDEMPOTENTE, y conviene saberlo antes de asustarse.
   *
   * Cada corrida usa los enlaces YA existentes como evidencia fija para la
   * votacion del grupo PON, asi que una segunda pasada resuelve casos que la
   * primera no podia. Sobre los datos reales de FiNet:
   *
   *   corrida 1 -> 710 ONT ligadas, 252 zonas derivadas
   *   corrida 2 ->  18 ONT ligadas,  10 zonas
   *   corrida 3 ->   0             ,   0     <- converge
   *
   * O sea que correrlo dos veces seguidas SI cambia datos la segunda vez, y
   * eso es correcto. Lo que nunca hace es deshacer: solo toca ONT sin caja y
   * cajas sin zona, y respeta lo confirmado en terreno.
   *
   * Conviene correrlo dos veces tras una carga nueva de topologia.
   */
  async ligarCajas(id_empresa: number, radioM = RADIO_DEFECTO_M): Promise<ResumenLigado> {
    const t0 = Date.now();

    // Solo cajas de la empresa (o sin empresa asignada, mismo criterio que
    // `PlantaExternaService.listarCajas`).
    const cajas = await this.prisma.caja_nap.findMany({
      where: { OR: [{ id_empresa }, { id_empresa: null }] },
      select: { id_caja_nap: true, identificador_unico: true, latitud: true, longitud: true },
    });

    // Se cargan TODAS, no solo las pendientes: las ya ligadas son evidencia
    // fija para la votación del grupo PON (ver `OntParaLigar.id_caja_nap`).
    const filas = await this.prisma.registro_ont.findMany({
      // Las cajas ya venian filtradas por empresa, pero las ONT no: sin este
      // filtro el algoritmo podia ligar una ONT de la otra empresa a una caja
      // de esta (escribiendole un id_caja_nap ajeno) y, peor, esa ONT tomaba
      // la caja por exclusividad y se la quitaba a la que si correspondia.
      where: { id_empresa },
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

    // Va despues del ligado y no antes: la zona se deduce de las ONT que
    // cuelgan de cada caja, asi que necesita los enlaces recien escritos.
    const zonas_derivadas = await this.derivarZonas(id_empresa);

    const resumen: ResumenLigado = {
      ...stats,
      ligadas: asignaciones.size,
      ya_ligadas,
      confirmadas_sin_caja: confirmadasSinCaja,
      zonas_derivadas,
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

  /**
   * Rellena `caja_nap.zona` a partir de las ONT que cuelgan de cada caja.
   *
   * El KML de Tomodat no trae la zona, asi que las 911 cajas importadas la
   * tienen en NULL: el filtro por zona de la pantalla de topologia quedaba
   * vacio y las alertas no se podian acotar geograficamente. SmartOLT si la
   * trae, en `registro_ont.zona`, y el ligado ya dice que ONT va en que caja
   * -- o sea que el dato existe, solo estaba en la otra punta del enlace.
   *
   * Cuando una caja tiene ONT de varias zonas (10 de 254 sobre los datos
   * reales de FiNet) gana la mas repetida. Es el mismo criterio de votacion
   * que usa `emparejar` para resolver el grupo PON: ante datos sucios, manda
   * la mayoria, no la primera fila que aparece.
   *
   * NO pisa una zona ya escrita: si alguien la corrigio a mano desde CU-19,
   * esa correccion vale mas que la deduccion.
   */
  private async derivarZonas(id_empresa: number): Promise<number> {
    const filas = await this.prisma.registro_ont.findMany({
      where: { id_empresa, id_caja_nap: { not: null }, zona: { not: null } },
      select: { id_caja_nap: true, zona: true },
    });
    if (filas.length === 0) return 0;

    // id_caja_nap -> zona -> cuantas ONT la respaldan
    const votos = new Map<number, Map<string, number>>();
    for (const f of filas) {
      const porCaja = votos.get(f.id_caja_nap!) ?? new Map<string, number>();
      porCaja.set(f.zona!, (porCaja.get(f.zona!) ?? 0) + 1);
      votos.set(f.id_caja_nap!, porCaja);
    }

    const sinZona = await this.prisma.caja_nap.findMany({
      where: { id_caja_nap: { in: [...votos.keys()] }, zona: null },
      select: { id_caja_nap: true },
    });

    // Una sentencia por zona en vez de una por caja: son pocas zonas y muchas
    // cajas, igual que el agrupado de `ligarCajas`.
    const porZona = new Map<string, number[]>();
    for (const { id_caja_nap } of sinZona) {
      const ganadora = [...votos.get(id_caja_nap)!].sort((a, b) => b[1] - a[1])[0][0];
      const lista = porZona.get(ganadora);
      if (lista) lista.push(id_caja_nap);
      else porZona.set(ganadora, [id_caja_nap]);
    }
    if (porZona.size === 0) return 0;

    await this.prisma.$transaction(
      [...porZona].map(([zona, ids]) =>
        this.prisma.caja_nap.updateMany({
          where: { id_caja_nap: { in: ids }, zona: null },
          data: { zona },
        }),
      ),
    );

    this.logger.log(`Zona derivada para ${sinZona.length} cajas desde sus ONT`);
    return sinZona.length;
  }
}
