import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegistroOntService } from './registro-ont.service.js';
import { MonitoreoGateway } from './monitoreo.gateway.js';
import {
  FUENTE_MONITOREO,
  type FuenteMonitoreo,
  type FiltroConsulta,
  type EstadoConexion,
} from './fuente/fuente-monitoreo.js';
import { ESTADO_CONEXION, potenciaFueraDeRango } from './monitoreo.constants.js';
import { analizarInterrupciones } from './interrupciones.js';
import { esInactiva } from './reglas-alerta.js';
import { clientesSuspendidos } from '../cortes/suspendidos.js';
import { rangoDiaOperacion } from '../common/utils/dia-habil.util.js';

/**
 * El ultimo evento de caida de una ONT, para saber desde cuando esta sin
 * servicio. Mismo criterio que la CTE `transicion` de `cargarEstado`.
 */
const ULTIMA_CAIDA = {
  where: { evento: { not: ESTADO_CONEXION.ONLINE } },
  orderBy: { timestamp: 'desc' as const },
  take: 1,
};

/** CU-14: la vista inicial comprende los ultimos 30 dias. */
const DIAS_HISTORIAL_POR_DEFECTO = 30;
/** Tope del periodo personalizado: mas no entra en una tabla que se lea. */
const DIAS_HISTORIAL_MAXIMO = 90;
/** Tope de eventos por consulta. Un mes de una ONT normal son decenas. */
const MAX_EVENTOS_HISTORIAL = 5000;

/** Lo que hace falta de la ultima fila guardada para saber si cambio algo. */
interface UltimaGuardada {
  estado: string | null;
  potencia: number | null;
  timestamp: number;
}

/** Fila de monitoreo_ont recien armada, antes de escribirse. */
interface FilaMonitoreo {
  id_registro_ont: number | null;
  potencia_actual_dbm: number | null;
  estado_conexion: string;
  timestamp_medicion: Date;
}

function esIgualALaGuardada(f: FilaMonitoreo, ultimas: Map<number, UltimaGuardada>): boolean {
  // Sin id_registro_ont no hay con que compararla, asi que se escribe.
  if (f.id_registro_ont == null) return false;
  const u = ultimas.get(f.id_registro_ont);
  if (u === undefined) return false;
  return (
    u.estado === f.estado_conexion &&
    u.potencia === (f.potencia_actual_dbm ?? null) &&
    u.timestamp === f.timestamp_medicion.getTime()
  );
}

export interface ResumenIngesta {
  fuente: string;
  leidas: number;
  persistidas: number;
  /** Lecturas identicas a la ultima guardada de su ONT, que no se reescriben. */
  omitidas: number;
  sin_unidad: number;
  cambios_estado: number;
  registros_enriquecidos: number;
  /** ONT a las que el censo les cambio la caja o el puerto en este sondeo. */
  ubicaciones_actualizadas: number;
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
    private gateway: MonitoreoGateway,
  ) {}

  // ---------------------------------------------------------------------------
  // Ingesta — lo que llama el poller (y el endpoint manual)
  // ---------------------------------------------------------------------------

  /**
   * La ultima fila guardada de cada ONT del lote.
   *
   * Se consulta en cada tick en vez de recordarse en memoria: asi el dedupe
   * sigue siendo correcto tras un reinicio del backend, tras una purga de la
   * tabla y si alguna vez corren dos instancias. Son ~940 filas y entra por
   * el indice (id_registro_ont, timestamp_medicion), asi que cuesta mucho
   * menos que las 945 escrituras que evita.
   *
   * Ordena por `id_monitoreo DESC`, no por `timestamp_medicion`: aca interesa
   * la ultima fila ESCRITA, que es contra la que hay que comparar. El lector
   * de alertas ordena distinto a proposito, porque busca otra cosa.
   */
  private async ultimasGuardadas(filas: FilaMonitoreo[]): Promise<Map<number, UltimaGuardada>> {
    const ids = [...new Set(filas.map((f) => f.id_registro_ont).filter((x): x is number => x != null))];
    if (ids.length === 0) return new Map();

    const guardadas = await this.prisma.$queryRaw<
      { id_registro_ont: number; estado_conexion: string | null; potencia: string | null; timestamp_medicion: Date }[]
    >`
      SELECT DISTINCT ON (m.id_registro_ont)
             m.id_registro_ont,
             m.estado_conexion,
             m.potencia_actual_dbm::text AS potencia,
             m.timestamp_medicion
        FROM monitoreo_ont m
       WHERE m.id_registro_ont = ANY(${ids})
       ORDER BY m.id_registro_ont, m.id_monitoreo DESC
    `;

    return new Map(
      guardadas.map((g) => [
        g.id_registro_ont,
        {
          estado: g.estado_conexion,
          potencia: g.potencia === null ? null : Number(g.potencia),
          timestamp: g.timestamp_medicion.getTime(),
        },
      ]),
    );
  }

  async ingestarLecturas(filtro?: FiltroConsulta): Promise<ResumenIngesta> {
    const t0 = Date.now();
    // El censo se pide JUNTO con las lecturas y antes de tocar la base.
    // SmartOltClient responde los dos con una sola llamada a
    // get_all_onus_details (la memoiza 10 s), que tiene cuota de 15 por hora;
    // pedirlo despues de las consultas a la base arriesgaba una segunda llamada
    // si la base tardaba. El censo hace falta en cada tick: de ahi sale la caja
    // y el puerto de cada ONT.
    const [lecturas, detalles] = await Promise.all([
      this.fuente.listarLecturas(filtro),
      this.fuente.listarOntDetalles(filtro),
    ]);
    const sns = lecturas.map((l) => l.sn);

    const registros = await this.registro.asegurarRegistros(sns);

    // Enriquecer (cruce con unidad_equipo) solo las ONT que todavía no tienen
    // unidad resuelta.
    let registros_enriquecidos = 0;
    const sinUnidad = sns.filter((sn) => registros.get(sn)?.id_unidad == null);
    if (sinUnidad.length > 0) {
      registros_enriquecidos = await this.registro.enriquecer(
        detalles.filter((d) => sinUnidad.includes(d.sn)),
      );
      // releer los registros afectados para persistir con los enlaces frescos
      const refrescados = await this.registro.asegurarRegistros(sinUnidad);
      for (const [sn, r] of refrescados) registros.set(sn, r);
    }

    // Caja y puerto de TODAS las ONT, no solo las que se enriquecieron. Es un
    // dato de apoyo: si falla, se registra y las lecturas se guardan igual.
    // Sin filtro el censo es completo y puede liberar puertos de ONT que ya no
    // estan en SmartOLT.
    let ubicaciones_actualizadas = 0;
    try {
      ubicaciones_actualizadas = await this.registro.sincronizarUbicacion(detalles, {
        censoCompleto: !filtro,
      });
    } catch (e) {
      this.logger.error(`No se pudo actualizar la ubicacion de las ONT: ${(e as Error).message}`);
    }

    const ahora = new Date();
    const filasMonitoreo = lecturas.map((l) => {
      const r = registros.get(l.sn);
      return {
        id_registro_ont: r?.id_registro_ont ?? null,
        id_unidad: r?.id_unidad ?? null,
        id_cliente: r?.id_cliente ?? null,
        id_caja_nap: r?.id_caja_nap ?? null,
        potencia_actual_dbm: l.potencia_rx_dbm,
        estado_conexion: l.estado,
        // Si la fuente no dice desde cuando esta asi, se usa la primera vez que
        // la vimos: si SmartOLT nunca le registro un cambio, lleva en este
        // estado AL MENOS desde entonces. Con "ahora" (lo de antes), un equipo
        // dado de baja en 2021 parecia recien caido en cada sondeo y nunca
        // llegaba a la regla de baja de 7 dias (`esInactiva`): en la base de
        // FiNet eran 63 de las 85 "caidas recientes". Ademas, como la fecha
        // cambiaba, el dedupe no la reconocia y se escribia una fila nueva cada
        // 5 minutos por ONT.
        timestamp_medicion: l.medido_en ?? r?.primera_vez ?? ahora,
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
        // Aca NO va la primera vez: el cambio se acaba de ver, y fecharlo en
        // el pasado haria que una caida de hoy pareciera una baja vieja.
        timestamp: l.medido_en ?? ahora,
      });
    }

    // No se vuelve a escribir lo que ya esta guardado. Medido sobre el respaldo
    // de produccion del 29-09: de 394.799 filas, 364.220 eran identicas a la
    // anterior de su misma ONT --el 92,2%-- y quedarian 30.579. Es lo que hace
    // que la tabla crezca 272.000 filas al dia y lo que llenó el disco.
    //
    // No se pierde nada: `timestamp_medicion` es el last_status_change de
    // SmartOLT, asi que dos lecturas con el mismo estado, la misma potencia y
    // el mismo timestamp son la misma medicion leida dos veces, y ni siquiera
    // se pueden ordenar entre si en el tiempo.
    const ultimas = await this.ultimasGuardadas(filasMonitoreo);
    const nuevas = filasMonitoreo.filter((f) => !esIgualALaGuardada(f, ultimas));
    const omitidas = filasMonitoreo.length - nuevas.length;

    const [insertadas] = await this.prisma.$transaction([
      this.prisma.monitoreo_ont.createMany({ data: nuevas }),
      ...(eventos.length
        ? [this.prisma.historial_conexion_ont.createMany({ data: eventos })]
        : []),
    ]);

    const resumen: ResumenIngesta = {
      fuente: this.fuente.nombre,
      leidas: lecturas.length,
      persistidas: insertadas.count,
      omitidas,
      sin_unidad: [...registros.values()].filter((r) => r.id_unidad == null).length,
      cambios_estado: eventos.length,
      registros_enriquecidos,
      ubicaciones_actualizadas,
      ms: Date.now() - t0,
    };
    this.logger.log(
      `Ingesta [${resumen.fuente}]: ${resumen.persistidas} lecturas, ` +
        `${resumen.omitidas} sin cambios, ` +
        `${resumen.cambios_estado} cambios de estado, ${resumen.sin_unidad} sin unidad, ${resumen.ms}ms`,
    );

    // CU-12: se avisa a los paneles abiertos en vez de que cada uno pregunte.
    // No se espera --como el fan-out del cierre-- porque el resultado de la
    // ingesta ya esta guardado: si la publicacion falla, el proximo ciclo
    // vuelve a publicar y el panel se pone al dia solo.
    {
      try {
        this.gateway.publicar(this.registro.idEmpresaFuente, {
          tipo: 'LECTURAS_INGESTADAS',
          leidas: resumen.leidas,
          cambios_estado: resumen.cambios_estado,
        });
      } catch (e) {
        this.logger.warn(`No se pudo publicar la ingesta: ${(e as Error).message}`);
      }
    }

    return resumen;
  }

  // ---------------------------------------------------------------------------
  // Consultas — para el dashboard de G3 y para G8 (CU-49 estado del cliente)
  // ---------------------------------------------------------------------------

  /**
   * Una fila por ONT registrada, con su última lectura.
   *
   * El aislamiento sale de `registro_ont.id_empresa`, que la ingesta puebla a
   * partir de la empresa dueña de la fuente. Antes se derivaba de la lista de
   * clientes de la empresa, con un `OR: [{ id_cliente: { in: [...] } }, { id_cliente: null }]`
   * — y eso era una fuga: `id_cliente` está en null en casi todas las filas
   * ingestadas (SmartOLT no lo trae; se resuelve después, si es que), así que
   * la rama del `null` dejaba ver TODAS las ONT de la otra empresa, incluido
   * `nombre_cliente_ext`, que en 118 de 940 filas trae nombre, RUT, teléfono y
   * dirección del cliente.
   *
   * Si `id_empresa` fuera null en alguna fila vieja, queda invisible en vez de
   * visible para todos, que es el lado correcto en el que fallar.
   */
  async lecturasRecientes(id_empresa: number, page = 1, limit = 50) {
    const registros = await this.prisma.registro_ont.findMany({
      where: { id_empresa },
      orderBy: { numero_serie: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        // La ultima lectura es la ultima ESCRITA, no la de fecha mayor:
        // `timestamp_medicion` guarda desde cuando la ONT esta en ese estado y
        // no siempre crece. Ver la nota de `AlertasService.cargarEstado`.
        monitoreos: { orderBy: { id_monitoreo: 'desc' }, take: 1 },
        historial: ULTIMA_CAIDA,
      },
    });

    const ahora = new Date();
    const suspendidos = await clientesSuspendidos(this.prisma, id_empresa, this.logger);
    return registros.map((r) => this.aVista(r, ahora, suspendidos));
  }

  /** Detalle de una ONT por número de serie: última lectura + historial. */
  async detalleOnt(sn: string, id_empresa: number) {
    const registro = await this.prisma.registro_ont.findUnique({
      where: { numero_serie: sn },
      include: {
        monitoreos: { orderBy: { id_monitoreo: 'desc' }, take: 1 },
        historial: { orderBy: { timestamp: 'desc' }, take: 50 },
      },
    });
    // Mismo NotFoundException tanto si no existe como si es de otra empresa:
    // no hay que distinguirle a quien pregunta cuál de los dos casos es.
    if (!registro || registro.id_empresa !== id_empresa) {
      throw new NotFoundException(`ONT ${sn} no vista por el monitoreo`);
    }

    const suspendidos = await clientesSuspendidos(this.prisma, id_empresa, this.logger);
    return { ...this.aVista(registro, new Date(), suspendidos), historial_conexion: registro.historial };
  }

  /**
   * CU-14 / RF-12: historial de conexiones y desconexiones de una ONT en un
   * periodo, con las interrupciones armadas (inicio, fin, duracion, indicio) y
   * los indicadores de patron del CU. Ver interrupciones.ts.
   *
   * `desde`/`hasta` son dias (YYYY-MM-DD, inclusivos) en la zona de operacion;
   * sin ellos, los ultimos 30 dias hasta ahora.
   */
  async interrupcionesOnt(
    sn: string,
    id_empresa: number,
    periodo: { desde?: string; hasta?: string },
    ahora = new Date(),
  ) {
    const { desde, hasta } = this.periodoHistorial(periodo, ahora);

    const registro = await this.prisma.registro_ont.findUnique({ where: { numero_serie: sn } });
    if (!registro || registro.id_empresa !== id_empresa) {
      throw new NotFoundException(`ONT ${sn} no vista por el monitoreo`);
    }

    const [previo, eventos] = await Promise.all([
      this.prisma.historial_conexion_ont.findFirst({
        where: { id_registro_ont: registro.id_registro_ont, timestamp: { lt: desde } },
        orderBy: { timestamp: 'desc' },
        select: { evento: true },
      }),
      this.prisma.historial_conexion_ont.findMany({
        where: { id_registro_ont: registro.id_registro_ont, timestamp: { gte: desde, lt: hasta } },
        orderBy: { timestamp: 'asc' },
        select: { evento: true, timestamp: true },
        take: MAX_EVENTOS_HISTORIAL,
      }),
    ]);

    return {
      numero_serie: registro.numero_serie,
      nombre_cliente_ext: registro.nombre_cliente_ext,
      periodo: { desde, hasta },
      eventos,
      ...analizarInterrupciones({ previo: previo?.evento ?? null, eventos, desde, hasta }),
    };
  }

  private periodoHistorial(p: { desde?: string; hasta?: string }, ahora: Date) {
    if (!p.desde && !p.hasta) {
      return { desde: new Date(ahora.getTime() - DIAS_HISTORIAL_POR_DEFECTO * 86_400_000), hasta: ahora };
    }
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    if (!p.desde || !dia.test(p.desde) || (p.hasta && !dia.test(p.hasta))) {
      throw new BadRequestException('Período inválido: se espera desde y hasta como YYYY-MM-DD');
    }
    // Mediodia UTC cae dentro del dia calendario buscado en cualquier zona.
    const { desde } = rangoDiaOperacion(new Date(`${p.desde}T12:00:00Z`));
    const { hasta } = p.hasta ? rangoDiaOperacion(new Date(`${p.hasta}T12:00:00Z`)) : { hasta: ahora };
    if (isNaN(desde.getTime()) || isNaN(hasta.getTime()) || hasta <= desde) {
      throw new BadRequestException('Período inválido: hasta no puede ser anterior a desde');
    }
    if ((hasta.getTime() - desde.getTime()) / 86_400_000 > DIAS_HISTORIAL_MAXIMO + 1) {
      throw new BadRequestException(`El periodo no puede superar ${DIAS_HISTORIAL_MAXIMO} dias`);
    }
    return { desde, hasta };
  }

  /** Estado de conexión de las ONT de un cliente. Pensado para G8 (CU-49/51). */
  async estadoCliente(id_cliente: number, id_empresa: number) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa },
      select: { id_cliente: true },
    });
    if (!cliente) throw new NotFoundException(`Cliente ${id_cliente} no encontrado`);

    const registros = await this.prisma.registro_ont.findMany({
      where: { id_cliente },
      include: { monitoreos: { orderBy: { id_monitoreo: 'desc' }, take: 1 }, historial: ULTIMA_CAIDA },
    });
    const ahora = new Date();
    const suspendidos = await clientesSuspendidos(this.prisma, id_empresa, this.logger);
    return { id_cliente, onts: registros.map((r) => this.aVista(r, ahora, suspendidos)) };
  }

  /**
   * Contadores para el dashboard de monitoreo.
   *
   * `por_estado` cuenta solo las ONT activas. Las posibles bajas (caidas hace
   * mas de 7 dias: equipos de clientes que se fueron y siguen en SmartOLT) van
   * aparte en `posibles_bajas`: sumadas a "fuera de linea" eran ~200 de ~970 y
   * tapaban las caidas que si hay que atender.
   */
  async resumen(id_empresa: number) {
    const vistas = await this.lecturasRecientes(id_empresa, 1, 5000);
    const por_estado: Record<string, number> = { ONLINE: 0, OFFLINE: 0, LOS: 0, DESCONOCIDO: 0 };
    let potencia_fuera_de_rango = 0;
    let posibles_bajas = 0;
    let suspendidos = 0;

    for (const v of vistas) {
      // Cortado por deuda: su caida es esperada, no es "fuera de linea".
      if (v.suspendido) {
        suspendidos++;
        continue;
      }
      if (v.posible_baja) {
        posibles_bajas++;
        continue;
      }
      const e = v.estado_conexion ?? 'DESCONOCIDO';
      por_estado[e] = (por_estado[e] ?? 0) + 1;
      if (v.potencia_fuera_de_rango) potencia_fuera_de_rango++;
    }

    return {
      total_ont: vistas.length,
      por_estado,
      posibles_bajas,
      suspendidos,
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
    /** Eventos de conexion, del mas nuevo al mas viejo. */
    historial?: { evento: string | null; timestamp: Date }[];
  }, ahora: Date, suspendidos: Set<number> = new Set()) {
    const ultima = r.monitoreos[0] ?? null;
    const potencia =
      ultima?.potencia_actual_dbm == null ? null : Number(ultima.potencia_actual_dbm);
    const estado = ultima?.estado_conexion ?? null;
    // Desde cuando esta caida: el ultimo evento de caida y, si no hay, la
    // fecha de la lectura. Es el mismo criterio de `AlertasService.cargarEstado`.
    const caida = r.historial?.find((h) => h.evento != null && h.evento !== ESTADO_CONEXION.ONLINE)?.timestamp ?? null;
    const sin_senal_desde =
      estado != null && estado !== ESTADO_CONEXION.ONLINE ? (caida ?? ultima?.timestamp_medicion ?? null) : null;
    const suspendido = r.id_cliente != null && suspendidos.has(r.id_cliente);
    return {
      numero_serie: r.numero_serie,
      id_unidad: r.id_unidad,
      id_cliente: r.id_cliente,
      zona: r.zona,
      olt_externo: r.olt_externo,
      nombre_cliente_ext: r.nombre_cliente_ext,
      estado_conexion: estado,
      potencia_actual_dbm: potencia,
      potencia_fuera_de_rango: potenciaFueraDeRango(potencia),
      medido_en: ultima?.timestamp_medicion ?? null,
      /** Caida hace mas de 7 dias: equipo de un cliente que se fue. Ver `esInactiva`. */
      posible_baja: !suspendido && esInactiva({ estado_conexion: estado, sin_senal_desde }, ahora),
      /** Cliente suspendido por deuda (contrato de G8): su caida es esperada. */
      suspendido,
    };
  }
}
