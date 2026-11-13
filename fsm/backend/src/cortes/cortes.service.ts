import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCION_CORTE, ACCION_REACTIVACION, clasificarContrato, diaDeFecha, type RegistroCorte } from './cortes.js';
import { esFaltaDePermiso } from './suspendidos.js';

const ACCIONES = [ACCION_CORTE, ACCION_REACTIVACION];

/** Fila de `log_auditoria` → lo que necesita la regla, incluida la fecha de suspension guardada. */
function comoRegistro(
  r: { accion: string; fecha_hora: Date; valor_nuevo?: unknown } | null | undefined,
): RegistroCorte | null {
  if (!r) return null;
  const fecha = (r.valor_nuevo as { fecha_suspension?: string | null } | null)?.fecha_suspension;
  return { accion: r.accion, fecha_hora: r.fecha_hora, fecha_suspension: fecha };
}
const MAX_HISTORIAL = 50;

const SELECT_CONTRATO = {
  id_contrato: true,
  estado: true,
  fecha_suspension: true,
  id_cliente: true,
  plan: { select: { nombre_comercial: true } },
  cliente: {
    select: {
      id_cliente: true,
      nombre_completo: true,
      rut: true,
      telefono: true,
      direcciones: { where: { es_principal: true }, take: 1, select: { direccion_completa: true, comuna: true } },
    },
  },
} as const;

/**
 * Panel de cortes y reactivaciones. Lee `contrato` (de G8, solo lectura) y
 * registra en `log_auditoria` que alguien hizo el corte o la reactivacion en
 * SmartOLT. No escribe en SmartOLT ni en `contrato`.
 */
@Injectable()
export class CortesService {
  constructor(private prisma: PrismaService) {}

  async listar(id_empresa: number) {
    const contratos = await this.conPermiso(() =>
      this.prisma.contrato.findMany({ where: { id_empresa }, select: SELECT_CONTRATO }),
    );
    const ids = contratos.map((c) => c.id_contrato);
    // `log_auditoria` no tiene empresa: se acota por los contratos de la empresa.
    const registros = ids.length
      ? await this.prisma.log_auditoria.findMany({
          where: { entidad_afectada: 'contrato', id_entidad_afectada: { in: ids }, accion: { in: ACCIONES } },
          orderBy: [{ fecha_hora: 'desc' }, { id_log: 'desc' }],
          select: {
            id_log: true,
            accion: true,
            fecha_hora: true,
            id_entidad_afectada: true,
            valor_nuevo: true,
            usuario: { select: { nombre_completo: true } },
          },
        })
      : [];
    const ultimo = new Map<number, (typeof registros)[number]>();
    for (const r of registros) {
      if (r.id_entidad_afectada != null && !ultimo.has(r.id_entidad_afectada)) ultimo.set(r.id_entidad_afectada, r);
    }

    const idsCliente = [...new Set(contratos.map((c) => c.id_cliente).filter((x): x is number => x != null))];
    const onts = idsCliente.length
      ? await this.prisma.registro_ont.findMany({
          where: { id_empresa, id_cliente: { in: idsCliente } },
          select: {
            id_cliente: true,
            numero_serie: true,
            odb: true,
            odb_puerto: true,
            olt_externo: true,
            board: true,
            puerto_pon: true,
            monitoreos: { orderBy: { id_monitoreo: 'desc' }, take: 1, select: { estado_conexion: true } },
          },
        })
      : [];

    const fila = (c: (typeof contratos)[number]) => {
      const u = ultimo.get(c.id_contrato);
      return {
        id_contrato: c.id_contrato,
        estado_contrato: c.estado,
        fecha_suspension: c.fecha_suspension ? diaDeFecha(c.fecha_suspension) : null,
        plan: c.plan?.nombre_comercial ?? null,
        cliente: c.cliente
          ? { id_cliente: c.cliente.id_cliente, nombre_completo: c.cliente.nombre_completo, rut: c.cliente.rut, telefono: c.cliente.telefono }
          : null,
        direccion: c.cliente?.direcciones[0] ?? null,
        onts: onts
          .filter((o) => c.id_cliente != null && o.id_cliente === c.id_cliente)
          .map((o) => ({
            numero_serie: o.numero_serie,
            estado_conexion: o.monitoreos[0]?.estado_conexion ?? null,
            odb: o.odb,
            odb_puerto: o.odb_puerto,
            olt_externo: o.olt_externo,
            board: o.board,
            puerto_pon: o.puerto_pon,
          })),
        ultimo_registro: u ? { accion: u.accion, fecha_hora: u.fecha_hora } : null,
      };
    };

    const clasificados = contratos.map((c) => ({ c, estado: clasificarContrato(c, comoRegistro(ultimo.get(c.id_contrato))) }));
    const nombre = new Map(contratos.map((c) => [c.id_contrato, c.cliente?.nombre_completo ?? null]));

    return {
      // Lo mas antiguo primero: es lo que lleva mas tiempo esperando.
      por_cortar: clasificados
        .filter((x) => x.estado === 'POR_CORTAR')
        .map((x) => fila(x.c))
        .sort((a, b) => (a.fecha_suspension ?? '9999').localeCompare(b.fecha_suspension ?? '9999')),
      por_reactivar: clasificados
        .filter((x) => x.estado === 'POR_REACTIVAR')
        .map((x) => fila(x.c))
        .sort((a, b) => +(a.ultimo_registro?.fecha_hora ?? 0) - +(b.ultimo_registro?.fecha_hora ?? 0)),
      historial: registros.slice(0, MAX_HISTORIAL).map((r) => ({
        id_log: Number(r.id_log), // BigInt: Nest no lo serializa
        accion: r.accion,
        fecha_hora: r.fecha_hora,
        usuario: r.usuario?.nombre_completo ?? null,
        id_contrato: r.id_entidad_afectada!,
        cliente: nombre.get(r.id_entidad_afectada!) ?? null,
        observacion: (r.valor_nuevo as { observacion?: string | null } | null)?.observacion ?? null,
      })),
    };
  }

  async registrar(
    id_empresa: number,
    id_contrato: number,
    accion: 'CORTE' | 'REACTIVACION',
    observacion: string | undefined,
    id_usuario: number,
  ) {
    const c = await this.conPermiso(() =>
      this.prisma.contrato.findFirst({
        where: { id_contrato, id_empresa },
        select: { id_contrato: true, estado: true, fecha_suspension: true },
      }),
    );
    if (!c) throw new NotFoundException(`Contrato ${id_contrato} no encontrado`);

    const ultimo = await this.prisma.log_auditoria.findFirst({
      where: { entidad_afectada: 'contrato', id_entidad_afectada: id_contrato, accion: { in: ACCIONES } },
      orderBy: [{ fecha_hora: 'desc' }, { id_log: 'desc' }],
      select: { accion: true, fecha_hora: true, valor_nuevo: true },
    });
    const esperado = accion === 'CORTE' ? 'POR_CORTAR' : 'POR_REACTIVAR';
    if (clasificarContrato(c, comoRegistro(ultimo)) !== esperado) {
      throw new ConflictException({
        codigo: 'NO_PENDIENTE',
        message:
          accion === 'CORTE'
            ? 'Este contrato no está pendiente de corte: ya se registró o G8 lo reactivó.'
            : 'Este contrato no está pendiente de reactivación.',
      });
    }

    const r = await this.prisma.log_auditoria.create({
      data: {
        id_usuario,
        accion: accion === 'CORTE' ? ACCION_CORTE : ACCION_REACTIVACION,
        entidad_afectada: 'contrato',
        id_entidad_afectada: id_contrato,
        valor_nuevo: {
          observacion: observacion?.trim() || null,
          estado_contrato: c.estado,
          fecha_suspension: c.fecha_suspension ? diaDeFecha(c.fecha_suspension) : null,
        },
      },
    });
    return { id_log: Number(r.id_log), accion: r.accion, fecha_hora: r.fecha_hora };
  }

  /** `contrato` es de G8: si la base nos niega leerlo, se dice claro. */
  private async conPermiso<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (esFaltaDePermiso(e)) {
        throw new ServiceUnavailableException({
          codigo: 'SIN_PERMISO_CONTRATO',
          message:
            'El sistema no tiene permiso para leer los contratos de la base compartida. ' +
            'Hay que pedirle al admin: GRANT SELECT ON contrato TO g3_app.',
        });
      }
      throw e;
    }
  }
}
