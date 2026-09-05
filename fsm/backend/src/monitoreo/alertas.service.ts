import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizarNombreCaja } from './ligado-caja.js';
import { descomponerFicha } from './ficha-cliente.js';
import { evaluar, type EstadoOnt } from './reglas-alerta.js';
import {
  DIAS_MAX_INCIDENTE,
  TIPO_ALERTA,
  SILENCIO_TRAS_REVISION_H,
  UMBRAL_DESCONEXION_MIN_DEFECTO,
  potenciaEnFranjaPreventiva,
  potenciaFueraDeRango,
} from './monitoreo.constants.js';

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

    const abiertas = await this.prisma.alerta_monitoreo.findMany({
      where: { id_empresa, resuelta: false },
      select: { id_alerta: true, tipo: true, id_registro_ont: true, clave_caja: true },
    });
    const abiertasPorId = new Map(abiertas.map((a) => [idDe(a), a.id_alerta]));
    const propuestasPorId = new Set(propuestas.map(idDe));

    // Revisadas hace poco por una persona: siguen en silencio. Revisar no
    // repara, así que la condición sigue cumpliéndose y sin este freno la
    // alerta reaparecería en la corrida siguiente.
    const desde = new Date(ahora.getTime() - SILENCIO_TRAS_REVISION_H * 3600_000);
    const silenciadas = await this.prisma.alerta_monitoreo.findMany({
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
      await this.prisma.alerta_monitoreo.createMany({
        data: nuevas.map((p) => ({ ...p, id_empresa })),
      });
    }

    // Las abiertas que ya no aparecen entre las propuestas: el problema pasó.
    const aCerrar = abiertas.filter((a) => !propuestasPorId.has(idDe(a))).map((a) => a.id_alerta);
    if (aCerrar.length) {
      await this.prisma.alerta_monitoreo.updateMany({
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

  /** Zonas y cajas presentes en las alertas abiertas, para poblar los filtros. */
  async facetas(id_empresa: number) {
    const abiertas = await this.prisma.alerta_monitoreo.findMany({
      where: { id_empresa, resuelta: false },
      select: { clave_caja: true, registro: { select: { zona: true } } },
    });
    const zonas = new Map<string, number>();
    const cajas = new Map<string, number>();
    for (const a of abiertas) {
      const z = a.registro?.zona?.replace(/\s+/g, ' ').trim();
      if (z) zonas.set(z, (zonas.get(z) ?? 0) + 1);
      // De "2/1/7|NAP 6" al panel le interesa el nombre, no el puerto.
      const c = a.clave_caja?.split('|')[1];
      if (c) cajas.set(c, (cajas.get(c) ?? 0) + 1);
    }
    const aLista = (m: Map<string, number>) =>
      [...m].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n);
    return { zonas: aLista(zonas), cajas: aLista(cajas) };
  }

  /** Listado para el panel del jefe técnico (CU-12 / CU-15). */
  async listar(
    id_empresa: number,
    resuelta = false,
    tipo?: string,
    limit = 100,
    zona?: string,
    caja?: string,
  ) {
    const filas = await this.prisma.alerta_monitoreo.findMany({
      where: {
        id_empresa,
        resuelta,
        ...(tipo ? { tipo } : {}),
        // `zona` vive en registro_ont, así que filtra por la relación; las
        // alertas de caja no tienen registro y quedan fuera al filtrar por zona,
        // que es lo correcto: la caja no pertenece a una sola zona.
        ...(zona ? { registro: { zona: { contains: zona, mode: 'insensitive' as const } } } : {}),
        ...(caja ? { clave_caja: { contains: caja, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ severidad: 'asc' }, { creada_en: 'desc' }],
      take: Math.min(200, Math.max(1, limit)),
      include: {
        registro: { select: { numero_serie: true, zona: true, nombre_cliente_ext: true, direccion_cliente_ext: true } },
        caja: { select: { identificador_unico: true, latitud: true, longitud: true } },
        cliente: { select: { id_cliente: true, nombre_completo: true, rut: true } },
        ot_generada: { select: { id_ot: true, tipo_ot: true, estado: true } },
      },
    });

    // La referencia de SmartOLT llega con los campos revueltos en 118 de 940
    // ONT: todo en el nombre y la posición del puerto en la dirección. Se
    // desarma acá para que el panel muestre nombre y dirección donde
    // corresponde. Solo presentación: el dato crudo no se toca.
    return filas.map((a) => {
      if (!a.registro) return a;
      const f = descomponerFicha(a.registro.nombre_cliente_ext, a.registro.direccion_cliente_ext);
      return {
        ...a,
        registro: {
          ...a.registro,
          nombre_cliente_ext: f.nombre,
          direccion_cliente_ext: f.direccion,
        },
      };
    });
  }

  /**
   * Clientes que hay detrás de una alerta agregada, con su estado actual.
   *
   * Es lo que le permite al jefe técnico decidir sin salir del panel: ver quién
   * está afectado, con qué señal y desde cuándo, antes de mandar una cuadrilla
   * o generar la OT preventiva (CU-16).
   */
  async detalle(id_alerta: number, id_empresa: number) {
    const alerta = await this.prisma.alerta_monitoreo.findFirst({
      where: { id_alerta, id_empresa },
      include: { caja: { select: { identificador_unico: true, latitud: true, longitud: true } } },
    });
    if (!alerta) throw new NotFoundException(`Alerta ${id_alerta} no encontrada`);

    // Una alerta individual ya trae su cliente; no hay grupo que desplegar.
    if (!alerta.clave_caja) return { alerta, afectados: [] };

    // `clave_caja` tiene dos formatos según el nivel del agregado:
    //   caja  → "2/1/7|NAP 6"        (olt/placa/puerto + nombre normalizado)
    //   placa → "OLT 2 / placa 1"
    let filtro: { olt: string; board?: number; pon?: number; caja?: string };
    const mPlaca = /^OLT (.+) \/ placa (.+)$/.exec(alerta.clave_caja);
    if (mPlaca) {
      filtro = { olt: mPlaca[1], board: Number(mPlaca[2]) };
    } else {
      const [puerto, caja] = alerta.clave_caja.split('|');
      const [olt, board, pon] = puerto.split('/');
      filtro = { olt, board: Number(board), pon: Number(pon), caja };
    }

    const candidatos = await this.prisma.registro_ont.findMany({
      where: {
        id_empresa,
        olt_externo: filtro.olt,
        ...(filtro.board != null && !Number.isNaN(filtro.board) ? { board: filtro.board } : {}),
        ...(filtro.pon != null && !Number.isNaN(filtro.pon) ? { puerto_pon: filtro.pon } : {}),
      },
      select: {
        id_registro_ont: true,
        numero_serie: true,
        odb: true,
        zona: true,
        id_cliente: true,
        nombre_cliente_ext: true,
        direccion_cliente_ext: true,
        id_caja_nap: true,
        caja_confirmada_por: true,
        monitoreos: {
          orderBy: { timestamp_medicion: 'desc' },
          take: 1,
          select: { estado_conexion: true, potencia_actual_dbm: true, timestamp_medicion: true },
        },
      },
    });

    // `registro_ont.id_cliente` no es una relación de Prisma (apunta a la tabla
    // que mantiene otro grupo), así que los clientes se traen aparte y
    // acotados a la empresa — que además es lo que impide leer clientes ajenos.
    const idsCliente = candidatos.map((c) => c.id_cliente).filter((x): x is number => x != null);
    const clientes = idsCliente.length
      ? await this.prisma.cliente.findMany({
          where: { id_cliente: { in: idsCliente }, id_empresa },
          select: { id_cliente: true, nombre_completo: true, rut: true, telefono: true },
        })
      : [];
    const clientePorId = new Map(clientes.map((c) => [c.id_cliente, c]));

    // El nombre de caja se compara normalizado: en la fuente convive
    // "NAP06" con "NAP 6".
    const delGrupo = filtro.caja
      ? candidatos.filter((c) => normalizarNombreCaja(c.odb) === filtro.caja)
      : candidatos;

    const ahora = Date.now();
    const afectados = delGrupo
      .map((c) => {
        const u = c.monitoreos[0];
        const potencia = u?.potencia_actual_dbm == null ? null : Number(u.potencia_actual_dbm);
        const caida = u?.estado_conexion != null && u.estado_conexion !== 'ONLINE';
        const cli = c.id_cliente == null ? null : clientePorId.get(c.id_cliente);
        // Cuando el cliente no está en nuestra base, la referencia de SmartOLT
        // viene con todo apelotonado en un campo: se desarma para mostrarla.
        const ficha = descomponerFicha(c.nombre_cliente_ext, c.direccion_cliente_ext);
        return {
          numero_serie: c.numero_serie,
          cliente: cli?.nombre_completo ?? ficha.nombre,
          rut: cli?.rut ?? ficha.rut,
          telefono: cli?.telefono ?? ficha.telefono,
          direccion: ficha.direccion,
          zona: c.zona,
          caja: c.odb,
          id_caja_nap: c.id_caja_nap,
          caja_confirmada: c.caja_confirmada_por != null,
          estado: u?.estado_conexion ?? null,
          potencia_dbm: potencia,
          potencia_fuera_de_rango: potenciaFueraDeRango(potencia),
          degradandose: potenciaEnFranjaPreventiva(potencia),
          desde: u?.timestamp_medicion ?? null,
          horas_asi:
            u?.timestamp_medicion && caida
              ? Math.floor((ahora - u.timestamp_medicion.getTime()) / 3_600_000)
              : null,
          // Caída hace más de DIAS_MAX_INCIDENTE: es equipo de un cliente dado
          // de baja, no parte del incidente. Se muestra igual —forma parte del
          // padrón de la caja— pero marcado, para que no se confunda con los
          // que se cayeron hoy.
          inactiva:
            !!u?.timestamp_medicion &&
            caida &&
            (ahora - u.timestamp_medicion.getTime()) / 86_400_000 > DIAS_MAX_INCIDENTE,
        };
      })
      // Primero lo que está peor: caídos, luego degradados, luego el resto.
      .sort((a, b) => {
        const peso = (x: typeof a) =>
          x.estado && x.estado !== 'ONLINE' ? 0 : x.potencia_fuera_de_rango ? 1 : x.degradandose ? 2 : 3;
        return peso(a) - peso(b) || (a.potencia_dbm ?? 0) - (b.potencia_dbm ?? 0);
      });

    return {
      alerta,
      total: afectados.length,
      caidos: afectados.filter((a) => a.estado && a.estado !== 'ONLINE').length,
      degradados: afectados.filter((a) => a.degradandose).length,
      afectados,
    };
  }

  /**
   * CU-16 / CU-21: genera la OT que despacha una alerta agregada.
   *
   * La OT es DE LA CAJA, no de un cliente: por eso `id_cliente` va en null y
   * los afectados se precargan en las observaciones. Es lo que pide la ficha
   * ("por zona/caja, no por SN") y también cómo se trabaja — una cuadrilla que
   * va a una caja atiende a todos sus clientes en la misma visita.
   *
   * Si la caja ya tiene una OT abierta generada desde otra alerta, no se crea
   * una segunda: se devuelve la existente. Dos cuadrillas al mismo poste es
   * justo lo que el agrupamiento venía a evitar.
   */
  async generarOt(id_alerta: number, id_empresa: number, id_usuario: number) {
    const alerta = await this.prisma.alerta_monitoreo.findFirst({
      where: { id_alerta, id_empresa },
      include: { caja: { select: { identificador_unico: true, latitud: true, longitud: true } } },
    });
    if (!alerta) throw new NotFoundException(`Alerta ${id_alerta} no encontrada`);
    if (alerta.id_ot_generada) {
      const ya = await this.prisma.orden_trabajo.findUnique({
        where: { id_ot: alerta.id_ot_generada },
      });
      if (ya) return { ot: ya, creada: false, motivo: 'Esta alerta ya generó una OT' };
    }

    // Las individuales llevan `clave_caja` para poder filtrarlas por caja, así
    // que el tipo es lo que decide la forma de la OT, no la presencia de esa
    // clave: agregada → OT de la caja; individual → OT del cliente.
    const AGREGADAS: string[] = [
      TIPO_ALERTA.FALLA_OLT,
      TIPO_ALERTA.FALLA_PLACA_OLT,
      TIPO_ALERTA.FALLA_CAJA_NAP,
      TIPO_ALERTA.POTENCIA_DEGRADANDOSE,
    ];
    if (!AGREGADAS.includes(alerta.tipo)) {
      return this.generarOtDeCliente(alerta, id_empresa, id_usuario);
    }
    const claveCaja = alerta.clave_caja;
    if (!claveCaja) {
      // No debería pasar: el motor siempre les pone clave a las agregadas.
      throw new BadRequestException('La alerta agregada no tiene identificada su caja');
    }

    // ¿Ya hay cuadrilla en camino a esta misma caja?
    const yaAbierta = await this.prisma.alerta_monitoreo.findFirst({
      where: {
        id_empresa,
        clave_caja: claveCaja,
        id_ot_generada: { not: null },
        ot_generada: { estado: { notIn: ['COMPLETADA', 'CANCELADA'] } },
      },
      include: { ot_generada: true },
    });
    if (yaAbierta?.ot_generada) {
      // Se vincula esta alerta a la OT que ya existe, en vez de duplicarla.
      await this.prisma.alerta_monitoreo.update({
        where: { id_alerta },
        data: { id_ot_generada: yaAbierta.ot_generada.id_ot },
      });
      return { ot: yaAbierta.ot_generada, creada: false, motivo: 'La caja ya tenía una OT abierta' };
    }

    const { afectados } = await this.detalle(id_alerta, id_empresa);
    const preventiva = alerta.tipo === TIPO_ALERTA.POTENCIA_DEGRADANDOSE;

    const nombreCaja = claveCaja.includes('|') ? claveCaja.split('|')[1] : claveCaja;
    // Una falla de OLT o de placa se atiende en la cabecera de red, no
    // recorriendo casas: listar 30 de 428 clientes seria ruido. En esas la OT
    // dice el equipo y el alcance; la lista de afectados solo va cuando la
    // accion es efectivamente ir a una caja.
    const esDeCaja =
      alerta.tipo === TIPO_ALERTA.FALLA_CAJA_NAP || alerta.tipo === TIPO_ALERTA.POTENCIA_DEGRADANDOSE;

    const bloques: string[] = [`Generada automáticamente desde el monitoreo de red.`, ''];

    if (esDeCaja) {
      bloques.push(`DÓNDE`, `  Caja ${nombreCaja}`);
      if (alerta.caja?.latitud) {
        bloques.push(`  https://www.google.com/maps?q=${alerta.caja.latitud},${alerta.caja.longitud}`);
      } else {
        bloques.push(`  (la caja no está ubicada en la topología de Tomodat)`);
      }
    } else {
      bloques.push(`DÓNDE`, `  ${nombreCaja}`, `  Se atiende en la cabecera de red, no en terreno.`);
    }

    bloques.push('', `QUÉ PASA`, `  ${alerta.mensaje}`);

    const relevantes = afectados
      .filter((a) => (preventiva ? a.degradandose || a.potencia_fuera_de_rango : true) && !a.inactiva)
      .slice(0, esDeCaja ? 30 : 0);

    if (relevantes.length) {
      const de = afectados.length > relevantes.length ? ` (de ${afectados.length} en la caja)` : '';
      bloques.push('', `CLIENTES A REVISAR — ${relevantes.length}${de}`);
      for (const a of relevantes) {
        const senal = a.potencia_dbm != null ? `${a.potencia_dbm} dBm` : 'sin señal';
        bloques.push(
          `  ${senal.padEnd(11)} ${a.cliente ?? a.numero_serie}`,
          `              ${a.direccion ?? 'sin dirección'}${a.telefono ? `  ·  ${a.telefono}` : ''}`,
        );
      }
    } else if (!esDeCaja) {
      bloques.push('', `ALCANCE`, `  ${alerta.afectados} clientes afectados por esta falla.`);
    }

    const observaciones = bloques.join('\n');

    const ot = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.orden_trabajo.create({
        data: {
          id_empresa,
          // Sin cliente: la OT es de la caja. Los afectados van en las
          // observaciones y la caja va en `id_caja_nap`, que es lo que la
          // pantalla usa para decir a dónde ir.
          id_cliente: null,
          id_caja_nap: alerta.id_caja_nap,
          tipo_ot: preventiva ? 'PREVENTIVO' : 'REPARACION',
          prioridad: preventiva ? 'MEDIA' : 'ALTA',
          estado: 'PENDIENTE',
          fecha_creacion: new Date(),
          observaciones,
        },
      });
      await tx.historial_ot.create({
        data: {
          id_ot: creada.id_ot,
          id_usuario,
          estado_anterior: null,
          estado_nuevo: 'PENDIENTE',
          observaciones: `Generada desde la alerta #${id_alerta}`,
          fecha_hora: new Date(),
        },
      });
      await tx.alerta_monitoreo.update({
        where: { id_alerta },
        data: { id_ot_generada: creada.id_ot },
      });
      return creada;
    });

    this.logger.log(
      `OT ${ot.id_ot} (${ot.tipo_ot}) generada desde la alerta ${id_alerta} — ${relevantes.length} clientes`,
    );
    return { ot, creada: true, clientes: relevantes.length };
  }

  /**
   * OT de una alerta individual: es un problema de un cliente, así que la OT va
   * atada a ese cliente como cualquier otra, con su dirección.
   */
  private async generarOtDeCliente(
    alerta: { id_alerta: number; tipo: string; mensaje: string | null; id_registro_ont: number | null },
    id_empresa: number,
    id_usuario: number,
  ) {
    const registro = alerta.id_registro_ont
      ? await this.prisma.registro_ont.findUnique({
          where: { id_registro_ont: alerta.id_registro_ont },
          select: {
            numero_serie: true,
            id_cliente: true,
            nombre_cliente_ext: true,
            direccion_cliente_ext: true,
          },
        })
      : null;
    if (!registro) throw new BadRequestException('La alerta no tiene una ONT asociada');

    // La dirección de servicio solo existe si el cliente está en nuestra base;
    // si no, la referencia de SmartOLT queda en las observaciones.
    const direccion = registro.id_cliente
      ? await this.prisma.direccion_servicio.findFirst({
          where: { id_cliente: registro.id_cliente, es_principal: true },
          select: { id_direccion: true },
        })
      : null;

    const ficha = descomponerFicha(registro.nombre_cliente_ext, registro.direccion_cliente_ext);
    const ot = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.orden_trabajo.create({
        data: {
          id_empresa,
          id_cliente: registro.id_cliente,
          id_direccion: direccion?.id_direccion ?? null,
          tipo_ot: 'REPARACION',
          prioridad: alerta.tipo === TIPO_ALERTA.SIN_SENAL ? 'ALTA' : 'MEDIA',
          estado: 'PENDIENTE',
          fecha_creacion: new Date(),
          observaciones:
            `OT generada automáticamente desde el monitoreo de red.\n\n` +
            `Motivo: ${alerta.mensaje}\n` +
            `ONT: ${registro.numero_serie}\n` +
            `Cliente (según SmartOLT): ${ficha.nombre ?? 's/d'}\n` +
            `Dirección (según SmartOLT): ${ficha.direccion ?? 's/d'}`,
        },
      });
      await tx.historial_ot.create({
        data: {
          id_ot: creada.id_ot,
          id_usuario,
          estado_anterior: null,
          estado_nuevo: 'PENDIENTE',
          observaciones: `Generada desde la alerta #${alerta.id_alerta}`,
          fecha_hora: new Date(),
        },
      });
      await tx.alerta_monitoreo.update({
        where: { id_alerta: alerta.id_alerta },
        data: { id_ot_generada: creada.id_ot },
      });
      return creada;
    });

    this.logger.log(`OT ${ot.id_ot} (REPARACION) generada desde la alerta ${alerta.id_alerta}`);
    return { ot, creada: true, clientes: 1 };
  }

  /** CU-52 / CU-08: el jefe técnico marca la alerta como revisada. */
  async revisar(id_alerta: number, id_empresa: number, id_usuario: number, observacion?: string) {
    const alerta = await this.prisma.alerta_monitoreo.findFirst({ where: { id_alerta, id_empresa } });
    if (!alerta) throw new NotFoundException(`Alerta ${id_alerta} no encontrada`);

    return this.prisma.alerta_monitoreo.update({
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
    const abiertas = await this.prisma.alerta_monitoreo.groupBy({
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
