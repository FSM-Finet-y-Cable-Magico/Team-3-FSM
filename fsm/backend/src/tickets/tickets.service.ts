import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { normalizarPaginacion } from '../common/utils/paginacion.util.js';
import { CrearTicketDto } from './dto/crear-ticket.dto.js';
import { GestionarTicketDto, ReclasificarTicketDto } from './dto/gestionar-ticket.dto.js';
import {
  ESTADO_TICKET,
  ESTADOS_ABIERTOS,
  ORIGEN_POR_DEFECTO,
  PRIORIDAD_POR_DEFECTO,
  TRANSICIONES_TICKET,
  generarCodigoSeguimiento,
  normalizarEstado,
  normalizarOrigen,
  normalizarPrioridad,
  type EstadoTicket,
} from './tickets.constants.js';

/** Cuántas veces se reintenta si el código de seguimiento choca. */
const INTENTOS_CODIGO = 5;

const CON_RELACIONES = {
  cliente: { select: { id_cliente: true, rut: true, nombre_completo: true, telefono: true } },
  usuario_asignado: { select: { id_usuario: true, nombre_completo: true } },
  categoria: { select: { id_categoria: true, nombre: true, sla_horas: true } },
  orden_trabajo: { select: { id_ot: true, estado: true } },
} as const;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------- helpers

  /**
   * Forma con la que el ticket sale del modulo.
   *
   * Normaliza los vocabularios porque hay 10 filas escritas antes de este
   * modulo, con la caja inconsistente. Si el valor no se reconoce se devuelve
   * el crudo en vez de `null`: es una fila vieja, no un error, y esconderla
   * seria peor que mostrarla como esta.
   */
  private vista(t: Record<string, any>) {
    const sla_horas = t.categoria?.sla_horas ?? null;
    const vence_en =
      sla_horas != null ? new Date(t.fecha_creacion.getTime() + sla_horas * 3_600_000) : null;
    const estado = normalizarEstado(t.estado) ?? t.estado;

    return {
      id_ticket: t.id_ticket,
      codigo_seguimiento: t.codigo_seguimiento,
      estado,
      prioridad: normalizarPrioridad(t.prioridad) ?? t.prioridad,
      origen: normalizarOrigen(t.origen) ?? t.origen,
      descripcion: t.descripcion,
      resuelto_remotamente: t.resuelto_remotamente,
      fecha_creacion: t.fecha_creacion,
      fecha_cierre: t.fecha_cierre,
      cliente: t.cliente ?? null,
      usuario_asignado: t.usuario_asignado ?? null,
      categoria: t.categoria
        ? { id_categoria: t.categoria.id_categoria, nombre: t.categoria.nombre }
        : null,
      orden_trabajo: t.orden_trabajo ?? null,
      /**
       * El SLA es DERIVADO, no una columna. `ticket` no tiene fecha limite y
       * `categoria_falla.sla_horas` es la unica fuente. Asi, reclasificar
       * recalcula el plazo sin tener que reescribir nada, que es justo lo que
       * pide CU-32.
       *
       * Un ticket ya cerrado se mide contra su `fecha_cierre` y no contra el
       * reloj: si no, todo ticket viejo aparecería vencido para siempre.
       */
      sla: {
        horas: sla_horas,
        vence_en,
        vencido:
          vence_en == null ? false : (t.fecha_cierre ?? new Date()).getTime() > vence_en.getTime(),
      },
    };
  }

  /** Busca el ticket dentro de la empresa. Es el unico punto de aislamiento. */
  private async exigirTicket(id_ticket: number, id_empresa: number) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id_ticket, id_empresa },
      include: CON_RELACIONES,
    });
    // 404 y no 403: si respondiera 403, el que pregunta sabria que el ticket
    // existe en otra empresa. Mismo criterio que el resto del sistema.
    if (!ticket) throw new NotFoundException(`Ticket ${id_ticket} no encontrado`);
    return ticket;
  }

  private async exigirCategoria(id_categoria: number) {
    const categoria = await this.prisma.categoria_falla.findUnique({
      where: { id_categoria },
      select: { id_categoria: true, nombre: true, sla_horas: true },
    });
    if (!categoria) throw new NotFoundException(`Categoría ${id_categoria} no encontrada`);
    return categoria;
  }

  // ------------------------------------------------- CU-30 parte 1 · lectura

  async listarTickets(
    id_empresa: number,
    page?: unknown,
    limit?: unknown,
    filtros: {
      estado?: string;
      prioridad?: string;
      id_categoria?: string;
      id_usuario_asignado?: string;
      codigo?: string;
      abiertos?: string;
    } = {},
  ) {
    const { page: p, limit: l, skip } = normalizarPaginacion(page, limit);

    const where: Prisma.ticketWhereInput = { id_empresa };

    if (filtros.estado) {
      const estado = normalizarEstado(filtros.estado);
      if (!estado) throw new BadRequestException(`Estado desconocido: ${filtros.estado}`);
      // `mode: insensitive` por las filas antiguas: un ticket guardado como
      // "Abierto" tiene que salir cuando se filtra por ABIERTO.
      where.estado = { equals: estado, mode: 'insensitive' };
    } else if (filtros.abiertos === 'true') {
      where.estado = { in: ESTADOS_ABIERTOS, mode: 'insensitive' };
    }

    if (filtros.prioridad) {
      const prioridad = normalizarPrioridad(filtros.prioridad);
      if (!prioridad) throw new BadRequestException(`Prioridad desconocida: ${filtros.prioridad}`);
      where.prioridad = { equals: prioridad, mode: 'insensitive' };
    }
    if (filtros.id_categoria) where.id_categoria = Number(filtros.id_categoria);
    if (filtros.id_usuario_asignado) {
      where.id_usuario_asignado = Number(filtros.id_usuario_asignado);
    }
    if (filtros.codigo) {
      where.codigo_seguimiento = { contains: filtros.codigo.trim(), mode: 'insensitive' };
    }

    const [filas, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: CON_RELACIONES,
        orderBy: { fecha_creacion: 'desc' },
        skip,
        take: l,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { data: filas.map((t) => this.vista(t)), total, page: p, limit: l };
  }

  async obtenerTicket(id_ticket: number, id_empresa: number) {
    return this.vista(await this.exigirTicket(id_ticket, id_empresa));
  }

  // --------------------------------------------------- CU-29 · creación

  async crearTicket(dto: CrearTicketDto, id_usuario: number, id_empresa: number) {
    await this.exigirCategoria(dto.id_categoria);

    if (dto.id_cliente != null) {
      const cliente = await this.prisma.cliente.findFirst({
        where: { id_cliente: dto.id_cliente, id_empresa },
        select: { id_cliente: true },
      });
      if (!cliente) throw new NotFoundException(`Cliente ${dto.id_cliente} no encontrado`);
    }

    if (dto.id_usuario_asignado != null) {
      await this.exigirUsuarioDeLaEmpresa(dto.id_usuario_asignado, id_empresa);
    }

    const base = {
      id_empresa,
      id_categoria: dto.id_categoria,
      id_cliente: dto.id_cliente ?? null,
      id_usuario_asignado: dto.id_usuario_asignado ?? null,
      descripcion: dto.descripcion.trim(),
      prioridad: normalizarPrioridad(dto.prioridad) ?? PRIORIDAD_POR_DEFECTO,
      origen: normalizarOrigen(dto.origen) ?? ORIGEN_POR_DEFECTO,
      // Asignar al crear no lo pone en atencion solo: quien lo recibe tiene que
      // tomarlo. Asi "asignado" y "en curso" no se confunden en el tablero.
      estado: ESTADO_TICKET.ABIERTO,
    };

    // `codigo_seguimiento` es @unique. La probabilidad de choque es minima
    // --32^5 por mes-- pero minima no es nula, y un 500 por una colision seria
    // un error imposible de reproducir. Se reintenta con un codigo nuevo.
    for (let intento = 1; intento <= INTENTOS_CODIGO; intento++) {
      const codigo_seguimiento = generarCodigoSeguimiento();
      try {
        const creado = await this.prisma.$transaction(async (tx) => {
          const fila = await tx.ticket.create({
            data: { ...base, codigo_seguimiento },
            include: CON_RELACIONES,
          });
          await tx.log_auditoria.create({
            data: {
              id_usuario,
              accion: 'CREAR_TICKET',
              entidad_afectada: 'ticket',
              id_entidad_afectada: fila.id_ticket,
              valor_nuevo: { codigo_seguimiento, estado: base.estado, prioridad: base.prioridad },
              fecha_hora: new Date(),
            },
          });
          return fila;
        });

        this.logger.log(`Ticket ${creado.id_ticket} creado (${codigo_seguimiento})`);
        return this.vista(creado);
      } catch (e) {
        const choqueDeCodigo =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          String(e.meta?.target ?? '').includes('codigo_seguimiento');
        if (!choqueDeCodigo) throw e;
        this.logger.warn(`Código ${codigo_seguimiento} ya existía; reintento ${intento}`);
      }
    }

    throw new ConflictException(
      'No se pudo generar un código de seguimiento único. Intenta nuevamente',
    );
  }

  private async exigirUsuarioDeLaEmpresa(id_usuario: number, id_empresa: number) {
    const usuario = await this.prisma.usuario.findFirst({
      where: { id_usuario, id_empresa, activo: true },
      select: { id_usuario: true },
    });
    // Incluye `activo`: asignarle un ticket a una cuenta desactivada por CU-43
    // es mandarlo a un buzon que nadie mira.
    if (!usuario) {
      throw new NotFoundException(`Usuario ${id_usuario} no encontrado o inactivo`);
    }
    return usuario;
  }

  // ------------------------------------------------ CU-30 parte 2 · gestión

  async gestionar(
    id_ticket: number,
    dto: GestionarTicketDto,
    id_usuario: number,
    id_empresa: number,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No se envió ningún campo para actualizar');
    }

    const ticket = await this.exigirTicket(id_ticket, id_empresa);
    const estadoActual = (normalizarEstado(ticket.estado) ?? ESTADO_TICKET.ABIERTO) as EstadoTicket;

    if (estadoActual === ESTADO_TICKET.CERRADO) {
      throw new ConflictException('Un ticket cerrado no admite cambios');
    }

    // `Unchecked` y no `ticketUpdateInput`: esta variante acepta las claves
    // foraneas escalares (`id_usuario_asignado`) en vez de exigir un `connect`,
    // que es lo que hace falta para poder desasignar con null.
    const data: Prisma.ticketUncheckedUpdateInput = {};

    if (dto.id_usuario_asignado !== undefined) {
      if (dto.id_usuario_asignado === null) {
        data.id_usuario_asignado = null;
      } else {
        await this.exigirUsuarioDeLaEmpresa(dto.id_usuario_asignado, id_empresa);
        data.id_usuario_asignado = dto.id_usuario_asignado;
      }
    }

    if (dto.prioridad !== undefined) {
      data.prioridad = normalizarPrioridad(dto.prioridad)!;
    }
    if (dto.resuelto_remotamente !== undefined) {
      data.resuelto_remotamente = dto.resuelto_remotamente;
    }
    if (dto.nota) {
      const sello = new Date().toISOString().slice(0, 16).replace('T', ' ');
      data.descripcion = `${ticket.descripcion ?? ''}\n\n[${sello}] ${dto.nota.trim()}`.trim();
    }

    let estadoNuevo: EstadoTicket | undefined;
    if (dto.estado !== undefined) {
      estadoNuevo = normalizarEstado(dto.estado)!;
      if (estadoNuevo !== estadoActual) {
        const permitidas = TRANSICIONES_TICKET[estadoActual] ?? [];
        if (!permitidas.includes(estadoNuevo)) {
          throw new ConflictException(
            `No se puede pasar de ${estadoActual} a ${estadoNuevo}. ` +
              `Desde ${estadoActual} solo se puede ir a: ${permitidas.join(', ') || 'ningún estado'}`,
          );
        }
        data.estado = estadoNuevo;
        // `fecha_cierre` se sella acá y en ningún otro lado: es lo que
        // distingue un ticket cerrado de uno que solo dice estarlo.
        if (estadoNuevo === ESTADO_TICKET.CERRADO) data.fecha_cierre = new Date();
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No hay nada que cambiar');
    }

    const actualizado = await this.prisma.$transaction(async (tx) => {
      const fila = await tx.ticket.update({
        where: { id_ticket },
        data,
        include: CON_RELACIONES,
      });
      await tx.log_auditoria.create({
        data: {
          id_usuario,
          accion: 'GESTIONAR_TICKET',
          entidad_afectada: 'ticket',
          id_entidad_afectada: id_ticket,
          valor_anterior: {
            estado: estadoActual,
            prioridad: ticket.prioridad,
            id_usuario_asignado: ticket.id_usuario_asignado,
            resuelto_remotamente: ticket.resuelto_remotamente,
          },
          valor_nuevo: data as Prisma.InputJsonValue,
          fecha_hora: new Date(),
        },
      });
      return fila;
    });

    return this.vista(actualizado);
  }

  // ------------------------------------------- CU-32 · reclasificación

  async reclasificar(
    id_ticket: number,
    dto: ReclasificarTicketDto,
    id_usuario: number,
    id_empresa: number,
  ) {
    const ticket = await this.exigirTicket(id_ticket, id_empresa);
    const estadoActual = normalizarEstado(ticket.estado) ?? ticket.estado;

    // Reclasificar mueve el SLA. Hacerlo sobre un ticket cerrado cambiaría
    // hacia atrás si se cumplió o no el plazo comprometido.
    if (estadoActual === ESTADO_TICKET.CERRADO) {
      throw new ConflictException('Un ticket cerrado no se puede reclasificar');
    }

    if (ticket.id_categoria === dto.id_categoria) {
      throw new ConflictException('El ticket ya está en esa categoría');
    }

    const nueva = await this.exigirCategoria(dto.id_categoria);
    const anterior = ticket.categoria;

    const actualizado = await this.prisma.$transaction(async (tx) => {
      const fila = await tx.ticket.update({
        where: { id_ticket },
        data: { id_categoria: dto.id_categoria },
        include: CON_RELACIONES,
      });
      await tx.log_auditoria.create({
        data: {
          id_usuario,
          accion: 'RECLASIFICAR_TICKET',
          entidad_afectada: 'ticket',
          id_entidad_afectada: id_ticket,
          // Se guarda el SLA además de la categoría: el plazo comprometido es
          // lo que de verdad cambia, y `categoria_falla.sla_horas` puede
          // editarse después, con lo que el registro dejaría de reconstruirse.
          valor_anterior: {
            id_categoria: anterior?.id_categoria ?? null,
            nombre: anterior?.nombre ?? null,
            sla_horas: anterior?.sla_horas ?? null,
          },
          valor_nuevo: {
            id_categoria: nueva.id_categoria,
            nombre: nueva.nombre,
            sla_horas: nueva.sla_horas,
            motivo: dto.motivo.trim(),
          },
          fecha_hora: new Date(),
        },
      });
      return fila;
    });

    this.logger.log(
      `Ticket ${id_ticket} reclasificado de ${anterior?.nombre} a ${nueva.nombre} por ${id_usuario}`,
    );

    return this.vista(actualizado);
  }
}
