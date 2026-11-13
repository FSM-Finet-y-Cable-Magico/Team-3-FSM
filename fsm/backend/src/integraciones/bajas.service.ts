import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiScope } from '../common/guards/api-key.guard.js';
import { variantesRut } from '../common/utils/rut.util.js';
import { TIPO_OT_BAJA } from '../ordenes/fan-out/momento-fan-out.js';
import { hashSolicitud } from './instalaciones.service.js';
import { ESTADO_PUERTO } from '../planta-externa/dto/editar-topologia.dto.js';
import type { CancelarBajaDto, SolicitudBajaDto } from './dto/solicitud-baja.dto.js';

/** Unico grupo que puede pedir retiros: el CRM (acuerdo G8↔G3). */
const GRUPO_SOLICITANTE = 'G8';

/** Estados de la SOLICITUD. La OT tiene su propia maquina, aparte. */
export const ESTADO_SOLICITUD_BAJA_OT_CREADA = 'OT_CREADA';
export const ESTADO_SOLICITUD_BAJA_CANCELADA = 'CANCELADA';

/**
 * Estados en los que todavia se puede cancelar un retiro.
 *
 * Se corta antes de `PENDIENTE_APROBACION` a proposito: en ese punto el tecnico
 * ya estuvo en el domicilio y los equipos ya salieron. Lo que G8 necesitaria ahi
 * no es cancelar sino reponer el servicio, y eso es una instalacion nueva con su
 * propia OT. Dejarlo pasar como `CANCELADA` escondería un retiro que de verdad
 * ocurrio detras de un estado que dice que no ocurrio.
 */
export const ESTADOS_CANCELABLES = ['PENDIENTE', 'ASIGNADA', 'EN_CURSO', 'PENDIENTE_CLIENTE_AUSENTE'];

/** Una OT de baja sigue viva mientras no se complete ni se cancele. */
const ESTADOS_BAJA_ACTIVA = [
  'PENDIENTE',
  'ASIGNADA',
  'EN_CURSO',
  'PENDIENTE_CLIENTE_AUSENTE',
  'PENDIENTE_APROBACION',
];

/**
 * Compara comunas sin que una tilde o una mayuscula provoquen un rechazo.
 * "Ñuñoa", "ÑUÑOA" y "nunoa" son la misma comuna, y G8 no normaliza igual que
 * nosotros: rechazar por eso seria inventar un problema.
 */
const comunaNormalizada = (v: string): string =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

type ResultadoCreacion =
  | {
      creado: true;
      data: {
        request_id: string;
        trace_id: string;
        id_ot: number;
        tipo_ot: string;
        estado: string;
        fecha_creacion: string;
      };
    }
  | { creado: false; data: { request_id: string; id_ot: number | null; estado: string | null; duplicado: true } };

@Injectable()
export class BajasService {
  constructor(private prisma: PrismaService) {}

  /**
   * G8 pide la OT de retiro por morosidad (acuerdo del 12-11-2026).
   *
   *  - request_id nuevo              → 201, OT nueva en PENDIENTE.
   *  - mismo request_id, mismo hash  → 200, la OT original con duplicado=true.
   *  - mismo request_id, otro hash   → 409 REQUEST_ID_CON_OTRO_CONTENIDO.
   *
   * A diferencia de una instalacion, una baja SIEMPRE es sobre un cliente que ya
   * existe: se busca por RUT y la OT cuelga de el y de su direccion principal.
   * La direccion que manda G8 queda como evidencia de lo que se pidio, no como
   * la direccion a la que va el tecnico (ver `validarDireccion`).
   */
  async crear(scope: ApiScope, dto: SolicitudBajaDto): Promise<ResultadoCreacion> {
    if (scope.grupo !== GRUPO_SOLICITANTE) {
      throw new ForbiddenException({
        codigo: 'EMPRESA_NO_CORRESPONDE',
        message: `La API key de ${scope.grupo} no puede solicitar retiros`,
      });
    }
    if (!scope.empresas.includes(dto.id_empresa)) {
      throw new ForbiddenException({
        codigo: 'EMPRESA_NO_CORRESPONDE',
        message: `La API key de ${scope.grupo} no tiene acceso a la empresa ${dto.id_empresa}`,
      });
    }

    // El `request_id` lleva la empresa dentro. Si no coincide con `id_empresa`,
    // la clave esta mal armada: la OT se crearia bien y el flujo se rompería tres
    // pasos despues, cuando G8 consulte a G1 por un request_id que no existe.
    const empresaEnClave = Number(dto.request_id.split('-')[2]);
    if (empresaEnClave !== dto.id_empresa) {
      throw new BadRequestException({
        codigo: 'REQUEST_ID_INCONSISTENTE',
        message: `request_id declara la empresa ${empresaEnClave} y el cuerpo la ${dto.id_empresa}`,
      });
    }

    const hash_payload = hashSolicitud(dto);
    const previa = await this.buscar(dto.request_id);
    if (previa) return this.comoReintento(previa, hash_payload);

    const cliente = await this.prisma.cliente.findFirst({
      where: { rut: { in: variantesRut(dto.rut_cliente) }, id_empresa: dto.id_empresa },
      select: {
        id_cliente: true,
        direcciones: {
          where: { es_principal: true },
          select: { id_direccion: true, comuna: true },
          take: 1,
        },
      },
    });
    if (!cliente) {
      throw new NotFoundException({
        codigo: 'CLIENTE_NO_ENCONTRADO',
        message: `Cliente ${dto.rut_cliente} no encontrado en la empresa ${dto.id_empresa}`,
      });
    }

    const direccion = cliente.direcciones[0];
    this.validarDireccion(dto, direccion);

    const activa = await this.prisma.orden_trabajo.findFirst({
      where: {
        id_empresa: dto.id_empresa,
        id_cliente: cliente.id_cliente,
        tipo_ot: TIPO_OT_BAJA,
        estado: { in: ESTADOS_BAJA_ACTIVA },
      },
      select: { id_ot: true, estado: true },
    });
    if (activa) {
      throw new ConflictException({
        codigo: 'OT_BAJA_ACTIVA',
        message: `El cliente ya tiene la OT de baja ${activa.id_ot} en ${activa.estado}`,
        id_ot: activa.id_ot,
        estado: activa.estado,
      });
    }

    // Sin la caja, aprobar el retiro no libera el puerto: `moverPuerto` la necesita.
    const id_caja_nap = await this.cajaDelCliente(cliente.id_cliente, dto.id_empresa);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const ot = await tx.orden_trabajo.create({
          data: {
            id_empresa: dto.id_empresa,
            id_cliente: cliente.id_cliente,
            id_direccion: direccion?.id_direccion ?? null,
            id_caja_nap,
            tipo_ot: TIPO_OT_BAJA,
            // Un retiro no compite con una reparacion sin servicio: el cliente
            // ya esta suspendido y nadie se queda sin internet por esperar.
            prioridad: 'MEDIA',
            estado: 'PENDIENTE',
            fecha_creacion: new Date(),
            observaciones: dto.observaciones ?? null,
          },
        });

        await tx.historial_ot.create({
          data: {
            id_ot: ot.id_ot,
            id_usuario: null,
            estado_anterior: null,
            estado_nuevo: 'PENDIENTE',
            observaciones: `Retiro por morosidad solicitado por ${scope.grupo} (servicio ${dto.id_servicio_externo})`,
          },
        });

        await tx.log_auditoria.create({
          data: {
            id_usuario: null,
            accion: 'CREAR_OT_BAJA_INTEGRACION',
            entidad_afectada: 'orden_trabajo',
            id_entidad_afectada: ot.id_ot,
            valor_nuevo: { grupo: scope.grupo, request_id: dto.request_id, trace_id: dto.trace_id },
          },
        });

        await tx.solicitud_baja_integracion.create({
          data: {
            request_id: dto.request_id,
            trace_id: dto.trace_id,
            hash_payload,
            id_empresa: dto.id_empresa,
            id_cliente_externo: dto.id_cliente_externo,
            id_contrato_externo: dto.id_contrato_externo,
            id_servicio_externo: dto.id_servicio_externo,
            id_solicitud_retiro_externa: dto.id_solicitud_retiro_externa,
            id_ticket_externo: dto.id_ticket_externo ?? null,
            rut_cliente: dto.rut_cliente,
            direccion_retiro: dto.direccion_retiro,
            comuna_retiro: dto.comuna_retiro,
            observaciones: dto.observaciones ?? null,
            id_ot: ot.id_ot,
            estado: ESTADO_SOLICITUD_BAJA_OT_CREADA,
          },
        });

        return {
          creado: true as const,
          data: {
            request_id: dto.request_id,
            trace_id: dto.trace_id,
            id_ot: ot.id_ot,
            tipo_ot: ot.tipo_ot,
            estado: ot.estado,
            fecha_creacion: ot.fecha_creacion.toISOString(),
          },
        };
      });
    } catch (e) {
      // Dos llamadas con el mismo request_id en paralelo: las dos pasaron el
      // findUnique y el UNIQUE rechazo a la segunda, cuya transaccion se deshizo
      // entera (sin OT huerfana). Se responde como el reintento que es.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const ganadora = await this.buscar(dto.request_id);
        if (ganadora) return this.comoReintento(ganadora, hash_payload);
      }
      throw e;
    }
  }

  /**
   * El cliente pago con el retiro en curso y G8 pide detenerlo.
   *
   * Se identifica por `request_id` y no por `id_ot`: es la clave que G8 tiene en
   * la mano, y la OT es un id nuestro que podria no haber alcanzado a guardar.
   */
  async cancelar(scope: ApiScope, request_id: string, dto: CancelarBajaDto) {
    if (scope.grupo !== GRUPO_SOLICITANTE) {
      throw new ForbiddenException({
        codigo: 'EMPRESA_NO_CORRESPONDE',
        message: `La API key de ${scope.grupo} no puede cancelar retiros`,
      });
    }

    const solicitud = await this.buscar(request_id);
    if (!solicitud) {
      throw new NotFoundException({
        codigo: 'SOLICITUD_NO_ENCONTRADA',
        message: `No hay una solicitud de retiro con request_id ${request_id}`,
      });
    }
    if (!scope.empresas.includes(solicitud.id_empresa)) {
      throw new ForbiddenException({
        codigo: 'EMPRESA_NO_CORRESPONDE',
        message: `La API key de ${scope.grupo} no tiene acceso a la empresa ${solicitud.id_empresa}`,
      });
    }

    const estadoOt = solicitud.orden_trabajo?.estado ?? null;
    if (solicitud.id_ot == null || estadoOt == null) {
      throw new ConflictException({
        codigo: 'CANCELACION_NO_APLICABLE',
        message: 'La solicitud no tiene una OT asociada',
        estado: null,
      });
    }
    // Idempotente: cancelar dos veces no es un error, es el mismo resultado.
    if (estadoOt === 'CANCELADA') {
      return { request_id, id_ot: solicitud.id_ot, estado: estadoOt, duplicado: true as const };
    }
    if (!ESTADOS_CANCELABLES.includes(estadoOt)) {
      throw new ConflictException({
        codigo: 'CANCELACION_NO_APLICABLE',
        message:
          `La OT ${solicitud.id_ot} esta en ${estadoOt}: el tecnico ya retiro los equipos. ` +
          'Reponer el servicio es una instalacion nueva, no una cancelacion de este retiro.',
        id_ot: solicitud.id_ot,
        estado: estadoOt,
      });
    }

    const id_ot = solicitud.id_ot;
    await this.prisma.$transaction(async (tx) => {
      await tx.orden_trabajo.update({
        where: { id_ot },
        data: { estado: 'CANCELADA', observaciones: dto.motivo },
      });
      // El puerto NAP NO se toca: el cliente sigue con servicio y su puerto
      // tiene que seguir OCUPADO. Es el mismo criterio que `cambiarEstado`.
      await tx.historial_ot.create({
        data: {
          id_ot,
          id_usuario: null,
          estado_anterior: estadoOt,
          estado_nuevo: 'CANCELADA',
          observaciones: `Retiro cancelado por ${scope.grupo}: ${dto.motivo}`,
        },
      });
      await tx.log_auditoria.create({
        data: {
          id_usuario: null,
          accion: 'CANCELAR_OT_BAJA_INTEGRACION',
          entidad_afectada: 'orden_trabajo',
          id_entidad_afectada: id_ot,
          valor_anterior: { estado: estadoOt },
          valor_nuevo: { estado: 'CANCELADA', motivo: dto.motivo, request_id },
        },
      });
      await tx.solicitud_baja_integracion.update({
        where: { request_id },
        data: { estado: ESTADO_SOLICITUD_BAJA_CANCELADA, motivo_cancelacion: dto.motivo },
      });
    });

    return { request_id, id_ot, estado: 'CANCELADA' as const, duplicado: false as const };
  }

  /**
   * La comuna de G8 tiene que coincidir con la del cliente en nuestra base.
   *
   * Se compara la comuna y no la calle: las direcciones se escriben distinto en
   * los dos sistemas ("Av. Matta 123" contra "Avenida Matta 123") y rechazar por
   * eso bloquearia retiros legitimos. La comuna, en cambio, es un valor acotado:
   * si no calza, lo mas probable es que G8 este apuntando a otro servicio, y ahi
   * es mejor no mandar a nadie a sacarle los equipos a quien no corresponde.
   */
  private validarDireccion(dto: SolicitudBajaDto, direccion: { comuna: string } | undefined) {
    if (!direccion) {
      throw new UnprocessableEntityException({
        codigo: 'DIRECCION_INVALIDA',
        message: `El cliente ${dto.rut_cliente} no tiene direccion principal registrada`,
      });
    }
    if (comunaNormalizada(direccion.comuna) !== comunaNormalizada(dto.comuna_retiro)) {
      throw new UnprocessableEntityException({
        codigo: 'DIRECCION_INVALIDA',
        message:
          `comuna_retiro "${dto.comuna_retiro}" no coincide con la comuna del servicio ` +
          `("${direccion.comuna}"). Verificar que el servicio sea el correcto.`,
      });
    }
  }

  /**
   * La caja del cliente: la que mas se repite entre sus ONT (lo que dice
   * SmartOLT) y, si no tiene ninguna ligada, la de su puerto OCUPADO. Null si
   * no se sabe; la OT sale igual, como antes.
   */
  private async cajaDelCliente(id_cliente: number, id_empresa: number): Promise<number | null> {
    const onts = await this.prisma.registro_ont.findMany({
      where: { id_cliente, id_empresa, id_caja_nap: { not: null } },
      select: { id_caja_nap: true },
    });
    if (onts.length > 0) {
      const veces = new Map<number, number>();
      for (const o of onts) veces.set(o.id_caja_nap!, (veces.get(o.id_caja_nap!) ?? 0) + 1);
      return [...veces].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    }
    const puerto = await this.prisma.puerto_nap.findFirst({
      where: { id_cliente_asociado: id_cliente, estado: ESTADO_PUERTO.OCUPADO, id_caja_nap: { not: null } },
      orderBy: { id_puerto: 'asc' },
      select: { id_caja_nap: true },
    });
    return puerto?.id_caja_nap ?? null;
  }

  private buscar(request_id: string) {
    return this.prisma.solicitud_baja_integracion.findUnique({
      where: { request_id },
      include: { orden_trabajo: { select: { estado: true } } },
    });
  }

  private comoReintento(
    previa: {
      request_id: string;
      hash_payload: string;
      id_ot: number | null;
      orden_trabajo: { estado: string } | null;
    },
    hash_payload: string,
  ): ResultadoCreacion {
    if (previa.hash_payload !== hash_payload) {
      throw new ConflictException({
        codigo: 'REQUEST_ID_CON_OTRO_CONTENIDO',
        message: `request_id ${previa.request_id} ya se uso con otro contenido. Un reintento debe repetir el mismo payload.`,
      });
    }
    return {
      creado: false,
      data: {
        request_id: previa.request_id,
        id_ot: previa.id_ot,
        // El estado ACTUAL de la OT, no el de cuando se creo: a G8 le sirve mas.
        estado: previa.orden_trabajo?.estado ?? null,
        duplicado: true,
      },
    };
  }
}
