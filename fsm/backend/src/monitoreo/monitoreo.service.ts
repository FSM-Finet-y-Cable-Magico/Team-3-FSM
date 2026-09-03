import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import {
  FUENTE_MONITOREO,
  type FuenteMonitoreo,
  type FiltroConsulta,
  type EstadoConexion,
} from './fuente/fuente-monitoreo.js';
import { potenciaFueraDeRango } from './monitoreo.constants.js';

export interface ResumenIngesta {
  fuente: string;
  leidas: number;
  persistidas: number;
  sin_unidad: number;
  cambios_estado: number;
  registros_enriquecidos: number;
  ms: number;
}

@Injectable()
export class MonitoreoService {
  private readonly logger = new Logger(MonitoreoService.name);

  /**
   * Último estado conocido por ONT, para detectar transiciones sin consultar la
   * base en cada poll. Se llena en caliente: tras un reinicio, la primera
   * lectura de cada ONT no genera evento de historial (no hay "estado previo").
   */
  private ultimoEstado = new Map<string, EstadoConexion>();

  constructor(
    private prisma: PrismaService,
    private registro: RegistroOntService,
    @Inject(FUENTE_MONITOREO) private fuente: FuenteMonitoreo,
  ) {}

  // ---------------------------------------------------------------------------
  // Ingesta — lo que llama el poller (y el endpoint manual)
  // ---------------------------------------------------------------------------

  async ingestarLecturas(filtro?: FiltroConsulta): Promise<ResumenIngesta> {
    const t0 = Date.now();
    const lecturas = await this.fuente.listarLecturas(filtro);
    const sns = lecturas.map((l) => l.sn);

    const registros = await this.registro.asegurarRegistros(sns);

    // Enriquecer (censo + cruce con unidad_equipo) solo si hay ONT que todavía
    // no tienen unidad resuelta — evita pegarle a la fuente en cada tick.
    let registros_enriquecidos = 0;
    const sinUnidad = sns.filter((sn) => registros.get(sn)?.id_unidad == null);
    if (sinUnidad.length > 0) {
      const detalles = await this.fuente.listarOntDetalles(filtro);
      registros_enriquecidos = await this.registro.enriquecer(
        detalles.filter((d) => sinUnidad.includes(d.sn)),
      );
      // releer los registros afectados para persistir con los enlaces frescos
      const refrescados = await this.registro.asegurarRegistros(sinUnidad);
      for (const [sn, r] of refrescados) registros.set(sn, r);
    }

    const filasMonitoreo = lecturas.map((l) => {
      const r = registros.get(l.sn);
      return {
        id_registro_ont: r?.id_registro_ont ?? null,
        id_unidad: r?.id_unidad ?? null,
        id_cliente: r?.id_cliente ?? null,
        id_caja_nap: r?.id_caja_nap ?? null,
        potencia_actual_dbm: l.potencia_rx_dbm,
        estado_conexion: l.estado,
        timestamp_medicion: l.medido_en,
      };
    });

    // Transiciones de estado → historial_conexion_ont.
    const eventos: {
      id_registro_ont: number | null;
      id_unidad: number | null;
      evento: string;
      timestamp: Date;
    }[] = [];
    for (const l of lecturas) {
      const previo = this.ultimoEstado.get(l.sn);
      this.ultimoEstado.set(l.sn, l.estado);
      if (previo === undefined || previo === l.estado) continue;
      const r = registros.get(l.sn);
      eventos.push({
        id_registro_ont: r?.id_registro_ont ?? null,
        id_unidad: r?.id_unidad ?? null,
        evento: l.estado,
        timestamp: l.medido_en,
      });
    }

    const [insertadas] = await this.prisma.$transaction([
      this.prisma.monitoreo_ont.createMany({ data: filasMonitoreo }),
      ...(eventos.length
        ? [this.prisma.historial_conexion_ont.createMany({ data: eventos })]
        : []),
    ]);

    const resumen: ResumenIngesta = {
      fuente: this.fuente.nombre,
      leidas: lecturas.length,
      persistidas: insertadas.count,
      sin_unidad: [...registros.values()].filter((r) => r.id_unidad == null).length,
      cambios_estado: eventos.length,
      registros_enriquecidos,
      ms: Date.now() - t0,
    };
    this.logger.log(
      `Ingesta [${resumen.fuente}]: ${resumen.persistidas} lecturas, ` +
        `${resumen.cambios_estado} cambios de estado, ${resumen.sin_unidad} sin unidad, ${resumen.ms}ms`,
    );
    return resumen;
  }

  // ---------------------------------------------------------------------------
  // Consultas — para el dashboard de G3 y para G8 (CU-49 estado del cliente)
  // ---------------------------------------------------------------------------

  /** Una fila por ONT registrada, con su última lectura. */
  async lecturasRecientes(id_empresa: number, page = 1, limit = 50) {
    const registros = await this.prisma.registro_ont.findMany({
      where: await this.aislarPorEmpresa(id_empresa),
      orderBy: { numero_serie: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        monitoreos: { orderBy: { timestamp_medicion: 'desc' }, take: 1 },
      },
    });

    return registros.map((r) => this.aVista(r));
  }

  /** Detalle de una ONT por número de serie: última lectura + historial. */
  async detalleOnt(sn: string) {
    const registro = await this.prisma.registro_ont.findUnique({
      where: { numero_serie: sn },
      include: {
        monitoreos: { orderBy: { timestamp_medicion: 'desc' }, take: 1 },
        historial: { orderBy: { timestamp: 'desc' }, take: 50 },
      },
    });
    if (!registro) throw new NotFoundException(`ONT ${sn} no vista por el monitoreo`);

    return { ...this.aVista(registro), historial_conexion: registro.historial };
  }

  /** Estado de conexión de las ONT de un cliente. Pensado para G8 (CU-49/51). */
  async estadoCliente(id_cliente: number) {
    const registros = await this.prisma.registro_ont.findMany({
      where: { id_cliente },
      include: { monitoreos: { orderBy: { timestamp_medicion: 'desc' }, take: 1 } },
    });
    return { id_cliente, onts: registros.map((r) => this.aVista(r)) };
  }

  /** Contadores para el dashboard de monitoreo. */
  async resumen(id_empresa: number) {
    const vistas = await this.lecturasRecientes(id_empresa, 1, 5000);
    const por_estado: Record<string, number> = { ONLINE: 0, OFFLINE: 0, LOS: 0, DESCONOCIDO: 0 };
    let potencia_fuera_de_rango = 0;

    for (const v of vistas) {
      const e = v.estado_conexion ?? 'DESCONOCIDO';
      por_estado[e] = (por_estado[e] ?? 0) + 1;
      if (v.potencia_fuera_de_rango) potencia_fuera_de_rango++;
    }

    return {
      total_ont: vistas.length,
      por_estado,
      potencia_fuera_de_rango,
      fecha_actualizacion: new Date(),
    };
  }

  // ---------------------------------------------------------------------------

  private aVista(r: {
    numero_serie: string;
    id_unidad: number | null;
    id_cliente: number | null;
    zona: string | null;
    olt_externo: string | null;
    nombre_cliente_ext: string | null;
    monitoreos: {
      potencia_actual_dbm: unknown;
      estado_conexion: string | null;
      timestamp_medicion: Date;
    }[];
  }) {
    const ultima = r.monitoreos[0] ?? null;
    const potencia =
      ultima?.potencia_actual_dbm == null ? null : Number(ultima.potencia_actual_dbm);
    return {
      numero_serie: r.numero_serie,
      id_unidad: r.id_unidad,
      id_cliente: r.id_cliente,
      zona: r.zona,
      olt_externo: r.olt_externo,
      nombre_cliente_ext: r.nombre_cliente_ext,
      estado_conexion: ultima?.estado_conexion ?? null,
      potencia_actual_dbm: potencia,
      potencia_fuera_de_rango: potenciaFueraDeRango(potencia),
      medido_en: ultima?.timestamp_medicion ?? null,
    };
  }

  /**
   * Aísla por empresa. `registro_ont` no tiene `id_empresa` propio ni relación
   * FK a `cliente` (apunta a tabla de otro grupo), así que se resuelven los
   * clientes de la empresa y se filtra por id. Mismo criterio que inventario
   * con `id_bodega IS NULL`: se incluyen también las ONT sin cliente resuelto
   * (no son dato de otro tenant). Cuando toda ONT tenga cliente, pasa a estricto.
   */
  private async aislarPorEmpresa(id_empresa: number) {
    const clientes = await this.prisma.cliente.findMany({
      where: { id_empresa },
      select: { id_cliente: true },
    });
    return {
      OR: [{ id_cliente: { in: clientes.map((c) => c.id_cliente) } }, { id_cliente: null }],
    };
  }
}
