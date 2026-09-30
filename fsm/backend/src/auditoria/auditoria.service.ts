import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { normalizarPaginacion } from '../common/utils/paginacion.util.js';

/**
 * CU-41 "Consultando el log de auditoría".
 *
 * `log_auditoria` se escribe desde todo el sistema y no tenia ni un endpoint de
 * consulta. Dos cosas la hacen menos obvia de lo que parece, y las dos se
 * deciden acá y no depurando despues.
 *
 * 1 · `id_log` es BigInt. `JSON.stringify` de un BigInt lanza TypeError, asi
 *     que el endpoint entero responderia 500 en cuanto devolviera una fila. Se
 *     serializa a string en el servicio, que ademas es lo correcto: un id de 64
 *     bits no entra en el `number` de JavaScript sin perder precision.
 *
 * 2 · `log_auditoria` NO TIENE `id_empresa`. El aislamiento sale de
 *     `usuario: { id_empresa }`, o sea de un join, y eso descarta en silencio
 *     las filas con `id_usuario` nulo. Hoy son 15 de 638 --intentos de login de
 *     usuarios que no existen, acciones del portal de clientes-- y no se pueden
 *     atribuir a ninguna empresa.
 *
 *     LA DECISION: no se muestran, PERO se informa cuantas se dejaron fuera.
 *     Mostrarlas seria exponer a cualquier ADMIN filas que podrian ser de otra
 *     empresa; esconderlas sin decirlo convertiria un registro de auditoria en
 *     uno incompleto que se ve completo, que es peor que no tenerlo. El arreglo
 *     de fondo es agregarle `id_empresa` a la tabla, y eso es una migracion
 *     sobre una tabla compartida: va en ventana coordinada con G1 y G8.
 *
 * Y una tercera que conviene saber: la tabla es COMPARTIDA. De las 638 filas
 * hay acciones de G8 (`GENERAR_COTIZACION`, `ACTUALIZAR_PIPELINE_PROSPECTO`).
 * El filtro por empresa es lo unico que evita que un ADMIN de G3 vea el negocio
 * de otro grupo.
 */
@Injectable()
export class AuditoriaService {
  constructor(private prisma: PrismaService) {}

  private fecha(valor: string | undefined, campo: string): Date | undefined {
    if (!valor) return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
      throw new BadRequestException(`${campo} inválida: se espera YYYY-MM-DD`);
    }
    const d = new Date(`${valor}T00:00:00.000Z`);
    if (isNaN(d.getTime())) throw new BadRequestException(`${campo} inválida`);
    return d;
  }

  async listar(
    id_empresa: number,
    page?: unknown,
    limit?: unknown,
    filtros: {
      accion?: string;
      entidad?: string;
      id_entidad?: string;
      id_usuario?: string;
      desde?: string;
      hasta?: string;
    } = {},
  ) {
    const { page: p, limit: l, skip } = normalizarPaginacion(page, limit);

    // El filtro por empresa va sobre la relacion, que es la unica forma:
    // `log_auditoria` no tiene la columna.
    const where: Prisma.log_auditoriaWhereInput = { usuario: { id_empresa } };

    if (filtros.accion) where.accion = { contains: filtros.accion.trim(), mode: 'insensitive' };
    if (filtros.entidad) where.entidad_afectada = { equals: filtros.entidad.trim(), mode: 'insensitive' };
    if (filtros.id_entidad) where.id_entidad_afectada = Number(filtros.id_entidad);
    if (filtros.id_usuario) where.id_usuario = Number(filtros.id_usuario);

    const desde = this.fecha(filtros.desde, 'desde');
    const hasta = this.fecha(filtros.hasta, 'hasta');
    if (desde || hasta) {
      if (desde && hasta && hasta < desde) {
        throw new BadRequestException('hasta no puede ser anterior a desde');
      }
      where.fecha_hora = {
        ...(desde ? { gte: desde } : {}),
        // `hasta` es inclusivo para quien consulta, asi que el limite es el
        // dia siguiente a medianoche. Con `lte` sobre la medianoche del propio
        // dia se perderia todo lo ocurrido despues de las 00:00.
        ...(hasta ? { lt: new Date(hasta.getTime() + 86_400_000) } : {}),
      };
    }

    const [filas, total, sin_usuario] = await Promise.all([
      this.prisma.log_auditoria.findMany({
        where,
        include: { usuario: { select: { id_usuario: true, nombre_completo: true, nombre_usuario: true } } },
        orderBy: { fecha_hora: 'desc' },
        skip,
        take: l,
      }),
      this.prisma.log_auditoria.count({ where }),
      // Se cuenta aparte para poder declarar lo que queda fuera. Sin este
      // numero, el registro se veria completo sin serlo.
      this.prisma.log_auditoria.count({ where: { id_usuario: null } }),
    ]);

    return {
      data: filas.map((f) => this.vista(f)),
      total,
      page: p,
      limit: l,
      /**
       * Filas que ninguna empresa puede reclamar, y por eso no se muestran.
       * Va en la respuesta para que quien audita sepa que existen en vez de
       * creer que esta viendo todo.
       */
      excluidas_sin_usuario: sin_usuario,
    };
  }

  private vista(f: Record<string, any>) {
    return {
      // A string, no a number: `id_log` es BigInt y ademas de romper
      // `JSON.stringify` no entraria en el `number` de JS sin perder precision.
      id_log: f.id_log.toString(),
      accion: f.accion,
      entidad_afectada: f.entidad_afectada,
      id_entidad_afectada: f.id_entidad_afectada,
      valor_anterior: f.valor_anterior,
      valor_nuevo: f.valor_nuevo,
      ip_origen: f.ip_origen,
      fecha_hora: f.fecha_hora,
      usuario: f.usuario
        ? {
            id_usuario: f.usuario.id_usuario,
            nombre_completo: f.usuario.nombre_completo,
            nombre_usuario: f.usuario.nombre_usuario,
          }
        : null,
    };
  }

  /**
   * Acciones distintas que existen para esta empresa, para poblar el filtro de
   * la Vista. Se calculan y no se codifican a mano porque la tabla la escriben
   * los tres grupos: una lista fija quedaria incompleta en cuanto G1 o G8
   * agreguen una accion.
   */
  async acciones(id_empresa: number) {
    const filas = await this.prisma.log_auditoria.groupBy({
      by: ['accion'],
      where: { usuario: { id_empresa } },
      _count: { accion: true },
      orderBy: { _count: { accion: 'desc' } },
    });
    return filas.map((f) => ({ accion: f.accion, veces: f._count.accion }));
  }
}
