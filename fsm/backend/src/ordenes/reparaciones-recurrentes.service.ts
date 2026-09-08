import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** RF-08: reparaciones completadas a partir de las cuales se alerta. */
export const UMBRAL_REPARACIONES_RECURRENTES = 3;

/** Ventana, en dias corridos, sobre la que se cuenta. */
export const DIAS_VENTANA_RECURRENCIA = 30;

export interface OtRecurrente {
  id_ot: number;
  fecha_completada: Date | null;
  categoria_falla: string | null;
}

export interface ReparacionesRecurrentes {
  activa: boolean;
  total_reparaciones_30_dias: number;
  desde: Date;
  hasta: Date;
  /** El RF pide "la lista de OT asociadas", no solo el total. */
  ots: OtRecurrente[];
}

/**
 * Regla de RF-08: "3 o mas OT de tipo REPARACION **cerradas** en 30 dias
 * corridos".
 *
 * Vive sola y la usan los dos consumidores --el cierre de OT y la ficha del
 * cliente-- porque antes estaba escrita dos veces, en `ordenes.service` y en
 * `clientes.service`, con el mismo error copiado en las dos. Dos copias de una
 * regla de negocio terminan divergiendo: alcanza con que alguien arregle una.
 *
 * Lo que contaba la version anterior, y por que estaba mal:
 *
 *   estado: { not: 'CANCELADA' }   -> incluia PENDIENTE, ASIGNADA y EN_CURSO,
 *                                     o sea reparaciones que NO estan cerradas.
 *   fecha_creacion: { gte: desde } -> anclaba en la creacion y no en el cierre:
 *                                     una OT creada hace 40 dias y cerrada
 *                                     ayer no contaba, y una creada hace 29 y
 *                                     todavia abierta si.
 *
 * Sobre los datos reales de FiNet eso daba 7 donde el RF cuenta 4.
 */
@Injectable()
export class ReparacionesRecurrentesService {
  constructor(private prisma: PrismaService) {}

  /**
   * @param hasta Momento de evaluacion. La ventana es `[hasta - 30 dias, hasta]`.
   *
   * El tope superior no es decorativo: sin el, una evaluacion historica --la que
   * necesita CU-60 para recorrer un periodo pasado-- contaria tambien las
   * reparaciones cerradas DESPUES del momento evaluado, y diria que el cliente
   * ya era recurrente en una fecha en la que todavia no lo era.
   */
  async evaluar(
    id_cliente: number,
    id_empresa: number,
    hasta: Date = new Date(),
  ): Promise<ReparacionesRecurrentes> {
    // `setDate` da "la misma hora, 30 dias antes", no "hace 720 horas". Es la
    // diferencia entre dias de calendario y dias de 24 h, y en Chile importa:
    // una ventana que cruza el cambio de hora dura 719 o 721 horas. El RF dice
    // "30 dias corridos", que es calendario.
    const desde = new Date(hasta);
    desde.setDate(desde.getDate() - DIAS_VENTANA_RECURRENCIA);

    const ots = await this.prisma.orden_trabajo.findMany({
      where: {
        id_cliente,
        id_empresa,
        tipo_ot: 'REPARACION',
        // "Cerrada" es COMPLETADA. Una reparacion cancelada no es una
        // reparacion hecha, asi que no cuenta.
        estado: 'COMPLETADA',
        fecha_completada: { gte: desde, lte: hasta },
      },
      orderBy: { fecha_completada: 'desc' },
      select: {
        id_ot: true,
        fecha_completada: true,
        categoria_falla: { select: { nombre: true } },
      },
    });

    return {
      activa: ots.length >= UMBRAL_REPARACIONES_RECURRENTES,
      total_reparaciones_30_dias: ots.length,
      desde,
      hasta,
      ots: ots.map((o) => ({
        id_ot: o.id_ot,
        fecha_completada: o.fecha_completada,
        categoria_falla: o.categoria_falla?.nombre ?? null,
      })),
    };
  }
}
