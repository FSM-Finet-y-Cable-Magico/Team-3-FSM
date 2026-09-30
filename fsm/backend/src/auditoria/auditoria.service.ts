import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizarPaginacion } from '../common/utils/paginacion.util.js';
import { rangoDiaOperacion, ZONA_OPERACION } from '../common/utils/dia-habil.util.js';

export interface FiltrosAuditoria {
  id_usuario?: string;
  /** CREACION, MODIFICACION o ELIMINACION (CU-41). */
  tipo?: string;
  accion?: string;
  entidad?: string;
  /** Dias YYYY-MM-DD, inclusivos, en la zona de operacion. */
  desde?: string;
  hasta?: string;
  page?: string;
  limit?: string;
}

/**
 * `accion` es texto libre (CREAR_OT, EDITAR_CLIENTE, DESACTIVAR_USUARIO...).
 * CU-41 filtra por tipo de accion, asi que el tipo se traduce al prefijo del
 * verbo con que se escriben.
 */
const PREFIJOS_CREACION = ['CREAR'];
const PREFIJOS_ELIMINACION = ['DESACTIVAR', 'ELIMINAR'];
const TIPOS = ['CREACION', 'MODIFICACION', 'ELIMINACION'];

/** Tope de la exportacion: un Excel mas grande no lo abre nadie. */
const MAX_FILAS_EXPORTACION = 10_000;
const LIMITE_POR_DEFECTO = 50;

/**
 * CU-41: consulta del log de auditoria, solo ADMIN.
 *
 * `log_auditoria` no tiene `id_empresa`: el aislamiento sale del usuario que
 * actuo (`usuario.id_empresa`). Eso deja fuera las filas sin usuario --lo que
 * escriben las integraciones de otros grupos y el poller--, y es a proposito:
 * no se pueden atribuir a una empresa sin revisar cada entidad, y mostrarlas
 * todas mezclaria FiNet con Cable Magico.
 */
@Injectable()
export class AuditoriaService {
  constructor(private prisma: PrismaService) {}

  async buscar(id_empresa: number, f: FiltrosAuditoria) {
    const where = this.filtro(id_empresa, f);
    const { page, limit, skip } = normalizarPaginacion(f.page ?? 1, f.limit ?? LIMITE_POR_DEFECTO);
    const [filas, total] = await Promise.all([
      this.prisma.log_auditoria.findMany({
        where,
        orderBy: [{ fecha_hora: 'desc' }, { id_log: 'desc' }],
        skip,
        take: limit,
        include: { usuario: { select: { nombre_completo: true, nombre_usuario: true } } },
      }),
      this.prisma.log_auditoria.count({ where }),
    ]);
    return { data: filas.map((r) => this.aVista(r)), total, page, limit };
  }

  /** Las acciones que existen en la empresa, para el filtro de la Vista. */
  async acciones(id_empresa: number): Promise<string[]> {
    const filas = await this.prisma.log_auditoria.groupBy({
      by: ['accion'],
      where: { usuario: { id_empresa } },
      orderBy: { accion: 'asc' },
    });
    return filas.map((f) => f.accion);
  }

  /** CU-41: el log filtrado en Excel, para auditorias externas. */
  async exportar(id_empresa: number, f: FiltrosAuditoria) {
    const filas = await this.prisma.log_auditoria.findMany({
      where: this.filtro(id_empresa, f),
      orderBy: [{ fecha_hora: 'desc' }, { id_log: 'desc' }],
      take: MAX_FILAS_EXPORTACION,
      include: { usuario: { select: { nombre_completo: true, nombre_usuario: true } } },
    });

    const libro = new ExcelJS.Workbook();
    libro.creator = 'FSM';
    const hoja = libro.addWorksheet('Auditoría');
    hoja.columns = [
      { width: 20 }, { width: 26 }, { width: 28 }, { width: 18 }, { width: 8 }, { width: 50 }, { width: 50 },
    ];
    hoja.addRow(['Fecha y hora', 'Usuario', 'Acción', 'Entidad', 'Id', 'Valor anterior', 'Valor nuevo']).font = { bold: true };
    const fecha = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA_OPERACION, dateStyle: 'short', timeStyle: 'medium' });
    for (const r of filas) {
      hoja.addRow([
        fecha.format(r.fecha_hora),
        r.usuario?.nombre_completo ?? '',
        r.accion,
        r.entidad_afectada ?? '',
        r.id_entidad_afectada ?? '',
        r.valor_anterior == null ? '' : JSON.stringify(r.valor_anterior),
        r.valor_nuevo == null ? '' : JSON.stringify(r.valor_nuevo),
      ]);
    }

    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_OPERACION }).format(new Date());
    return {
      nombre: `Auditoria_FSM_${hoy}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contenido: Buffer.from(await libro.xlsx.writeBuffer()),
    };
  }

  // ---------------------------------------------------------------------------

  private filtro(id_empresa: number, f: FiltrosAuditoria): Prisma.log_auditoriaWhereInput {
    const where: Prisma.log_auditoriaWhereInput = { usuario: { id_empresa } };
    if (f.id_usuario) {
      const id = Number(f.id_usuario);
      if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('id_usuario inválido');
      where.id_usuario = id;
    }
    if (f.entidad) where.entidad_afectada = f.entidad;
    if (f.accion) where.accion = f.accion;

    if (f.tipo) {
      if (!TIPOS.includes(f.tipo)) throw new BadRequestException(`tipo debe ser ${TIPOS.join(', ')}`);
      const empieza = (p: string) => ({ accion: { startsWith: p } });
      if (f.tipo === 'CREACION') Object.assign(where, empieza(PREFIJOS_CREACION[0]));
      else if (f.tipo === 'ELIMINACION') where.OR = PREFIJOS_ELIMINACION.map(empieza);
      else where.NOT = [...PREFIJOS_CREACION, ...PREFIJOS_ELIMINACION].map(empieza);
    }

    if (f.desde || f.hasta) {
      const dia = /^\d{4}-\d{2}-\d{2}$/;
      if ((f.desde && !dia.test(f.desde)) || (f.hasta && !dia.test(f.hasta))) {
        throw new BadRequestException('Fechas inválidas: se espera YYYY-MM-DD');
      }
      // Mediodia UTC cae dentro del dia calendario buscado en cualquier zona.
      const rango: { gte?: Date; lt?: Date } = {};
      if (f.desde) rango.gte = rangoDiaOperacion(new Date(`${f.desde}T12:00:00Z`)).desde;
      if (f.hasta) rango.lt = rangoDiaOperacion(new Date(`${f.hasta}T12:00:00Z`)).hasta;
      where.fecha_hora = rango;
    }
    return where;
  }

  private aVista(r: {
    id_log: bigint;
    id_usuario: number | null;
    accion: string;
    entidad_afectada: string | null;
    id_entidad_afectada: number | null;
    valor_anterior: unknown;
    valor_nuevo: unknown;
    fecha_hora: Date;
    usuario: { nombre_completo: string; nombre_usuario: string | null } | null;
  }) {
    return {
      // BigInt: JSON.stringify lanza TypeError con el valor crudo.
      id_log: r.id_log.toString(),
      id_usuario: r.id_usuario,
      usuario: r.usuario?.nombre_completo ?? null,
      accion: r.accion,
      entidad_afectada: r.entidad_afectada,
      id_entidad_afectada: r.id_entidad_afectada,
      valor_anterior: r.valor_anterior,
      valor_nuevo: r.valor_nuevo,
      fecha_hora: r.fecha_hora,
    };
  }
}
