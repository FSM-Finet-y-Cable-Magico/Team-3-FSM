import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { validarRut } from '../common/utils/rut.util.js';
import { TIPO_MOVIMIENTO } from '../common/constants/inventario.constants.js';
import { CrearOtDto } from './dto/crear-ot.dto.js';
import { AsignarTecnicoDto } from './dto/asignar-tecnico.dto.js';
import { ActualizarEstadoDto } from './dto/actualizar-estado.dto.js';
import { CerrarOtDto } from './dto/cerrar-ot.dto.js';
import { DashboardGateway } from '../dashboard/dashboard.gateway.js';

const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  PENDIENTE: ['ASIGNADA', 'CANCELADA'],
  ASIGNADA: ['EN_CURSO', 'PENDIENTE', 'PENDIENTE_CLIENTE_AUSENTE', 'CANCELADA'],
  EN_CURSO: ['COMPLETADA', 'PENDIENTE_CLIENTE_AUSENTE', 'CANCELADA'],
  PENDIENTE_CLIENTE_AUSENTE: ['ASIGNADA', 'CANCELADA'],
  COMPLETADA: [],
  CANCELADA: [],
};

const PRIORIDAD_ORDEN: Record<string, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };

const OT_INCLUDE = {
  cliente: { select: { id_cliente: true, nombre_completo: true, rut: true, es_conflictivo: true } },
  tecnico: { select: { id_usuario: true, nombre_completo: true, nombre_usuario: true } },
  direccion: { select: { direccion_completa: true, comuna: true } },
  categoria_falla: { select: { id_categoria: true, nombre: true, sla_horas: true } },
} as const;

@Injectable()
export class OrdenesService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => DashboardGateway)) private dashboardGateway: DashboardGateway,
  ) {}

  async crearOT(dto: CrearOtDto, userId: number, id_empresa: number) {
    if (!validarRut(dto.rut_cliente)) {
      throw new BadRequestException('RUT inválido');
    }

    const cliente = await this.prisma.cliente.findFirst({
      where: { rut: dto.rut_cliente, id_empresa },
      include: { direcciones: { where: { es_principal: true }, take: 1 } },
    });

    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    if (cliente.es_conflictivo && dto.tipo_ot === 'INSTALACION') {
      throw new BadRequestException('Cliente en lista negra. No se puede crear OT de instalación');
    }

    let estado = 'PENDIENTE';
    if (dto.id_tecnico) {
      const tecnico = await this.prisma.usuario.findFirst({
        where: { id_usuario: dto.id_tecnico, id_empresa, activo: true },
      });
      if (!tecnico) throw new NotFoundException('Técnico no encontrado');
      estado = 'ASIGNADA';
    }

    const id_direccion = dto.id_direccion ?? cliente.direcciones[0]?.id_direccion ?? null;

    const nueva = await this.prisma.$transaction(async (tx) => {
      const ot = await tx.orden_trabajo.create({
        data: {
          id_empresa,
          id_cliente: cliente.id_cliente,
          id_tecnico: dto.id_tecnico ?? null,
          id_direccion,
          tipo_ot: dto.tipo_ot,
          prioridad: dto.prioridad ?? 'MEDIA',
          estado,
          fecha_creacion: new Date(),
          fecha_programada: dto.bloque_horario ? new Date(dto.bloque_horario) : null,
          observaciones: dto.observaciones ?? null,
        },
      });

      await tx.historial_ot.create({
        data: {
          id_ot: ot.id_ot,
          id_usuario: userId,
          estado_anterior: null,
          estado_nuevo: estado,
          fecha_hora: new Date(),
        },
      });

      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'CREAR_OT',
          entidad_afectada: 'orden_trabajo',
          id_entidad_afectada: ot.id_ot,
          fecha_hora: new Date(),
        },
      });

      return ot;
    });

    return this.prisma.orden_trabajo.findUnique({
      where: { id_ot: nueva.id_ot },
      include: OT_INCLUDE,
    });
  }

  async listarOT(
    id_empresa: number,
    filtros: {
      estado?: string;
      tipo_ot?: string;
      prioridad?: string;
      id_tecnico?: number;
      fecha_desde?: string;
      fecha_hasta?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Math.max(1, Math.trunc(filtros.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Math.trunc(filtros.limit ?? 20) || 20));

    const condiciones: Prisma.Sql[] = [Prisma.sql`id_empresa = ${id_empresa}`];
    if (filtros.estado) condiciones.push(Prisma.sql`estado = ${filtros.estado}`);
    if (filtros.tipo_ot) condiciones.push(Prisma.sql`tipo_ot = ${filtros.tipo_ot}`);
    if (filtros.prioridad) condiciones.push(Prisma.sql`prioridad = ${filtros.prioridad}`);
    if (filtros.id_tecnico) condiciones.push(Prisma.sql`id_tecnico = ${filtros.id_tecnico}`);
    if (filtros.fecha_desde) condiciones.push(Prisma.sql`fecha_creacion >= ${new Date(filtros.fecha_desde)}`);
    if (filtros.fecha_hasta) condiciones.push(Prisma.sql`fecha_creacion <= ${new Date(filtros.fecha_hasta)}`);
    const where = Prisma.join(condiciones, ' AND ');

    // El orden por prioridad se resuelve en SQL porque es un VarChar sin
    // orden alfabetico util (CRITICA/ALTA/MEDIA/BAJA); ver PRIORIDAD_ORDEN.
    const casoPrioridad = Prisma.join(
      Object.entries(PRIORIDAD_ORDEN).map(([p, n]) => Prisma.sql`WHEN ${p} THEN ${n}`),
      ' ',
    );
    const orderBy =
      filtros.estado === 'PENDIENTE_CLIENTE_AUSENTE'
        ? Prisma.sql`fecha_creacion ASC, id_ot ASC`
        : Prisma.sql`(CASE prioridad ${casoPrioridad} ELSE 99 END) ASC, fecha_creacion DESC, id_ot DESC`;

    // OJO: estas dos son las unicas consultas del backend cuyo aislamiento por
    // empresa NO pasa por un `where` de Prisma, sino por la condicion armada a
    // mano en `condiciones` (arriba). Un middleware (`$use`) o una extension
    // (`$extends` con `query`) que inyecte `id_empresa` no cubre `$queryRaw`:
    // si se agrega esa defensa, hay que revisar este metodo aparte.
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS total FROM orden_trabajo WHERE ${where}`,
    );

    const idsPagina = await this.prisma.$queryRaw<{ id_ot: number }[]>(
      Prisma.sql`SELECT id_ot FROM orden_trabajo WHERE ${where} ORDER BY ${orderBy} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    );
    const ids = idsPagina.map((r) => r.id_ot);

    const filas = ids.length
      ? await this.prisma.orden_trabajo.findMany({ where: { id_ot: { in: ids } }, include: OT_INCLUDE })
      : [];
    const porId = new Map(filas.map((ot) => [ot.id_ot, ot]));

    const data = ids
      .map((id) => porId.get(id))
      .filter((ot): ot is NonNullable<typeof ot> => ot !== undefined)
      .map((ot) => ({
        ...ot,
        antiguedad_dias: this.calcularAntiguedadDias(ot.fecha_creacion),
      }));

    return { data, total, page, limit };
  }

  async obtenerOT(id_ot: number, id_empresa: number) {
    const ot = await this.prisma.orden_trabajo.findFirst({
      where: { id_ot, id_empresa },
      include: {
        cliente: {
          select: {
            id_cliente: true,
            nombre_completo: true,
            rut: true,
            es_conflictivo: true,
            // El tecnico debe poder llamar al cliente antes de marcar PENDIENTE_CLIENTE_AUSENTE; el email no hace falta para eso y se deja fuera por minima exposicion.
            telefono: true,
            direcciones: { where: { es_principal: true }, take: 1 },
          },
        },
        tecnico: { select: { id_usuario: true, nombre_completo: true, nombre_usuario: true } },
        direccion: { select: { direccion_completa: true, comuna: true } },
        categoria_falla: { select: { id_categoria: true, nombre: true, sla_horas: true } },
        historial: { orderBy: { fecha_hora: 'desc' } },
      },
    });

    if (!ot) throw new NotFoundException('OT no encontrada');
    return ot;
  }

  async listarTecnicos(id_empresa: number) {
    const tecnicos = await this.prisma.usuario.findMany({
      where: {
        id_empresa,
        activo: true,
        roles: { some: { rol: { nombre_rol: 'TECNICO' } } },
      },
      select: { id_usuario: true, nombre_completo: true, nombre_usuario: true },
    });

    if (tecnicos.length === 0) return [];

    // Un solo groupBy en lugar de un count por técnico. El filtro por
    // id_empresa evita sumar OT de otro tenant asignadas al mismo técnico.
    const activasPorTecnico = await this.prisma.orden_trabajo.groupBy({
      by: ['id_tecnico'],
      where: {
        id_empresa,
        id_tecnico: { in: tecnicos.map((t) => t.id_usuario) },
        estado: { in: ['ASIGNADA', 'EN_CURSO'] },
      },
      _count: { id_ot: true },
    });

    const activas = new Map(activasPorTecnico.map((row) => [row.id_tecnico, row._count.id_ot]));

    // Los técnicos sin OT no aparecen en el groupBy: se recorre la lista de
    // técnicos, no la del conteo, para que sigan saliendo con 0.
    return tecnicos.map((t) => ({ ...t, ot_activas_hoy: activas.get(t.id_usuario) ?? 0 }));
  }

  async asignarTecnico(
    id_ot: number,
    dto: AsignarTecnicoDto,
    userId: number,
    id_empresa: number,
  ) {
    const ot = await this.prisma.orden_trabajo.findFirst({ where: { id_ot, id_empresa } });
    if (!ot) throw new NotFoundException('OT no encontrada');
    if (ot.estado !== 'PENDIENTE') {
      throw new BadRequestException('Solo se pueden asignar OT en estado PENDIENTE');
    }

    const tecnico = await this.prisma.usuario.findFirst({
      where: { id_usuario: dto.id_tecnico, id_empresa, activo: true },
    });
    if (!tecnico) throw new NotFoundException('Técnico no encontrado');

    await this.prisma.$transaction(async (tx) => {
      await tx.orden_trabajo.update({
        where: { id_ot },
        data: {
          id_tecnico: dto.id_tecnico,
          estado: 'ASIGNADA',
          fecha_programada: dto.bloque_horario
            ? new Date(dto.bloque_horario)
            : ot.fecha_programada,
        },
      });

      await tx.historial_ot.create({
        data: {
          id_ot,
          id_usuario: userId,
          estado_anterior: 'PENDIENTE',
          estado_nuevo: 'ASIGNADA',
          fecha_hora: new Date(),
        },
      });

      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'ASIGNAR_TECNICO',
          entidad_afectada: 'orden_trabajo',
          id_entidad_afectada: id_ot,
          fecha_hora: new Date(),
        },
      });
    });

    return this.obtenerOT(id_ot, id_empresa);
  }

  async actualizarEstado(
    id_ot: number,
    dto: ActualizarEstadoDto,
    userId: number,
    id_empresa: number,
  ) {
    const ot = await this.prisma.orden_trabajo.findFirst({ where: { id_ot, id_empresa } });
    if (!ot) throw new NotFoundException('OT no encontrada');

    const transicionesValidas = TRANSICIONES_VALIDAS[ot.estado] ?? [];
    if (!transicionesValidas.includes(dto.estado)) {
      throw new BadRequestException(
        `Transición de estado no permitida: ${ot.estado} → ${dto.estado}`,
      );
    }

    if (dto.estado === 'CANCELADA' && !dto.obs_cancelacion) {
      throw new BadRequestException('Se requiere motivo de cancelación');
    }

    if (dto.estado === 'PENDIENTE_CLIENTE_AUSENTE' && !dto.obs_cliente_ausente) {
      throw new BadRequestException('Se requiere observacion de cliente ausente');
    }

    const observacionEstado = dto.obs_cancelacion ?? dto.obs_cliente_ausente ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.orden_trabajo.update({
        where: { id_ot },
        data: {
          estado: dto.estado,
          ...(dto.estado === 'CANCELADA' && { observaciones: dto.obs_cancelacion }),
          ...(dto.estado === 'PENDIENTE_CLIENTE_AUSENTE' && {
            obs_cliente_ausente: dto.obs_cliente_ausente,
          }),
          ...(dto.estado === 'ASIGNADA' &&
            ot.estado === 'PENDIENTE_CLIENTE_AUSENTE' && {
              obs_cliente_ausente: null,
            }),
          ...(dto.estado === 'COMPLETADA' && { fecha_completada: new Date() }),
        },
      });

      await tx.historial_ot.create({
        data: {
          id_ot,
          id_usuario: userId,
          estado_anterior: ot.estado,
          estado_nuevo: dto.estado,
          observaciones: observacionEstado,
          fecha_hora: new Date(),
        },
      });

      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'ACTUALIZAR_ESTADO_OT',
          entidad_afectada: 'orden_trabajo',
          id_entidad_afectada: id_ot,
          valor_anterior: { estado: ot.estado },
          valor_nuevo: { estado: dto.estado, observacion: observacionEstado },
          fecha_hora: new Date(),
        },
      });
    });

    const resultado = await this.obtenerOT(id_ot, id_empresa);
    this.dashboardGateway.emitirActualizacion(id_empresa, { tipo: 'OT_ACTUALIZADA', id_ot });
    return resultado;
  }

  async cerrarOT(id_ot: number, dto: CerrarOtDto, userId: number, id_empresa: number) {
    const ot = await this.prisma.orden_trabajo.findFirst({ where: { id_ot, id_empresa } });
    if (!ot) throw new NotFoundException('OT no encontrada');
    if (ot.estado !== 'EN_CURSO') {
      throw new BadRequestException('Solo se pueden cerrar OT en estado EN_CURSO');
    }

    if (ot.id_tecnico !== userId) {
      throw new ForbiddenException('Solo el tÃ©cnico asignado puede cerrar esta OT');
    }

    let categoriaFalla: { id_categoria: number; nombre: string; sla_horas: number | null } | null = null;
    if (ot.tipo_ot === 'REPARACION') {
      if (!dto.id_categoria_falla) {
        throw new BadRequestException('Debe seleccionar la categoria de falla');
      }

      categoriaFalla = await this.prisma.categoria_falla.findUnique({
        where: { id_categoria: dto.id_categoria_falla },
      });

      if (!categoriaFalla) {
        throw new NotFoundException('Categoria de falla no encontrada');
      }

      if (
        categoriaFalla.nombre.toLowerCase() === 'otro' &&
        !dto.categoria_falla_otro?.trim()
      ) {
        throw new BadRequestException('Debe describir la categoria de falla');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.evidencia_foto.createMany({
        data: dto.fotos.map((f) => ({
          id_ot,
          url_cloudinary: f.url_cloudinary,
          formato: f.formato.slice(0, 5),
          tamano_kb: f.tamano_kb,
        })),
      });

      for (const material of dto.materiales) {
        const tipo = await tx.tipo_equipo.findFirst({
          where: { id_tipo_equipo: material.id_tipo_equipo, id_empresa },
        });
        // stock_consumible no tiene id_empresa propio: el aislamiento por
        // empresa se hereda del tipo_equipo y de la bodega. Mismo criterio
        // que obtenerMateriales, para que el cierre descuente exactamente
        // del conjunto de materiales que el selector le mostro al tecnico.
        const stock = await tx.stock_consumible.findFirst({
          where: {
            id_tipo_equipo: material.id_tipo_equipo,
            tipo_equipo: { id_empresa },
            OR: [{ bodega: { id_empresa } }, { id_bodega: null }],
          },
        });
        if (!stock || Number(stock.cantidad_disponible) < material.cantidad) {
          throw new BadRequestException(
            `Stock insuficiente para ${tipo?.nombre ?? String(material.id_tipo_equipo)}`,
          );
        }
        await tx.stock_consumible.update({
          where: { id_stock: stock.id_stock },
          data: { cantidad_disponible: { decrement: material.cantidad } },
        });

        // RNF-14: cada decremento de stock deja su movimiento de inventario,
        // en la misma transaccion y en la misma iteracion, para que no exista
        // ningun camino donde se descuente material sin quedar registrado.
        await tx.movimiento_inventario.create({
          data: {
            id_tipo_equipo: material.id_tipo_equipo,
            id_empresa_origen: ot.id_empresa,
            // Puede ser null: la busqueda de stock admite filas sin bodega.
            id_bodega_origen: stock.id_bodega,
            id_usuario: userId,
            tipo_movimiento: TIPO_MOVIMIENTO.SALIDA_OT,
            cantidad: material.cantidad,
            referencia_id: id_ot,
          },
        });
      }

      if (dto.materiales.length > 0) {
        await tx.uso_material_ot.createMany({
          data: dto.materiales.map((m) => ({
            id_ot,
            id_tipo_equipo: m.id_tipo_equipo,
            cantidad: m.cantidad,
          })),
        });
      }

      await tx.llamada_cortes.create({
        data: {
          id_ot,
          resultado: dto.resultado_llamada,
          observaciones: dto.obs_llamada ?? null,
        },
      });

      await tx.orden_trabajo.update({
        where: { id_ot },
        data: {
          estado: 'COMPLETADA',
          fecha_completada: new Date(),
          potencia_optica_dbm: dto.potencia_optica_dbm,
          id_categoria_falla: categoriaFalla?.id_categoria ?? null,
          categoria_falla_otro: dto.categoria_falla_otro?.trim() || null,
          resuelto_remotamente: dto.resuelto_remotamente ?? false,
        },
      });

      await tx.historial_ot.create({
        data: {
          id_ot,
          id_usuario: userId,
          estado_anterior: 'EN_CURSO',
          estado_nuevo: 'COMPLETADA',
        },
      });

      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'CERRAR_OT',
          entidad_afectada: 'orden_trabajo',
          id_entidad_afectada: id_ot,
        },
      });
    });

    const otActualizada = await this.prisma.orden_trabajo.findUnique({
      where: { id_ot },
      include: {
        cliente: { select: { id_cliente: true, nombre_completo: true, rut: true, es_conflictivo: true } },
        tecnico: { select: { id_usuario: true, nombre_completo: true, nombre_usuario: true } },
        direccion: { select: { direccion_completa: true, comuna: true } },
        categoria_falla: { select: { id_categoria: true, nombre: true, sla_horas: true } },
        fotos: true,
        materiales: { include: { tipo_equipo: { select: { nombre: true } } } },
        llamada: true,
      },
    });

    const advertencia_potencia =
      dto.potencia_optica_dbm < -24 || dto.potencia_optica_dbm > -19;
    const alerta_reparaciones_30_dias = otActualizada?.id_cliente
      ? await this.alertaReparacionesCliente(otActualizada.id_cliente, id_empresa)
      : null;

    this.dashboardGateway.emitirActualizacion(id_empresa, { tipo: 'OT_ACTUALIZADA', id_ot });
    return { ...otActualizada, advertencia_potencia, alerta_reparaciones_30_dias };
  }

  async historialFallas(id_cliente: number, id_empresa: number) {
    const ots = await this.prisma.orden_trabajo.findMany({
      where: { id_cliente, id_empresa, tipo_ot: 'REPARACION' },
      orderBy: { fecha_creacion: 'desc' },
      take: 20,
      include: {
        historial: { orderBy: { fecha_hora: 'desc' }, take: 1 },
        fotos: { select: { url_cloudinary: true, formato: true } },
        materiales: {
          include: { tipo_equipo: { select: { nombre: true, categoria: true } } },
        },
        categoria_falla: true,
        llamada: true,
        ticket: { include: { categoria: true } },
      },
    });

    // Categoría de falla más frecuente
    const conteo = new Map<number, number>();
    for (const ot of ots) {
      const idCat = ot.id_categoria_falla ?? ot.ticket?.id_categoria;
      if (idCat) conteo.set(idCat, (conteo.get(idCat) ?? 0) + 1);
    }

    let categoria_frecuente: { id_categoria: number; nombre: string; sla_horas: number | null } | null = null;
    if (conteo.size > 0) {
      const [idTop] = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0];
      const cat = await this.prisma.categoria_falla.findUnique({ where: { id_categoria: idTop } });
      if (cat) categoria_frecuente = { id_categoria: cat.id_categoria, nombre: cat.nombre, sla_horas: cat.sla_horas };
    }

    // Estadísticas
    const completadas = ots.filter((o) => o.estado === 'COMPLETADA');

    let tiempo_promedio_dias: number | null = null;
    const conTiempo = completadas.filter((o) => o.fecha_completada);
    if (conTiempo.length > 0) {
      const suma = conTiempo.reduce((acc, o) => {
        return acc + (new Date(o.fecha_completada!).getTime() - new Date(o.fecha_creacion).getTime());
      }, 0);
      tiempo_promedio_dias = Math.round((suma / conTiempo.length / 86400000) * 10) / 10;
    }

    let potencia_promedio_dbm: number | null = null;
    const conPotencia = completadas.filter((o) => o.potencia_optica_dbm !== null).slice(0, 5);
    if (conPotencia.length > 0) {
      const suma = conPotencia.reduce((acc, o) => acc + Number(o.potencia_optica_dbm), 0);
      potencia_promedio_dbm = Math.round((suma / conPotencia.length) * 10) / 10;
    }

    return {
      historial: ots,
      categoria_frecuente,
      estadisticas: {
        total_reparaciones: ots.length,
        reparaciones_completadas: completadas.length,
        tiempo_promedio_dias,
        potencia_promedio_dbm,
      },
    };
  }

  async obtenerMateriales(id_empresa: number) {
    const tipos = await this.prisma.tipo_equipo.findMany({
      where: { id_empresa, activo: true },
      include: {
        stock: {
          // El tipo_equipo ya esta acotado por empresa, pero su stock puede
          // vivir en una bodega del otro tenant. Las filas sin bodega asignada
          // se mantienen: no son atribuibles a otra empresa.
          where: { OR: [{ bodega: { id_empresa } }, { id_bodega: null }] },
          select: { id_stock: true, cantidad_disponible: true, umbral_minimo: true },
          take: 1,
        },
      },
    });

    return tipos.map((t) => ({
      id_tipo_equipo: t.id_tipo_equipo,
      nombre: t.nombre,
      categoria: t.categoria,
      requiere_serie_individual: t.requiere_serie_individual ?? false,
      stock: t.stock[0]
        ? {
            cantidad_disponible: Number(t.stock[0].cantidad_disponible),
            umbral_minimo: t.stock[0].umbral_minimo
              ? Number(t.stock[0].umbral_minimo)
              : null,
          }
        : null,
    }));
  }

  async listarCategoriasFalla() {
    return this.prisma.categoria_falla.findMany({
      select: { id_categoria: true, nombre: true, sla_horas: true },
      orderBy: { nombre: 'asc' },
    });
  }

  private calcularAntiguedadDias(fecha: Date) {
    return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000));
  }

  private async alertaReparacionesCliente(id_cliente: number, id_empresa: number) {
    const desde = new Date();
    desde.setDate(desde.getDate() - 30);

    const total = await this.prisma.orden_trabajo.count({
      where: {
        id_cliente,
        id_empresa,
        tipo_ot: 'REPARACION',
        estado: { not: 'CANCELADA' },
        fecha_creacion: { gte: desde },
      },
    });

    return {
      activa: total >= 3,
      total_reparaciones_30_dias: total,
      desde,
    };
  }
}
