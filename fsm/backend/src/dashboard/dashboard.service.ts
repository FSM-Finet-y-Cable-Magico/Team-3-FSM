import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async indicadoresDelDia(id_empresa: number) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 30);

    const [
      otsPorEstado,
      criticas,
      tecnicosRaw,
      ultimasCompletadas,
      totalClientes,
      resueltasRemoto,
      clientesConReparacionesRecurrentes,
      cargaTecnicosRaw,
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
          fecha_completada: { gte: hoy, lt: manana },
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
          fecha_completada: { gte: hoy, lt: manana },
        },
      }),

      this.prisma.orden_trabajo.groupBy({
        by: ['id_cliente'],
        where: {
          id_empresa,
          id_cliente: { not: null },
          tipo_ot: 'REPARACION',
          estado: { not: 'CANCELADA' },
          fecha_creacion: { gte: hace30Dias },
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
        (row) => row._count.id_cliente >= 3,
      ).length,
      tecnicos,
      ultimas_completadas: ultimasCompletadas,
      total_clientes_activos: totalClientes,
      resueltas_remotamente_hoy: resueltasRemoto,
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
