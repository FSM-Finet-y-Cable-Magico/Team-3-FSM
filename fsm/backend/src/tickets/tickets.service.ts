import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrdenesService } from '../ordenes/ordenes.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizarPaginacion } from '../common/utils/paginacion.util.js';
import { validarRut } from '../common/utils/rut.util.js';
import {
  ESTADO_TICKET,
  ESTADOS_TICKET_ABIERTOS,
  TRANSICIONES_TICKET,
  generarCodigoSeguimiento,
  prioridadPorSla,
  type EstadoTicket,
  type OrigenTicket,
} from './tickets.constants.js';

/** Textos de las excepciones de CU-29, tal cual los fija el CU. */
export const MENSAJE_RUT_INVALIDO =
  'Ingrese su RUT correctamente. Debe ser el mismo con el que contrató el servicio.';
export const MENSAJE_SIN_SERVICIO =
  'No encontramos un servicio activo con ese RUT. Si cree que es un error, comuníquese directamente con FiNet.';

/** Quien actua. `userId` es null cuando el ticket llega de otro sistema. */
interface Actor {
  userId: number | null;
  id_empresa: number;
}

const INCLUDE_TICKET = {
  categoria: { select: { id_categoria: true, nombre: true, sla_horas: true } },
  cliente: { select: { id_cliente: true, rut: true, nombre_completo: true, telefono: true } },
  usuario_asignado: { select: { id_usuario: true, nombre_completo: true } },
  orden_trabajo: { select: { id_ot: true, estado: true } },
} satisfies Prisma.ticketInclude;

type TicketConRelaciones = Prisma.ticketGetPayload<{ include: typeof INCLUDE_TICKET }>;

const INTENTOS_CODIGO = 5;
const HORA_MS = 3_600_000;

/**
 * Tickets de soporte (CU-29, CU-30, CU-32). Molde de `src/clientes`: servicio
 * sin dependencias de otros modulos y aislamiento por empresa en cada consulta,
 * que en tickets es `id_empresa` directo.
 *
 * El SLA no se guarda: vence en `fecha_creacion + categoria.sla_horas`. Asi,
 * reclasificar (CU-32) lo recalcula solo, sin una columna que mantener.
 */
@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private ordenes: OrdenesService,
  ) {}

  /** Separado para poder forzar un choque de codigos en las pruebas. */
  private nuevoCodigo() {
    return generarCodigoSeguimiento();
  }

  // ---------------------------------------------------------------------------
  // CU-29
  // ---------------------------------------------------------------------------

  async crear(
    dto: { rut_cliente: string; id_categoria: number; descripcion?: string; origen: OrigenTicket },
    actor: Actor,
    ahora = new Date(),
  ) {
    const rut = dto.rut_cliente.trim().toUpperCase();
    if (!validarRut(rut)) throw new BadRequestException(MENSAJE_RUT_INVALIDO);

    const cliente = await this.prisma.cliente.findFirst({
      where: { rut, id_empresa: actor.id_empresa },
      select: { id_cliente: true, estado: true },
    });
    // Precondicion del CU: "el cliente tiene servicio activo". Un cliente
    // suspendido o dado de baja recibe el mismo mensaje que uno inexistente.
    if (!cliente || cliente.estado !== 'ACTIVO') throw new NotFoundException(MENSAJE_SIN_SERVICIO);

    const categoria = await this.categoria(dto.id_categoria);

    for (let intento = 1; ; intento++) {
      try {
        const creado = await this.prisma.$transaction(async (tx) => {
          const t = await tx.ticket.create({
            data: {
              id_empresa: actor.id_empresa,
              id_cliente: cliente.id_cliente,
              id_categoria: categoria.id_categoria,
              codigo_seguimiento: this.nuevoCodigo(),
              prioridad: prioridadPorSla(categoria.sla_horas),
              estado: ESTADO_TICKET.ABIERTO,
              descripcion: dto.descripcion?.trim() || null,
              origen: dto.origen,
              fecha_creacion: ahora,
            },
          });
          await tx.log_auditoria.create({
            data: {
              id_usuario: actor.userId,
              accion: 'CREAR_TICKET',
              entidad_afectada: 'ticket',
              id_entidad_afectada: t.id_ticket,
              valor_nuevo: { codigo_seguimiento: t.codigo_seguimiento, origen: dto.origen, id_categoria: categoria.id_categoria },
            },
          });
          return t;
        });
        return this.obtener(creado.id_ticket, actor.id_empresa, ahora);
      } catch (e) {
        const choque = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        if (!choque || intento >= INTENTOS_CODIGO) throw e;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CU-30
  // ---------------------------------------------------------------------------

  async listar(
    id_empresa: number,
    filtros: { estado?: string; prioridad?: string; page?: unknown; limit?: unknown },
    ahora = new Date(),
  ) {
    const { page, limit, skip } = normalizarPaginacion(filtros.page, filtros.limit);
    const where: Prisma.ticketWhereInput = { id_empresa };
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.prioridad) where.prioridad = filtros.prioridad;

    const [filas, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: INCLUDE_TICKET,
        // Lo mas viejo primero: es lo que mas cerca esta de vencer su SLA.
        orderBy: [{ fecha_creacion: 'asc' }, { id_ticket: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { data: filas.map((t) => this.aVista(t, ahora)), total, page, limit };
  }

  async obtener(id_ticket: number, id_empresa: number, ahora = new Date()) {
    const t = await this.buscar(id_ticket, id_empresa);
    // El historial sale de la auditoria: cada cambio del ticket ya se registra
    // ahi con el antes y el despues, y el modelo no tiene tabla de historial.
    const historial = await this.prisma.log_auditoria.findMany({
      where: { entidad_afectada: 'ticket', id_entidad_afectada: id_ticket },
      orderBy: { fecha_hora: 'desc' },
      take: 50,
      select: {
        accion: true,
        valor_anterior: true,
        valor_nuevo: true,
        fecha_hora: true,
        usuario: { select: { nombre_completo: true } },
      },
    });
    return { ...this.aVista(t, ahora), historial };
  }

  /** Seguimiento por codigo, para los canales digitales (CU-29). */
  async porCodigo(codigo: string, id_empresa: number, ahora = new Date()) {
    const t = await this.prisma.ticket.findFirst({
      where: { codigo_seguimiento: codigo.trim().toUpperCase(), id_empresa },
      include: INCLUDE_TICKET,
    });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    const v = this.aVista(t, ahora);
    // Al canal digital no le va el nombre del jefe tecnico ni la OT interna.
    return {
      codigo_seguimiento: v.codigo_seguimiento,
      estado: v.estado,
      categoria: v.categoria?.nombre ?? null,
      fecha_creacion: v.fecha_creacion,
      vence_en: v.vence_en,
      fecha_cierre: v.fecha_cierre,
    };
  }

  async asignar(id_ticket: number, id_usuario: number, actor: Actor) {
    const t = await this.buscar(id_ticket, actor.id_empresa);
    if (t.estado === ESTADO_TICKET.RESUELTO) throw new BadRequestException('El ticket ya está resuelto');
    const usuario = await this.prisma.usuario.findFirst({
      where: { id_usuario, id_empresa: actor.id_empresa, activo: true },
      select: { id_usuario: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id_ticket }, data: { id_usuario_asignado: id_usuario } });
      await tx.log_auditoria.create({
        data: {
          id_usuario: actor.userId,
          accion: 'ASIGNAR_TICKET',
          entidad_afectada: 'ticket',
          id_entidad_afectada: id_ticket,
          valor_anterior: { id_usuario_asignado: t.id_usuario_asignado },
          valor_nuevo: { id_usuario_asignado: id_usuario },
        },
      });
    });
    return this.obtener(id_ticket, actor.id_empresa);
  }

  /** CU-30: el jefe tecnico decide resolverlo remotamente y lo toma. */
  async tomar(id_ticket: number, actor: Actor) {
    const t = await this.buscar(id_ticket, actor.id_empresa);
    await this.transicion(t, ESTADO_TICKET.EN_PROGRESO, actor, {
      // Quien lo toma queda a cargo, salvo que ya estuviera asignado.
      id_usuario_asignado: t.id_usuario_asignado ?? actor.userId,
    });
    return this.obtener(id_ticket, actor.id_empresa);
  }

  /** CU-30: resuelto a distancia, con la observacion de que se hizo. */
  async resolver(id_ticket: number, dto: { observacion: string }, actor: Actor, ahora = new Date()) {
    const observacion = dto.observacion?.trim();
    if (!observacion) throw new BadRequestException('Se requiere una observación de la resolución');
    const t = await this.buscar(id_ticket, actor.id_empresa);
    await this.transicion(
      t,
      ESTADO_TICKET.RESUELTO,
      actor,
      { fecha_cierre: ahora, resuelto_remotamente: true },
      { observacion },
    );
    return this.obtener(id_ticket, actor.id_empresa, ahora);
  }

  /**
   * CU-30: "si el problema requiere visita presencial, el ticket queda
   * vinculado a la OT creada y se cierra automaticamente cuando la OT se
   * complete". Lo ultimo lo hace OrdenesService al aprobar el cierre.
   *
   * La OT se crea con `crearOT` y no con un insert propio, asi hereda sus
   * reglas: valida el tecnico, escribe historial y auditoria, y aplica la
   * lista negra. Como `crearOT` busca al cliente por RUT, un ticket sin
   * cliente no se deriva por aca.
   */
  async escalar(
    id_ticket: number,
    dto: { tipo_ot?: string; id_tecnico?: number; bloque_horario?: string; observaciones?: string },
    actor: Actor & { userId: number },
  ) {
    const t = await this.buscar(id_ticket, actor.id_empresa);
    if (t.orden_trabajo) {
      throw new BadRequestException(`El ticket ya está derivado a la OT ${t.orden_trabajo.id_ot}`);
    }
    if (!(TRANSICIONES_TICKET[t.estado as EstadoTicket] ?? []).includes(ESTADO_TICKET.DERIVADO_OT)) {
      throw new BadRequestException(`Un ticket ${t.estado} no se puede derivar a una OT`);
    }
    if (!t.cliente?.rut) {
      throw new BadRequestException('Un ticket sin cliente no se puede derivar a una OT desde aquí');
    }

    const contexto = [`Ticket ${t.codigo_seguimiento} (${t.categoria.nombre})`, t.descripcion].filter(Boolean).join(': ');
    const ot = await this.ordenes.crearOT(
      {
        rut_cliente: t.cliente.rut,
        tipo_ot: dto.tipo_ot ?? 'REPARACION',
        prioridad: t.prioridad,
        id_tecnico: dto.id_tecnico,
        bloque_horario: dto.bloque_horario,
        observaciones: [contexto, dto.observaciones?.trim()].filter(Boolean).join('\n'),
      },
      actor.userId,
      actor.id_empresa,
      { id_ticket },
    );

    await this.transicion(t, ESTADO_TICKET.DERIVADO_OT, actor, {}, { id_ot: ot!.id_ot });
    return this.obtener(id_ticket, actor.id_empresa);
  }

  // ---------------------------------------------------------------------------
  // CU-32
  // ---------------------------------------------------------------------------

  async reclasificar(id_ticket: number, id_categoria: number, actor: Actor, ahora = new Date()) {
    const t = await this.buscar(id_ticket, actor.id_empresa);
    if (!ESTADOS_TICKET_ABIERTOS.includes(t.estado as EstadoTicket)) {
      throw new BadRequestException('Un ticket resuelto no se puede reclasificar');
    }
    if (t.id_categoria === id_categoria) {
      throw new BadRequestException('La categoría seleccionada es la misma que la actual.');
    }
    const nueva = await this.categoria(id_categoria);
    const prioridad = prioridadPorSla(nueva.sla_horas);

    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id_ticket }, data: { id_categoria, prioridad } });
      await tx.log_auditoria.create({
        data: {
          id_usuario: actor.userId,
          accion: 'RECLASIFICAR_TICKET',
          entidad_afectada: 'ticket',
          id_entidad_afectada: id_ticket,
          valor_anterior: {
            id_categoria: t.id_categoria,
            categoria: t.categoria.nombre,
            sla_horas: t.categoria.sla_horas,
            prioridad: t.prioridad,
          },
          valor_nuevo: { id_categoria, categoria: nueva.nombre, sla_horas: nueva.sla_horas, prioridad },
        },
      });
    });
    return this.obtener(id_ticket, actor.id_empresa, ahora);
  }

  // ---------------------------------------------------------------------------

  private async buscar(id_ticket: number, id_empresa: number): Promise<TicketConRelaciones> {
    const t = await this.prisma.ticket.findFirst({ where: { id_ticket, id_empresa }, include: INCLUDE_TICKET });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return t;
  }

  private async categoria(id_categoria: number) {
    const c = await this.prisma.categoria_falla.findUnique({ where: { id_categoria } });
    if (!c) throw new BadRequestException('La categoría no existe');
    return c;
  }

  /**
   * Toda transicion de estado pasa por aca y se valida contra
   * TRANSICIONES_TICKET, no con strings sueltos en cada metodo.
   */
  private async transicion(
    t: TicketConRelaciones,
    destino: EstadoTicket,
    actor: Actor,
    extra: Prisma.ticketUncheckedUpdateInput = {},
    detalle: Record<string, string | number> = {},
  ) {
    const permitidas = TRANSICIONES_TICKET[t.estado as EstadoTicket] ?? [];
    if (!permitidas.includes(destino)) {
      throw new BadRequestException(`Transición de ticket no permitida: ${t.estado} → ${destino}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id_ticket: t.id_ticket }, data: { estado: destino, ...extra } });
      await tx.log_auditoria.create({
        data: {
          id_usuario: actor.userId,
          accion: 'CAMBIAR_ESTADO_TICKET',
          entidad_afectada: 'ticket',
          id_entidad_afectada: t.id_ticket,
          valor_anterior: { estado: t.estado },
          valor_nuevo: { estado: destino, ...detalle },
        },
      });
    });
  }

  /** Suma lo que la Vista necesita para el panel: SLA, vencimiento y antiguedad. */
  private aVista(t: TicketConRelaciones, ahora: Date) {
    const sla_horas = t.categoria?.sla_horas ?? null;
    const vence = sla_horas == null ? null : new Date(t.fecha_creacion.getTime() + sla_horas * HORA_MS);
    const abierto = ESTADOS_TICKET_ABIERTOS.includes(t.estado as EstadoTicket);
    return {
      ...t,
      sla_horas,
      vence_en: vence?.toISOString() ?? null,
      // CU-30, excepcion 1: SLA vencido sin accion → marcado en rojo.
      sla_vencido: abierto && vence !== null && ahora > vence,
      horas_transcurridas: Math.floor((ahora.getTime() - t.fecha_creacion.getTime()) / HORA_MS),
    };
  }
}
