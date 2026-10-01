import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Cuantas lecturas se conservan por ONT. Con el dedupe de la ingesta, una ONT
 * escribe ~16 filas al dia, asi que 200 son casi dos semanas de cambios
 * reales. No hay ningun caso de uso que pida mas: monitoreo_ont se lee en dos
 * sitios y los dos toman DISTINCT ON por ONT, o sea la ultima fila y nada mas.
 * El historial de 30 y 90 dias del CU-14 sale de historial_conexion_ont, que
 * la purga no toca.
 */
export const CONSERVAR_POR_ONT_POR_DEFECTO = 200;

/** Filas por sentencia. Acota el bloqueo en una tabla que se escribe cada 5 min. */
const TAMANO_LOTE = 10_000;

/** Tope de lotes por corrida, para que una purga no se quede dando vueltas. */
const MAX_LOTES = 200;

export interface ResumenPurga {
  aplicado: boolean;
  conservar_por_ont: number;
  filas_antes: number;
  /** Lo que sobra del tope. En seco es lo que se borraria. */
  filas_sobrantes: number;
  filas_borradas: number;
  lotes: number;
  /** true si se agoto MAX_LOTES y quedaron filas: la proxima corrida sigue. */
  incompleta: boolean;
  ms: number;
}

/**
 * Acota monitoreo_ont a las ultimas N lecturas por ONT.
 *
 * Es la tabla que llenó el disco y dejó produccion caida nueve dias. El
 * arreglo de fondo es el dedupe de la ingesta --que evita el 92% de las
 * escrituras-- y esto es el tope de arriba, para que el crecimiento quede
 * acotado de verdad y no solo mas lento.
 *
 * NO borra por `timestamp_medicion`. Es una trampa: esa columna guarda el
 * last_status_change de SmartOLT, no la hora de lectura, asi que en el
 * respaldo del 29-09 habia filas fechadas en marzo de 2024 que eran la lectura
 * VIGENTE de las ONT mas estables. Un `delete where timestamp_medicion <
 * now() - 7 days` habria borrado justo las filas que el sistema necesita. Se
 * ordena por `id_monitoreo`, que es autoincremental y si refleja el orden real
 * de escritura.
 */
@Injectable()
export class PurgaMonitoreoService {
  private readonly logger = new Logger(PurgaMonitoreoService.name);

  constructor(private prisma: PrismaService) {}

  async purgar(
    opciones: { aplicar?: boolean; conservarPorOnt?: number } = {},
  ): Promise<ResumenPurga> {
    const t0 = Date.now();
    const aplicar = opciones.aplicar === true;
    const conservar = Math.max(
      1,
      Math.trunc(opciones.conservarPorOnt ?? CONSERVAR_POR_ONT_POR_DEFECTO),
    );

    const [{ filas_antes, filas_sobrantes }] = await this.prisma.$queryRaw<
      { filas_antes: bigint; filas_sobrantes: bigint }[]
    >`
      WITH pos AS (
        SELECT row_number() OVER (PARTITION BY id_registro_ont ORDER BY id_monitoreo DESC) AS p
          FROM monitoreo_ont
      )
      SELECT count(*) AS filas_antes,
             count(*) FILTER (WHERE p > ${conservar}) AS filas_sobrantes
        FROM pos
    `;

    const resumen: ResumenPurga = {
      aplicado: aplicar,
      conservar_por_ont: conservar,
      filas_antes: Number(filas_antes),
      filas_sobrantes: Number(filas_sobrantes),
      filas_borradas: 0,
      lotes: 0,
      incompleta: false,
      ms: 0,
    };

    if (!aplicar || resumen.filas_sobrantes === 0) {
      resumen.ms = Date.now() - t0;
      this.logger.log(
        `Purga${aplicar ? '' : ' (en seco)'}: ${resumen.filas_antes} filas, ` +
          `${resumen.filas_sobrantes} sobre el tope de ${conservar} por ONT`,
      );
      return resumen;
    }

    // Por lotes y no en una sentencia: la primera corrida en produccion tiene
    // que sacar ~364.000 filas de una tabla en la que el poller escribe cada
    // 5 minutos.
    for (let lote = 0; lote < MAX_LOTES; lote++) {
      const borradas = await this.prisma.$executeRaw`
        DELETE FROM monitoreo_ont
         WHERE id_monitoreo IN (
           SELECT id_monitoreo FROM (
             SELECT id_monitoreo,
                    row_number() OVER (PARTITION BY id_registro_ont ORDER BY id_monitoreo DESC) AS p
               FROM monitoreo_ont
           ) t
           WHERE t.p > ${conservar}
           LIMIT ${TAMANO_LOTE}
         )
      `;
      if (borradas === 0) break;
      resumen.filas_borradas += borradas;
      resumen.lotes = lote + 1;
      if (lote === MAX_LOTES - 1) resumen.incompleta = true;
    }

    resumen.ms = Date.now() - t0;
    this.logger.log(
      `Purga aplicada: ${resumen.filas_borradas} filas borradas en ${resumen.lotes} lote(s), ` +
        `tope ${conservar} por ONT, ${resumen.ms}ms` +
        (resumen.incompleta ? ' — quedaron filas' : ''),
    );
    return resumen;
  }
}
