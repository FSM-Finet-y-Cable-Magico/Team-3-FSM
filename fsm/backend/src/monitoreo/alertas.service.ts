import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizarNombreCaja } from './ligado-caja.js';
import { evaluar, type EstadoOnt } from './reglas-alerta.js';
import { SILENCIO_TRAS_REVISION_H, UMBRAL_DESCONEXION_MIN_DEFECTO } from './monitoreo.constants.js';

export interface ResumenEvaluacion {
  ont_evaluadas: number;
  umbral_desconexion_min: number;
  propuestas: number;
  creadas: number;
  ya_abiertas: number;
  /** Propuestas omitidas porque una persona las revisó hace poco. */
  en_silencio: number;
  cerradas_automaticamente: number;
  ms: number;
}

/**
 * Motor de alertas (CU-13, CU-17, CU-52, CU-53).
 *
 * Corre sobre la última lectura de cada ONT. Es idempotente: si el problema
 * sigue vigente y ya hay una alerta abierta por lo mismo, no crea otra —
 * si no, cada corrida del poller generaría 900 alertas nuevas.
 *
 * Y al revés: cuando el problema deja de estar, la alerta se cierra sola con
 * `resuelta_por = null`, que es lo que la distingue de una que cerró una
 * persona. Sin esto el panel del jefe técnico acumularía alertas de cosas ya
 * resueltas y dejaría de ser confiable.
 */
@Injectable()
export class AlertasService {
  private readonly logger = new Logger(AlertasService.name);

  constructor(private prisma: PrismaService) {}

  async evaluarEmpresa(id_empresa: number): Promise<ResumenEvaluacion> {
    const t0 = Date.now();
    const ahora = new Date();

    const empresa = await this.prisma.empresa.findUnique({
      where: { id_empresa },
      select: { umbral_desconexion_min: true },
    });
    const umbralMin = empresa?.umbral_desconexion_min ?? UMBRAL_DESCONEXION_MIN_DEFECTO;

    const onts = await this.cargarEstado(id_empresa);
    const propuestas = evaluar(onts, ahora, umbralMin);

    // Clave de identidad de una alerta: tipo + sujeto. Es con lo que se decide
    // si esta propuesta ya está representada por una alerta abierta.
    const idDe = (p: { tipo: string; id_registro_ont: number | null; clave_caja: string | null }) =>
      `${p.tipo}|${p.id_registro_ont ?? ''}|${p.tipo === 'FALLA_CAJA_NAP' ? (p.clave_caja ?? '') : ''}`;

    const abiertas = await this.prisma.alerta.findMany({
      where: { id_empresa, resuelta: false },
      select: { id_alerta: true, tipo: true, id_registro_ont: true, clave_caja: true },
    });
    const abiertasPorId = new Map(abiertas.map((a) => [idDe(a), a.id_alerta]));
    const propuestasPorId = new Set(propuestas.map(idDe));

    // Revisadas hace poco por una persona: siguen en silencio. Revisar no
    // repara, así que la condición sigue cumpliéndose y sin este freno la
    // alerta reaparecería en la corrida siguiente.
    const desde = new Date(ahora.getTime() - SILENCIO_TRAS_REVISION_H * 3600_000);
    const silenciadas = await this.prisma.alerta.findMany({
      where: {
        id_empresa,
        resuelta: true,
        resuelta_por: { not: null },
        resuelta_en: { gte: desde },
      },
      select: { tipo: true, id_registro_ont: true, clave_caja: true },
    });
    const enSilencio = new Set(silenciadas.map(idDe));

    const nuevas = propuestas.filter((p) => !abiertasPorId.has(idDe(p)) && !enSilencio.has(idDe(p)));
    if (nuevas.length) {
      await this.prisma.alerta.createMany({
        data: nuevas.map((p) => ({ ...p, id_empresa })),
      });
    }

    // Las abiertas que ya no aparecen entre las propuestas: el problema pasó.
    const aCerrar = abiertas.filter((a) => !propuestasPorId.has(idDe(a))).map((a) => a.id_alerta);
    if (aCerrar.length) {
      await this.prisma.alerta.updateMany({
        where: { id_alerta: { in: aCerrar } },
        data: {
          resuelta: true,
          resuelta_en: ahora,
          observacion_resolucion: 'Cerrada automáticamente: la condición dejó de cumplirse',
        },
      });
    }

    const resumen: ResumenEvaluacion = {
      ont_evaluadas: onts.length,
      umbral_desconexion_min: umbralMin,
      propuestas: propuestas.length,
      creadas: nuevas.length,
      ya_abiertas: propuestas.filter((p) => abiertasPorId.has(idDe(p))).length,
      en_silencio: propuestas.filter((p) => !abiertasPorId.has(idDe(p)) && enSilencio.has(idDe(p))).length,
      cerradas_automaticamente: aCerrar.length,
      ms: Date.now() - t0,
    };
    this.logger.log(
      `Alertas empresa ${id_empresa}: ${resumen.creadas} nuevas, ${resumen.ya_abiertas} ya abiertas, ` +
        `${resumen.en_silencio} en silencio, ${resumen.cerradas_automaticamente} cerradas solas (umbral ${umbralMin} min, ${resumen.ms}ms)`,
    );
    return resumen;
  }

  /** Listado para el panel del jefe técnico (CU-12 / CU-15). */
  async listar(id_empresa: number, resuelta = false, tipo?: string, limit = 100) {
    return this.prisma.alerta.findMany({
      where: { id_empresa, resuelta, ...(tipo ? { tipo } : {}) },
      orderBy: [{ severidad: 'asc' }, { creada_en: 'desc' }],
      take: Math.min(200, Math.max(1, limit)),
      include: {
        registro: { select: { numero_serie: true, zona: true, nombre_cliente_ext: true, direccion_cliente_ext: true } },
        caja: { select: { identificador_unico: true, latitud: true, longitud: true } },
        cliente: { select: { id_cliente: true, nombre_completo: true, rut: true } },
      },
    });
  }

  /** CU-52 / CU-08: el jefe técnico marca la alerta como revisada. */
  async revisar(id_alerta: number, id_empresa: number, id_usuario: number, observacion?: string) {
    const alerta = await this.prisma.alerta.findFirst({ where: { id_alerta, id_empresa } });
    if (!alerta) throw new NotFoundException(`Alerta ${id_alerta} no encontrada`);

    return this.prisma.alerta.update({
      where: { id_alerta },
      data: {
        resuelta: true,
        resuelta_por: id_usuario,
        resuelta_en: new Date(),
        observacion_resolucion: observacion ?? null,
      },
    });
  }

  /** Contadores para la cabecera del panel. */
  async resumen(id_empresa: number) {
    const abiertas = await this.prisma.alerta.groupBy({
      by: ['tipo', 'severidad'],
      where: { id_empresa, resuelta: false },
      _count: { _all: true },
    });
    return {
      total_abiertas: abiertas.reduce((s, a) => s + a._count._all, 0),
      por_tipo: Object.fromEntries(
        abiertas.reduce((m, a) => m.set(a.tipo, (m.get(a.tipo) ?? 0) + a._count._all), new Map<string, number>()),
      ),
    };
  }

  // ---------------------------------------------------------------------------

  /**
   * Última lectura por ONT + desde cuándo está caída.
   *
   * `sin_senal_desde` sale del último evento de `historial_conexion_ont` hacia
   * el estado actual: es el momento real de la transición, no el de la última
   * medición. Si no hay evento (ONT que ya estaba caída antes del primer
   * arranque del poller) se usa la primera lectura conocida, que subestima la
   * antigüedad pero nunca la inventa.
   */
  private async cargarEstado(id_empresa: number): Promise<EstadoOnt[]> {
    const filas = await this.prisma.$queryRaw<
      {
        id_registro_ont: number;
        numero_serie: string;
        id_cliente: number | null;
        id_caja_nap: number | null;
        olt_externo: string | null;
        board: number | null;
        puerto_pon: number | null;
        odb: string | null;
        estado_conexion: string | null;
        potencia_dbm: string | null;
        sin_senal_desde: Date | null;
      }[]
    >`
      WITH ultima AS (
        SELECT DISTINCT ON (m.id_registro_ont)
               m.id_registro_ont, m.estado_conexion, m.potencia_actual_dbm, m.timestamp_medicion
        FROM monitoreo_ont m
        WHERE m.id_registro_ont IS NOT NULL
        ORDER BY m.id_registro_ont, m.timestamp_medicion DESC
      ),
      transicion AS (
        SELECT DISTINCT ON (h.id_registro_ont) h.id_registro_ont, h.timestamp
        FROM historial_conexion_ont h
        WHERE h.id_registro_ont IS NOT NULL AND h.evento <> 'ONLINE'
        ORDER BY h.id_registro_ont, h.timestamp DESC
      )
      SELECT r.id_registro_ont, r.numero_serie, r.id_cliente, r.id_caja_nap,
             r.olt_externo, r.board, r.puerto_pon, r.odb,
             u.estado_conexion,
             u.potencia_actual_dbm::text AS potencia_dbm,
             CASE WHEN u.estado_conexion <> 'ONLINE'
                  THEN COALESCE(t.timestamp, u.timestamp_medicion) END AS sin_senal_desde
      FROM registro_ont r
      JOIN ultima u ON u.id_registro_ont = r.id_registro_ont
      LEFT JOIN transicion t ON t.id_registro_ont = r.id_registro_ont
      WHERE r.id_empresa = ${id_empresa}
    `;

    return filas.map((f) => ({
      id_registro_ont: f.id_registro_ont,
      numero_serie: f.numero_serie,
      id_cliente: f.id_cliente,
      id_caja_nap: f.id_caja_nap,
      olt_externo: f.olt_externo,
      board: f.board,
      puerto_pon: f.puerto_pon,
      caja_normalizada: normalizarNombreCaja(f.odb),
      estado_conexion: f.estado_conexion,
      potencia_dbm: f.potencia_dbm == null ? null : Number(f.potencia_dbm),
      sin_senal_desde: f.sin_senal_desde,
    }));
  }
}
