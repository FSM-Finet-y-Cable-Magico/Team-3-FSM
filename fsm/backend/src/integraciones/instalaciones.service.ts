import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ApiScope } from '../common/guards/api-key.guard.js';
import type { SolicitudInstalacionDto } from './dto/solicitud-instalacion.dto.js';

/** Unico grupo que puede pedir instalaciones: el CRM (acuerdo G8↔G3). */
const GRUPO_SOLICITANTE = 'G8';

/** Estado de la solicitud, no de la OT: la OT tiene su propia maquina. */
export const ESTADO_SOLICITUD_OT_CREADA = 'OT_CREADA';

/**
 * JSON canonico: claves ordenadas y sin null ni ausentes. El contrato (§3)
 * dice que un opcional puede venir como null o no venir, asi que las dos
 * formas son el mismo comando y tienen que dar el mismo hash. Sin esto, un
 * reintento legitimo que omite un null responderia 409.
 */
const canonico = (valor: unknown): unknown => {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(
      Object.keys(valor as Record<string, unknown>)
        .sort()
        .filter((k) => (valor as Record<string, unknown>)[k] != null)
        .map((k) => [k, canonico((valor as Record<string, unknown>)[k])]),
    );
  }
  return valor;
};

/**
 * `hash_payload` del acuerdo (§4.1 de nuestra respuesta, aceptado por G8): se
 * compara el hash del payload normalizado en vez de campo por campo, que se
 * desincroniza apenas cualquiera de los dos lados agrega un campo.
 */
export const hashSolicitud = (payload: object): string =>
  createHash('sha256').update(JSON.stringify(canonico(payload))).digest('hex');

type Resultado =
  | {
      creado: true;
      data: { request_id: string; trace_id: string; id_ot: number; tipo_ot: string; estado: string; fecha_creacion: string };
    }
  | { creado: false; data: { request_id: string; id_ot: number | null; estado: string | null; duplicado: true } };

@Injectable()
export class InstalacionesService {
  constructor(private prisma: PrismaService) {}

  /**
   * P0-a: crea la OT de instalacion SIN cliente (Respuesta de G8, §4.4).
   *
   *  - request_id nuevo              → 201, OT nueva.
   *  - mismo request_id, mismo hash  → 200, la OT original con duplicado=true.
   *  - mismo request_id, otro hash   → 409.
   *
   * La direccion del snapshot se materializa como una `direccion_servicio` sin
   * cliente y la OT apunta ahi: la vista de terreno ya pinta `ot.direccion` sin
   * depender del cliente. Todas las lecturas de esa tabla entran por el cliente,
   * asi que una fila sin cliente no aparece en ningun otro lado.
   */
  async crear(scope: ApiScope, dto: SolicitudInstalacionDto): Promise<Resultado> {
    if (scope.grupo !== GRUPO_SOLICITANTE) {
      throw new ForbiddenException(`La API key de ${scope.grupo} no puede solicitar instalaciones`);
    }
    if (!scope.empresas.includes(dto.id_empresa)) {
      throw new ForbiddenException(`La API key de ${scope.grupo} no tiene acceso a la empresa ${dto.id_empresa}`);
    }

    const hash_payload = hashSolicitud(dto);
    const previa = await this.buscar(dto.request_id);
    if (previa) return this.comoReintento(previa, hash_payload);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const direccion = await tx.direccion_servicio.create({
          data: {
            id_cliente: null,
            direccion_completa: dto.direccion.direccion_completa,
            comuna: dto.direccion.comuna,
            ciudad: dto.direccion.ciudad ?? null,
            // No es la direccion principal de nadie: no hay cliente todavia.
            es_principal: false,
          },
        });

        const ot = await tx.orden_trabajo.create({
          data: {
            id_empresa: dto.id_empresa,
            id_cliente: null,
            id_direccion: direccion.id_direccion,
            tipo_ot: 'INSTALACION',
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
            observaciones: `Solicitada por ${scope.grupo} (contrato ${dto.id_contrato})`,
          },
        });

        await tx.log_auditoria.create({
          data: {
            id_usuario: null,
            accion: 'CREAR_OT_INTEGRACION',
            entidad_afectada: 'orden_trabajo',
            id_entidad_afectada: ot.id_ot,
            valor_nuevo: { grupo: scope.grupo, request_id: dto.request_id, trace_id: dto.trace_id },
          },
        });

        await tx.solicitud_instalacion_integracion.create({
          data: {
            request_id: dto.request_id,
            trace_id: dto.trace_id,
            hash_payload,
            id_empresa: dto.id_empresa,
            id_prospecto_externo: dto.id_prospecto,
            id_contrato_externo: dto.id_contrato,
            id_plan_externo: dto.id_plan ?? null,
            rut: dto.persona.rut,
            nombre_completo: dto.persona.nombre_completo,
            telefono: dto.persona.telefono,
            direccion_completa: dto.direccion.direccion_completa,
            comuna: dto.direccion.comuna,
            ciudad: dto.direccion.ciudad ?? null,
            observaciones: dto.observaciones ?? null,
            requisitos_equipamiento: (dto.requisitos_equipamiento ?? []) as Prisma.InputJsonValue,
            id_ot: ot.id_ot,
            estado: ESTADO_SOLICITUD_OT_CREADA,
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

  private buscar(request_id: string) {
    return this.prisma.solicitud_instalacion_integracion.findUnique({
      where: { request_id },
      include: { orden_trabajo: { select: { estado: true } } },
    });
  }

  private comoReintento(
    previa: { request_id: string; hash_payload: string; id_ot: number | null; orden_trabajo: { estado: string } | null },
    hash_payload: string,
  ): Resultado {
    if (previa.hash_payload !== hash_payload) {
      throw new ConflictException(
        `request_id ${previa.request_id} ya se uso con otro contenido. Un reintento debe repetir el mismo payload.`,
      );
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
