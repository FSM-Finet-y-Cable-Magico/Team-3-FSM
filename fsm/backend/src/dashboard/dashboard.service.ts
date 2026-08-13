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

    const tecnicos = await Promise.all(
      tecnicosRaw.map(async (t) => {
        const [ot_activas, en_cursoCount] = await Promise.all([
          this.prisma.orden_trabajo.count({
            where: {
              id_tecnico: t.id_usuario,
              estado: { in: ['ASIGNADA', 'EN_CURSO'] },
            },
          }),
          this.prisma.orden_trabajo.count({
            where: { id_tecnico: t.id_usuario, estado: 'EN_CURSO' },
          }),
        ]);
        return {
          id_usuario: t.id_usuario,
          nombre_completo: t.nombre_completo,
          ot_activas,
          en_curso: en_cursoCount > 0,
        };
      }),
    );

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
