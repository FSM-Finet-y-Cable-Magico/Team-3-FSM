import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { rangoDiaOperacion } from '../common/utils/dia-habil.util.js';
import {
  DIAS_VENTANA_RECURRENCIA,
  UMBRAL_REPARACIONES_RECURRENTES,
} from '../ordenes/reparaciones-recurrentes.service.js';
import { SinReagendarService } from '../ordenes/sin-reagendar.service.js';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private sinReagendar: SinReagendarService,
  ) {}

  async indicadoresDelDia(id_empresa: number) {
    // La jornada se resuelve con el mismo helper que usa la vista de terreno
    // (CU-11): devuelve instantes, no hora de pared, asi que la ventana no se
    // corre contra `fecha_completada`, que es un timestamp sin zona en UTC.
    // Calcularla en SQL con AT TIME ZONE daba medianoche de Santiago como texto
    // sin zona, y el dashboard terminaba contando de 21:00 a 21:00.
    const { desde: inicio_dia, hasta: fin_dia } = rangoDiaOperacion();
    // La ventana de RF-08 sale de la regla compartida, no de un 30 escrito
    // aca: este contador tenia su propia copia y ya habia divergido.
    const desdeRecurrencia = new Date();
    desdeRecurrencia.setDate(desdeRecurrencia.getDate() - DIAS_VENTANA_RECURRENCIA);

    const [
      otsPorEstado,
      criticas,
      tecnicosRaw,
      ultimasCompletadas,
      totalClientes,
      resueltasRemoto,
      clientesConReparacionesRecurrentes,
      cargaTecnicosRaw,
      completadasHoy,
      tiempoPromedioCierre,
      sinReagendarVencidas,
    ] = await Promise.all([
      this.prisma.orden_trabajo.groupBy({
        by: ['estado'],
        where: { id_empresa },
        _count: { estado: true },
      }),

      this.prisma.orden_trabajo.count({
        where: {
          id_empresa,
          prioridad: 'CRITICA',
          estado: { notIn: ['COMPLETADA', 'CANCELADA'] },
        },
      }),

      this.prisma.usuario.findMany({
        where: {
          id_empresa,
          activo: true,
          roles: { some: { rol: { nombre_rol: 'TECNICO' } } },
        },
        select: { id_usuario: true, nombre_completo: true },
      }),

      this.prisma.orden_trabajo.findMany({
        where: {
          id_empresa,
          estado: 'COMPLETADA',
          fecha_completada: { gte: inicio_dia, lt: fin_dia },
        },
        orderBy: { fecha_completada: 'desc' },
        take: 5,
        include: {
          cliente: { select: { nombre_completo: true } },
          tecnico: { select: { nombre_completo: true } },
        },
      }),

      this.prisma.cliente.count({
        where: { id_empresa, estado: 'ACTIVO' },
      }),

      this.prisma.orden_trabajo.count({
        where: {
          id_empresa,
          estado: 'COMPLETADA',
          resuelto_remotamente: true,
          fecha_completada: { gte: inicio_dia, lt: fin_dia },
        },
      }),

      // RF-08 cuenta reparaciones CERRADAS y ancla en la fecha de cierre.
      // Aca se contaba `estado: { not: 'CANCELADA' }` sobre `fecha_creacion`,
      // que es la version vieja de la regla: sumaba OT todavia abiertas y se
      // perdia las creadas antes de la ventana pero cerradas dentro. Sobre los
      // datos actuales daba 8 reparaciones para un cliente que tiene 5.
      //
      // No se llama a ReparacionesRecurrentesService porque aca hace falta un
      // agregado sobre todos los clientes, y evaluar uno por uno seria una
      // consulta por cliente. Lo que se comparte es la regla: mismo filtro,
      // misma ventana y mismo umbral, tomados de sus constantes.
      this.prisma.orden_trabajo.groupBy({
        by: ['id_cliente'],
        where: {
          id_empresa,
          id_cliente: { not: null },
          tipo_ot: 'REPARACION',
          estado: 'COMPLETADA',
          fecha_completada: { gte: desdeRecurrencia },
        },
        _count: { id_cliente: true },
      }),

      // Los dos contadores por técnico (ot_activas y en_curso) salen de este
      // único groupBy por id_tecnico + estado. El filtro por id_empresa evita
      // sumar OT de otro tenant asignadas al mismo técnico.
      this.prisma.orden_trabajo.groupBy({
        by: ['id_tecnico', 'estado'],
        where: {
          id_empresa,
          id_tecnico: { not: null },
          estado: { in: ['ASIGNADA', 'EN_CURSO'] },
        },
        _count: { id_ot: true },
      }),

      this.prisma.orden_trabajo.count({
        where: {
          id_empresa,
          estado: 'COMPLETADA',
          fecha_completada: { gte: inicio_dia, lt: fin_dia },
        },
      }),

      // El ::float8 no es decorativo: EXTRACT(EPOCH ...) devuelve numeric, que
      // Prisma mapea a Decimal y se serializa a JSON como string. La vista hace
      // .toFixed() sobre este valor y reventaba el dashboard entero apenas se
      // cerraba la primera OT del dia.
      this.prisma.$queryRaw<[{ horas_promedio: number | null }]>`
        SELECT AVG(EXTRACT(EPOCH FROM (fecha_completada - fecha_creacion)) / 3600)::float8 AS horas_promedio
        FROM orden_trabajo
        WHERE id_empresa = ${id_empresa}
          AND estado = 'COMPLETADA'
          AND fecha_completada >= ${inicio_dia}
          AND fecha_completada < ${fin_dia}
      `,
    
      this.sinReagendar.contarVencidas(id_empresa),
]);

    const ot_por_estado = {
      PENDIENTE: 0,
      PENDIENTE_CLIENTE_AUSENTE: 0,
      ASIGNADA: 0,
      EN_CURSO: 0,
      COMPLETADA: 0,
      CANCELADA: 0,
    } as Record<string, number>;

    for (const row of otsPorEstado) {
      ot_por_estado[row.estado] = row._count.estado;
    }

    const cargaPorTecnico = new Map<number, { ot_activas: number; en_curso: boolean }>();
    for (const row of cargaTecnicosRaw) {
      if (row.id_tecnico === null) continue;
      const carga = cargaPorTecnico.get(row.id_tecnico) ?? { ot_activas: 0, en_curso: false };
      carga.ot_activas += row._count.id_ot;
      if (row.estado === 'EN_CURSO') carga.en_curso = true;
      cargaPorTecnico.set(row.id_tecnico, carga);
    }

    // Los técnicos sin OT no aparecen en el groupBy: se recorre tecnicosRaw,
    // no el conteo, para que sigan saliendo con 0 y en_curso false.
    const tecnicos = tecnicosRaw.map((t) => {
      const carga = cargaPorTecnico.get(t.id_usuario);
      return {
        id_usuario: t.id_usuario,
        nombre_completo: t.nombre_completo,
        ot_activas: carga?.ot_activas ?? 0,
        en_curso: carga?.en_curso ?? false,
      };
    });

    return {
      ot_por_estado,
      ot_criticas_activas: criticas,
      clientes_reparacion_recurrente: clientesConReparacionesRecurrentes.filter(
        (row) => row._count.id_cliente >= UMBRAL_REPARACIONES_RECURRENTES,
      ).length,
      tecnicos,
      ultimas_completadas: ultimasCompletadas,
      total_clientes_activos: totalClientes,
      resueltas_remotamente_hoy: resueltasRemoto,
      // RF-37 lo pide explicitamente "segun RF-09". Sale del mismo servicio que
      // usa el listado, para que no nazca una segunda version del criterio.
      ot_sin_reagendar_30_dias: sinReagendarVencidas,
      ot_completadas_hoy: completadasHoy,
      tiempo_promedio_cierre: tiempoPromedioCierre[0]?.horas_promedio ?? null,
      fecha_actualizacion: new Date(),
    };
  }

  async datosPorEmpresa(id_empresa: number) {
    const [empresa, totalClientes, otActivas] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id_empresa } }),
      this.prisma.cliente.count({ where: { id_empresa } }),
      this.prisma.orden_trabajo.count({
        where: {
          id_empresa,
          estado: { notIn: ['COMPLETADA', 'CANCELADA'] },
        },
      }),
    ]);

    return { empresa, total_clientes: totalClientes, ot_activas: otActivas };
  }

  async listarEmpresas() {
    return this.prisma.empresa.findMany({
      select: { id_empresa: true, nombre: true, rut_empresa: true },
      orderBy: { nombre: 'asc' },
    });
  }
}
