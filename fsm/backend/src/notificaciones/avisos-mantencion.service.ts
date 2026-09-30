import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ZONA_OPERACION } from '../common/utils/dia-habil.util.js';
import { CANAL_NOTIFICACION, ESTADO_ENVIO, TIPO_EVENTO } from './notificaciones.constants.js';

/** RF-44: el aviso de una mantencion sale 24 horas antes. */
export const HORAS_ANTICIPACION_MANTENCION = 24;

/** CU-50, excepcion 1, tal cual el CU. */
export const MENSAJE_MENOS_DE_24H =
  'El tiempo disponible es menor a 24 horas. La notificación se enviará de inmediato si confirma.';

/** Aviso esperando su hora. `estado_envio` es VARCHAR(20). */
export const ESTADO_PROGRAMADO = 'PROGRAMADO';

const render = (plantilla: string, datos: Record<string, string | null | undefined>) =>
  plantilla.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, clave: string) => datos[clave] ?? '');

/**
 * CU-50 / RF-44: aviso anticipado de mantencion.
 *
 * Programar deja una fila por cliente en `log_notificacion` con estado
 * PROGRAMADO y `fecha_envio` = cuando se va a enviar (24 h antes de la
 * intervencion). `AvisosMantencionPoller` las emite a esa hora. El envio es
 * SIMULADO como el resto de las notificaciones: no hay proveedor contratado,
 * y registrar "ENVIADO" haria creer que al cliente le llego algo.
 */
@Injectable()
export class AvisosMantencionService {
  private readonly logger = new Logger(AvisosMantencionService.name);

  constructor(private prisma: PrismaService) {}

  async programar(
    id_ot: number,
    dto: { id_plantilla: number; canal?: string; inmediato?: boolean },
    id_empresa: number,
    id_usuario: number,
    ahora = new Date(),
  ) {
    const ot = await this.prisma.orden_trabajo.findFirst({
      where: { id_ot, id_empresa },
      include: { caja_nap: { select: { identificador_unico: true } } },
    });
    if (!ot) throw new NotFoundException('OT no encontrada');
    if (!ot.fecha_programada || ot.fecha_programada <= ahora) {
      throw new BadRequestException('La OT necesita una fecha de intervención futura para avisar');
    }
    if (['COMPLETADA', 'CANCELADA'].includes(ot.estado)) {
      throw new BadRequestException(`Una OT ${ot.estado} no se avisa`);
    }

    const plantilla = await this.prisma.plantilla_notificacion.findUnique({ where: { id_plantilla: dto.id_plantilla } });
    if (!plantilla || (plantilla.id_empresa != null && plantilla.id_empresa !== id_empresa)) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    if (plantilla.tipo_evento !== TIPO_EVENTO.MANTENCION_PROGRAMADA || !plantilla.activa) {
      throw new BadRequestException('La plantilla tiene que ser una de mantención programada, y estar activa');
    }

    const envio = new Date(ot.fecha_programada.getTime() - HORAS_ANTICIPACION_MANTENCION * 3_600_000);
    const inmediato = envio <= ahora;
    if (inmediato && !dto.inmediato) throw new BadRequestException(MENSAJE_MENOS_DE_24H);

    // Los clientes afectados son los de la caja en intervencion. Una OT sin
    // caja avisa a su propio cliente.
    const personas = ot.id_caja_nap
      ? (
          await this.prisma.puerto_nap.findMany({
            where: { id_caja_nap: ot.id_caja_nap, id_cliente_asociado: { not: null }, estado: 'OCUPADO' },
            select: { cliente_asociado: { select: { id_cliente: true, nombre_completo: true, telefono: true, email: true } } },
          })
        )
          .map((p) => p.cliente_asociado)
          .filter((c): c is NonNullable<typeof c> => c !== null)
      : await this.prisma.cliente.findMany({
          where: { id_cliente: ot.id_cliente ?? -1, id_empresa },
          select: { id_cliente: true, nombre_completo: true, telefono: true, email: true },
        });
    const unicos = [...new Map(personas.map((c) => [c.id_cliente, c])).values()];
    const contactables = unicos.filter((c) => c.telefono || c.email);

    const cuando = (opciones: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('es-CL', { timeZone: ZONA_OPERACION, ...opciones }).format(ot.fecha_programada!);
    const estado = inmediato ? ESTADO_ENVIO.SIMULADO : ESTADO_PROGRAMADO;
    const fecha_envio = inmediato ? ahora : envio;
    const canal = dto.canal ?? plantilla.canal ?? CANAL_NOTIFICACION.INTERNO;

    await this.prisma.$transaction(async (tx) => {
      // Reprogramar reemplaza el aviso pendiente: nunca dos por la misma OT.
      await tx.log_notificacion.deleteMany({ where: { id_ot, estado_envio: ESTADO_PROGRAMADO } });
      if (contactables.length) {
        await tx.log_notificacion.createMany({
          data: contactables.map((c) => ({
            id_cliente: c.id_cliente,
            id_ot,
            id_plantilla: plantilla.id_plantilla,
            canal,
            estado_envio: estado,
            fecha_envio,
            mensaje_enviado: render(plantilla.contenido_texto ?? '', {
              cliente: c.nombre_completo,
              caja: ot.caja_nap?.identificador_unico ?? null,
              fecha: cuando({ dateStyle: 'long' }),
              hora: cuando({ hour: '2-digit', minute: '2-digit' }),
            }),
          })),
        });
      }
      await tx.historial_ot.create({
        data: {
          id_ot,
          id_usuario,
          estado_anterior: ot.estado,
          estado_nuevo: ot.estado,
          observaciones: inmediato
            ? `Aviso de mantención enviado de inmediato a ${contactables.length} clientes (simulado)`
            : `Aviso de mantención programado para el ${fecha_envio.toISOString()} a ${contactables.length} clientes`,
        },
      });
    });

    return {
      id_ot,
      estado,
      envio_en: fecha_envio.toISOString(),
      destinatarios: contactables.length,
      sin_contacto: unicos.length - contactables.length,
    };
  }

  /**
   * Lo que llama el poller: emite (SIMULADO) todo aviso cuya hora ya paso y lo
   * deja en el historial de su OT. Devuelve cuantos avisos emitio.
   */
  async enviarVencidos(ahora = new Date()) {
    const where = { estado_envio: ESTADO_PROGRAMADO, fecha_envio: { lte: ahora } };
    const vencidos = await this.prisma.log_notificacion.findMany({ where, select: { id_ot: true } });
    if (vencidos.length === 0) return 0;

    const porOt = new Map<number, number>();
    for (const v of vencidos) if (v.id_ot) porOt.set(v.id_ot, (porOt.get(v.id_ot) ?? 0) + 1);

    await this.prisma.$transaction(async (tx) => {
      await tx.log_notificacion.updateMany({ where, data: { estado_envio: ESTADO_ENVIO.SIMULADO, fecha_envio: ahora } });
      for (const [id_ot, n] of porOt) {
        await tx.historial_ot.create({
          data: { id_ot, id_usuario: null, observaciones: `Aviso de mantención enviado a ${n} clientes (simulado)` },
        });
      }
    });
    this.logger.log(`Avisos de mantención emitidos: ${vencidos.length}`);
    return vencidos.length;
  }

  /** CU-50: el recordatorio del dashboard, los avisos de las proximas 24 h. */
  async proximos(id_empresa: number, ahora = new Date()) {
    const hasta = new Date(ahora.getTime() + HORAS_ANTICIPACION_MANTENCION * 3_600_000);
    const filas = await this.prisma.log_notificacion.findMany({
      where: {
        estado_envio: ESTADO_PROGRAMADO,
        fecha_envio: { gt: ahora, lte: hasta },
        orden_trabajo: { id_empresa },
      },
      select: { id_ot: true, fecha_envio: true },
    });
    const porOt = new Map<number, { id_ot: number; envio_en: Date | null; clientes: number }>();
    for (const f of filas) {
      if (!f.id_ot) continue;
      const e = porOt.get(f.id_ot) ?? { id_ot: f.id_ot, envio_en: f.fecha_envio, clientes: 0 };
      e.clientes++;
      porOt.set(f.id_ot, e);
    }
    return [...porOt.values()];
  }
}
