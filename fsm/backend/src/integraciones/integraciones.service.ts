import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiScope } from '../common/guards/api-key.guard.js';
import { ACCION_A_ESTADO_G1, type AccionEquipo } from '../ordenes/estado-equipo.constants.js';
import type { PayloadCierre, EquipoDeclarado } from '../ordenes/fan-out/fan-out-cierre.js';

const MAX_RANGO_DIAS = 90;

@Injectable()
export class IntegracionesService {
  constructor(private prisma: PrismaService) {}

  // ---- helpers ----

  private exigirEmpresa(scope: ApiScope, id_empresa: number): number {
    if (!Number.isFinite(id_empresa)) {
      throw new BadRequestException('id_empresa es obligatorio');
    }
    if (!scope.empresas.includes(id_empresa)) {
      throw new ForbiddenException(
        `La API key de ${scope.grupo} no tiene acceso a la empresa ${id_empresa}`,
      );
    }
    return id_empresa;
  }

  private rango(desde?: string, hasta?: string): { gte: Date; lte: Date } {
    if (!desde || !hasta) throw new BadRequestException('desde y hasta son obligatorios (YYYY-MM-DD)');
    const gte = new Date(desde);
    const lte = new Date(hasta);
    if (isNaN(gte.getTime()) || isNaN(lte.getTime())) {
      throw new BadRequestException('Fechas inválidas');
    }
    if (lte < gte) throw new BadRequestException('hasta no puede ser anterior a desde');
    const dias = (lte.getTime() - gte.getTime()) / 86_400_000;
    if (dias > MAX_RANGO_DIAS) {
      throw new BadRequestException(`El rango no puede superar ${MAX_RANGO_DIAS} días`);
    }
    return { gte, lte };
  }

  // ---- OTs ----

  /** Listado de OT con cliente/técnico/dirección. Para T1-CU-61 (trabajos del día). */
  async ordenes(
    scope: ApiScope,
    q: { id_empresa: number; estado?: string; id_tecnico?: number; desde?: string; hasta?: string; page?: number; limit?: number },
  ) {
    const id_empresa = this.exigirEmpresa(scope, q.id_empresa);
    const page = q.page ?? 1;
    const limit = Math.min(q.limit ?? 50, 100);

    const where: Record<string, unknown> = { id_empresa };
    if (q.estado) where.estado = q.estado;
    if (q.id_tecnico) where.id_tecnico = q.id_tecnico;
    if (q.desde && q.hasta) {
      const { gte, lte } = this.rango(q.desde, q.hasta);
      where.fecha_creacion = { gte, lte };
    }

    const [data, total] = await Promise.all([
      this.prisma.orden_trabajo.findMany({
        where,
        orderBy: { fecha_creacion: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id_ot: true,
          tipo_ot: true,
          prioridad: true,
          estado: true,
          fecha_creacion: true,
          fecha_programada: true,
          fecha_completada: true,
          cliente: { select: { rut: true, nombre_completo: true, telefono: true } },
          tecnico: { select: { id_usuario: true, nombre_completo: true } },
          direccion: { select: { direccion_completa: true, comuna: true } },
        },
      }),
      this.prisma.orden_trabajo.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /** Cierres (OT COMPLETADAS) en un rango ≤90 días, con materiales. Para T1-CU-90. */
  async cierres(scope: ApiScope, q: { id_empresa: number; desde?: string; hasta?: string; page?: number }) {
    const id_empresa = this.exigirEmpresa(scope, q.id_empresa);
    const { gte, lte } = this.rango(q.desde, q.hasta);
    const page = q.page ?? 1;
    const limit = 100;

    const where = { id_empresa, estado: 'COMPLETADA', fecha_completada: { gte, lte } };
    const [data, total] = await Promise.all([
      this.prisma.orden_trabajo.findMany({
        where,
        orderBy: { fecha_completada: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id_ot: true,
          tipo_ot: true,
          fecha_completada: true,
          potencia_optica_dbm: true,
          id_categoria_falla: true,
          cliente: { select: { rut: true, nombre_completo: true } },
          tecnico: { select: { id_usuario: true, nombre_completo: true } },
          materiales: { select: { id_tipo_equipo: true, cantidad: true } },
          cierre_equipos: true,
        },
      }),
      this.prisma.orden_trabajo.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Payload completo de un cierre — RECONCILIACIÓN. Devuelve exactamente lo
   * mismo que el webhook `fan-out`. G1 lo consume si el webhook falló.
   */
  async cierre(scope: ApiScope, id_ot: number, id_empresa: number): Promise<PayloadCierre> {
    this.exigirEmpresa(scope, id_empresa);

    const ot = await this.prisma.orden_trabajo.findFirst({
      where: { id_ot, id_empresa, estado: 'COMPLETADA' },
      include: {
        cliente: { select: { rut: true, nombre_completo: true } },
        direccion: { select: { direccion_completa: true, comuna: true } },
        categoria_falla: { select: { id_categoria: true, nombre: true } },
        materiales: { select: { id_tipo_equipo: true, cantidad: true } },
        llamada: { select: { resultado: true } },
      },
    });
    if (!ot) throw new NotFoundException(`OT ${id_ot} cerrada no encontrada en la empresa ${id_empresa}`);

    const equipos = (ot.cierre_equipos as { instalados?: EquipoDeclarado[]; retirados?: EquipoDeclarado[] } | null) ?? {};
    const fecha = (ot.fecha_completada ?? ot.fecha_creacion).toISOString();

    return {
      clave_idempotencia: `${id_ot}:${fecha}`,
      id_ot,
      id_empresa: ot.id_empresa,
      tipo_ot: ot.tipo_ot,
      fecha_completada: fecha,
      resultado_llamada: ot.llamada?.resultado ?? '',
      potencia_optica_dbm: ot.potencia_optica_dbm == null ? 0 : Number(ot.potencia_optica_dbm),
      resuelto_remotamente: ot.resuelto_remotamente,
      cliente: ot.cliente ? { rut: ot.cliente.rut, nombre: ot.cliente.nombre_completo } : null,
      direccion: ot.direccion ?? null,
      categoria_falla: ot.categoria_falla
        ? { id_categoria: ot.categoria_falla.id_categoria, nombre: ot.categoria_falla.nombre }
        : null,
      categoria_falla_otro: ot.categoria_falla_otro,
      materiales: ot.materiales
        .filter((m): m is typeof m & { id_tipo_equipo: number } => m.id_tipo_equipo != null)
        .map((m) => ({ id_tipo_equipo: m.id_tipo_equipo, cantidad: Number(m.cantidad) })),
      equipos_instalados: equipos.instalados ?? [],
      equipos_retirados: equipos.retirados ?? [],
    };
  }

  // ---- catálogo / clientes ----

  /** Catálogo global de categorías de falla. Para T1-CU-70. */
  async categoriasFalla() {
    return this.prisma.categoria_falla.findMany({
      select: { id_categoria: true, nombre: true, sla_horas: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async clientePorRut(scope: ApiScope, id_empresa: number, rut: string) {
    this.exigirEmpresa(scope, id_empresa);
    const cliente = await this.prisma.cliente.findFirst({
      where: { rut, id_empresa },
      select: {
        id_cliente: true,
        rut: true,
        nombre_completo: true,
        email: true,
        telefono: true,
        estado: true,
        direcciones: {
          where: { es_principal: true },
          select: { direccion_completa: true, comuna: true, ciudad: true },
        },
      },
    });
    if (!cliente) throw new NotFoundException(`Cliente ${rut} no encontrado en la empresa ${id_empresa}`);
    return cliente;
  }

  async buscarClientes(scope: ApiScope, id_empresa: number, busqueda: string) {
    this.exigirEmpresa(scope, id_empresa);
    if (!busqueda || busqueda.trim().length < 3) {
      throw new BadRequestException('busqueda: mínimo 3 caracteres');
    }
    const q = busqueda.trim();
    return this.prisma.cliente.findMany({
      where: {
        id_empresa,
        OR: [
          { rut: { contains: q, mode: 'insensitive' } },
          { nombre_completo: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 25,
      select: { id_cliente: true, rut: true, nombre_completo: true, telefono: true, estado: true },
      orderBy: { nombre_completo: 'asc' },
    });
  }

  /** Mapa acción → literal de G1, para que quede trazable vía API. */
  mapeoEstados() {
    return Object.entries(ACCION_A_ESTADO_G1).map(([accion, estado_g1]) => ({
      accion: accion as AccionEquipo,
      estado_g1,
      confirmado_por_g1: accion !== 'RETIRADO_PARA_DIAGNOSTICO',
    }));
  }
}
