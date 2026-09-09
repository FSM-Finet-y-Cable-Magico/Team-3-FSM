import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** RF-09: dias sin reagendar a partir de los cuales se alerta. */
export const DIAS_ALERTA_SIN_REAGENDAR = 30;

/** El estado que RF-09 llama "sin reagendarse". */
export const ESTADO_SIN_REAGENDAR = 'PENDIENTE_CLIENTE_AUSENTE';

/**
 * RF-09: "alertando cuando lleven mas de 30 dias sin reagendarse".
 *
 * "Mas de 30" es estricto, como fija el documento del equipo: a los 30 dias
 * justos todavia no se alerta.
 */
export function superaElUmbral(dias: number): boolean {
  return dias > DIAS_ALERTA_SIN_REAGENDAR;
}

/**
 * Regla de RF-09, en un solo lugar.
 *
 * La antiguedad NO se mide desde `fecha_creacion`. El RF habla de dias "sin
 * reagendarse", y una OT creada hace 60 dias que el tecnico marco ausente ayer
 * lleva un dia sin reagendar, no sesenta. El instante correcto es la ultima vez
 * que entro al estado, que queda registrada en `historial_ot`.
 *
 * Si por lo que sea no hay historial --datos migrados, una OT sembrada
 * directamente en la base-- se cae a `fecha_creacion`, que es lo unico que
 * queda, y es lo que se mostraba antes para todas.
 */
@Injectable()
export class SinReagendarService {
  constructor(private prisma: PrismaService) {}

  /**
   * Momento en que cada OT entro por ultima vez al estado. Una sola consulta
   * para todas las OT que se le pasen, no una por OT.
   */
  async marcasDeEntrada(idsOt: number[]): Promise<Map<number, Date>> {
    if (idsOt.length === 0) return new Map();

    const filas = await this.prisma.historial_ot.groupBy({
      by: ['id_ot'],
      where: { id_ot: { in: idsOt }, estado_nuevo: ESTADO_SIN_REAGENDAR },
      _max: { fecha_hora: true },
    });

    const marcas = new Map<number, Date>();
    for (const f of filas) {
      if (f.id_ot != null && f._max.fecha_hora) marcas.set(f.id_ot, f._max.fecha_hora);
    }
    return marcas;
  }

  /** Dias corridos desde `desde` hasta `ahora`, nunca negativo. */
  dias(desde: Date, ahora: Date = new Date()): number {
    return Math.max(0, Math.floor((ahora.getTime() - new Date(desde).getTime()) / 86_400_000));
  }

  /**
   * Cuantas OT de la empresa llevan mas de 30 dias sin reagendarse.
   * Es el indicador que pide RF-37, calculado con la misma regla que usa el
   * listado de RF-09 para no abrir una segunda version del criterio.
   */
  async contarVencidas(id_empresa: number, ahora: Date = new Date()): Promise<number> {
    const ots = await this.prisma.orden_trabajo.findMany({
      where: { id_empresa, estado: ESTADO_SIN_REAGENDAR },
      select: { id_ot: true, fecha_creacion: true },
    });
    if (ots.length === 0) return 0;

    const marcas = await this.marcasDeEntrada(ots.map((o) => o.id_ot));
    return ots.filter((o) =>
      superaElUmbral(this.dias(marcas.get(o.id_ot) ?? o.fecha_creacion, ahora)),
    ).length;
  }
}
