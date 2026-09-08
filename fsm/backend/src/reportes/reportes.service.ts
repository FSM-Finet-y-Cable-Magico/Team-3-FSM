import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';

export interface RangoReporte {
  desde: Date;
  /** Exclusivo: ver `rangoDeDia`. */
  hasta: Date;
}

export interface FiltrosReporte {
  id_tecnico?: number;
}

export interface SeccionConteo {
  etiqueta: string;
  cantidad: number;
  /** Porcentaje sobre el total de la sección, redondeado. */
  pct?: number;
}

export interface FilaTecnico {
  id_tecnico: number | null;
  tecnico: string;
  completadas: number;
  /** Null, no cero, cuando no hay ninguna completada: cero es un tiempo. */
  tiempo_promedio_horas: number | null;
}

export interface FilaMaterial {
  material: string;
  cantidad: number;
  por_tecnico: { tecnico: string; cantidad: number }[];
}

export interface Reporte {
  empresa: { id_empresa: number; nombre: string | null };
  periodo: { desde: string; hasta: string; etiqueta: string };
  filtros: FiltrosReporte;
  generado_en: string;
  totales: {
    ot_completadas: number;
    instalaciones: number;
    reparaciones: number;
    otras: number;
    canceladas: number;
  };
  fallas_por_categoria: SeccionConteo[];
  por_tecnico: FilaTecnico[];
  materiales: FilaMaterial[];
  /** Solo en los reportes periódicos (RF-39). */
  instalaciones_por_plan?: SeccionConteo[];
  /** Solo en los reportes periódicos (RF-39). */
  clientes_recurrentes?: {
    id_cliente: number;
    cliente: string;
    reparaciones: number;
    ots: number[];
  }[];
}

const HORA_MS = 3_600_000;

/**
 * Construye los reportes de RF-38, RF-39 y RF-41.
 *
 * Los tres piden lo mismo sobre rangos distintos --el diario sobre ayer, el
 * on-demand sobre lo que elija el usuario, el periodico sobre la semana o el mes
 * cerrado-- asi que hay UN constructor y quien lo llama decide el rango. Tener
 * un calculo por reporte es como se termina con el reporte diario y el mensual
 * contando distinto la misma OT.
 *
 * Todo cuenta OT COMPLETADAS por `fecha_completada`, no por creacion: un reporte
 * de "lo que se hizo en abril" no puede incluir trabajo que se cerro en mayo.
 */
@Injectable()
export class ReportesService {
  private readonly logger = new Logger(ReportesService.name);

  constructor(
    private prisma: PrismaService,
    private recurrentes: ReparacionesRecurrentesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Rangos
  // ---------------------------------------------------------------------------

  /**
   * Los rangos son semiabiertos `[desde, hasta)`.
   *
   * Con `lte` sobre el fin del dia habria que elegir 23:59:59 y se pierde lo que
   * pase en el ultimo segundo; con `lt` sobre el dia siguiente no se pierde
   * nada. Es el mismo criterio que ya usa el dashboard.
   */
  rangoDeDia(fecha: Date): RangoReporte {
    const desde = new Date(fecha);
    desde.setHours(0, 0, 0, 0);
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 1);
    return { desde, hasta };
  }

  /** La semana calendario (lunes a domingo) que contiene a `fecha`. */
  rangoDeSemana(fecha: Date): RangoReporte {
    const desde = new Date(fecha);
    desde.setHours(0, 0, 0, 0);
    // getDay(): 0 es domingo. Se corre al lunes anterior.
    const diasDesdeLunes = (desde.getDay() + 6) % 7;
    desde.setDate(desde.getDate() - diasDesdeLunes);
    const hasta = new Date(desde);
    hasta.setDate(hasta.getDate() + 7);
    return { desde, hasta };
  }

  /** El mes calendario que contiene a `fecha`. */
  rangoDeMes(fecha: Date): RangoReporte {
    const desde = new Date(fecha.getFullYear(), fecha.getMonth(), 1, 0, 0, 0, 0);
    const hasta = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 1, 0, 0, 0, 0);
    return { desde, hasta };
  }

  // ---------------------------------------------------------------------------
  // Construcción
  // ---------------------------------------------------------------------------

  async construir(
    id_empresa: number,
    rango: RangoReporte,
    opciones: FiltrosReporte & { etiqueta: string; incluirPeriodico?: boolean } ,
  ): Promise<Reporte> {
    const { desde, hasta } = rango;
    const filtroTecnico = opciones.id_tecnico ? { id_tecnico: opciones.id_tecnico } : {};

    const [empresa, completadas, canceladas] = await Promise.all([
      this.prisma.empresa.findUnique({
        where: { id_empresa },
        select: { id_empresa: true, nombre: true },
      }),
      this.prisma.orden_trabajo.findMany({
        where: {
          id_empresa,
          estado: 'COMPLETADA',
          fecha_completada: { gte: desde, lt: hasta },
          ...filtroTecnico,
        },
        select: {
          id_ot: true,
          tipo_ot: true,
          id_cliente: true,
          fecha_creacion: true,
          fecha_completada: true,
          categoria_falla: { select: { nombre: true } },
          tecnico: { select: { id_usuario: true, nombre_completo: true } },
          materiales: {
            select: { cantidad: true, tipo_equipo: { select: { nombre: true } } },
          },
        },
      }),
      // Las canceladas no entran en ningun indicador, pero su total se informa:
      // un periodo con muchas cancelaciones dice algo que el resto oculta.
      this.prisma.orden_trabajo.count({
        where: {
          id_empresa,
          estado: 'CANCELADA',
          fecha_creacion: { gte: desde, lt: hasta },
          ...filtroTecnico,
        },
      }),
    ]);

    const instalaciones = completadas.filter((o) => o.tipo_ot === 'INSTALACION');
    const reparaciones = completadas.filter((o) => o.tipo_ot === 'REPARACION');

    const reporte: Reporte = {
      empresa: { id_empresa, nombre: empresa?.nombre ?? null },
      periodo: { desde: desde.toISOString(), hasta: hasta.toISOString(), etiqueta: opciones.etiqueta },
      filtros: { id_tecnico: opciones.id_tecnico },
      generado_en: new Date().toISOString(),
      totales: {
        ot_completadas: completadas.length,
        instalaciones: instalaciones.length,
        reparaciones: reparaciones.length,
        otras: completadas.length - instalaciones.length - reparaciones.length,
        canceladas,
      },
      fallas_por_categoria: this.contarFallas(reparaciones),
      por_tecnico: this.agruparPorTecnico(completadas),
      materiales: this.agruparMateriales(completadas),
    };

    if (opciones.incluirPeriodico) {
      reporte.instalaciones_por_plan = await this.instalacionesPorPlan(instalaciones, id_empresa);
      reporte.clientes_recurrentes = await this.clientesRecurrentes(reparaciones, id_empresa, hasta);
    }

    return reporte;
  }

  // ---------------------------------------------------------------------------

  private contarFallas(reparaciones: { categoria_falla: { nombre: string } | null }[]): SeccionConteo[] {
    const m = new Map<string, number>();
    for (const r of reparaciones) {
      const k = r.categoria_falla?.nombre ?? 'Sin categoría';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    const total = reparaciones.length;
    return [...m]
      .map(([etiqueta, cantidad]) => ({
        etiqueta,
        cantidad,
        pct: total ? Math.round((cantidad / total) * 100) : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }

  private agruparPorTecnico(
    ots: {
      fecha_creacion: Date;
      fecha_completada: Date | null;
      tecnico: { id_usuario: number; nombre_completo: string } | null;
    }[],
  ): FilaTecnico[] {
    const m = new Map<number | null, { nombre: string; ots: typeof ots }>();
    for (const o of ots) {
      const id = o.tecnico?.id_usuario ?? null;
      const e = m.get(id);
      if (e) e.ots.push(o);
      // Las OT sin tecnico existen: las resueltas remotamente por el jefe
      // tecnico. Se muestran como grupo aparte en vez de descartarlas.
      else m.set(id, { nombre: o.tecnico?.nombre_completo ?? 'Sin técnico asignado', ots: [o] });
    }

    return [...m]
      .map(([id_tecnico, { nombre, ots: suyas }]) => {
        const conCierre = suyas.filter((o) => o.fecha_completada);
        const horas = conCierre.reduce(
          (acc, o) => acc + (o.fecha_completada!.getTime() - o.fecha_creacion.getTime()) / HORA_MS,
          0,
        );
        return {
          id_tecnico,
          tecnico: nombre,
          completadas: suyas.length,
          // Null y no cero: si no hay ninguna cerrada no hay un promedio, y
          // mostrar 0 h haria creer que cierran al instante.
          tiempo_promedio_horas: conCierre.length ? Math.round((horas / conCierre.length) * 10) / 10 : null,
        };
      })
      .sort((a, b) => b.completadas - a.completadas);
  }

  private agruparMateriales(
    ots: {
      tecnico: { nombre_completo: string } | null;
      materiales: { cantidad: unknown; tipo_equipo: { nombre: string } | null }[];
    }[],
  ): FilaMaterial[] {
    const m = new Map<string, Map<string, number>>();
    for (const o of ots) {
      const tecnico = o.tecnico?.nombre_completo ?? 'Sin técnico asignado';
      for (const u of o.materiales) {
        const nombre = u.tipo_equipo?.nombre ?? 'Sin identificar';
        // `cantidad` es Decimal: Prisma lo serializa como string.
        const cant = Number(u.cantidad);
        const porTec = m.get(nombre) ?? new Map<string, number>();
        porTec.set(tecnico, (porTec.get(tecnico) ?? 0) + cant);
        m.set(nombre, porTec);
      }
    }

    return [...m]
      .map(([material, porTec]) => ({
        material,
        cantidad: [...porTec.values()].reduce((a, b) => a + b, 0),
        por_tecnico: [...porTec]
          .map(([tecnico, cantidad]) => ({ tecnico, cantidad }))
          .sort((a, b) => b.cantidad - a.cantidad),
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }

  /** RF-39: instalaciones desglosadas por el plan que tiene contratado el cliente. */
  private async instalacionesPorPlan(
    instalaciones: { id_cliente: number | null }[],
    id_empresa: number,
  ): Promise<SeccionConteo[]> {
    const ids = [...new Set(instalaciones.map((i) => i.id_cliente).filter((x): x is number => x != null))];
    if (ids.length === 0) return [];

    const contratos = await this.prisma.contrato.findMany({
      where: { id_cliente: { in: ids }, id_empresa },
      select: { id_cliente: true, plan: { select: { nombre_comercial: true } } },
    });
    // Un cliente puede tener mas de un contrato; se toma el primero que traiga
    // plan, que es el criterio con el que la ficha muestra "su plan".
    const planPorCliente = new Map<number, string>();
    for (const c of contratos) {
      if (c.id_cliente != null && c.plan?.nombre_comercial && !planPorCliente.has(c.id_cliente)) {
        planPorCliente.set(c.id_cliente, c.plan.nombre_comercial);
      }
    }

    const m = new Map<string, number>();
    for (const i of instalaciones) {
      const k = (i.id_cliente != null && planPorCliente.get(i.id_cliente)) || 'Sin plan registrado';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    const total = instalaciones.length;
    return [...m]
      .map(([etiqueta, cantidad]) => ({
        etiqueta,
        cantidad,
        pct: total ? Math.round((cantidad / total) * 100) : 0,
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }

  /**
   * RF-39: clientes que alcanzaron el umbral de RF-08 dentro del período.
   *
   * Se evalua a la fecha de cada reparacion cerrada en el periodo, no al final:
   * un cliente que fue recurrente en la primera semana del mes y despues se
   * arreglo igual tiene que aparecer. Por eso `ReparacionesRecurrentesService`
   * acepta un `hasta`.
   */
  private async clientesRecurrentes(
    reparaciones: { id_cliente: number | null; fecha_completada: Date | null }[],
    id_empresa: number,
    finPeriodo: Date,
  ) {
    // Por cliente, los momentos a evaluar: cada cierre suyo dentro del periodo.
    const momentos = new Map<number, Date[]>();
    for (const r of reparaciones) {
      if (r.id_cliente == null || !r.fecha_completada) continue;
      const l = momentos.get(r.id_cliente) ?? [];
      l.push(r.fecha_completada);
      momentos.set(r.id_cliente, l);
    }

    const salida: { id_cliente: number; cliente: string; reparaciones: number; ots: number[] }[] = [];
    for (const [id_cliente, fechas] of momentos) {
      // Basta con el ultimo cierre de cada cliente dentro del periodo para
      // saber si en algun momento llego al umbral: la ventana movil alcanza su
      // maximo en alguno de los cierres, y evaluar todos seria una consulta por
      // reparacion. Se evalua el maximo entre los cierres del periodo.
      let mejor: Awaited<ReturnType<ReparacionesRecurrentesService['evaluar']>> | null = null;
      for (const f of fechas) {
        const hasta = f > finPeriodo ? finPeriodo : f;
        const r = await this.recurrentes.evaluar(id_cliente, id_empresa, hasta);
        if (!mejor || r.total_reparaciones_30_dias > mejor.total_reparaciones_30_dias) mejor = r;
      }
      if (mejor?.activa) {
        const cliente = await this.prisma.cliente.findFirst({
          where: { id_cliente, id_empresa },
          select: { nombre_completo: true },
        });
        salida.push({
          id_cliente,
          cliente: cliente?.nombre_completo ?? `Cliente ${id_cliente}`,
          reparaciones: mejor.total_reparaciones_30_dias,
          ots: mejor.ots.map((o) => o.id_ot),
        });
      }
    }

    return salida.sort((a, b) => b.reparaciones - a.reparaciones);
  }
}
