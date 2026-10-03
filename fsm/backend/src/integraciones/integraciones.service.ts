import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { exigirEmpresaEnScope, type ApiScope } from '../common/guards/api-key.guard.js';
import { rutParaApi, filtroRut, variantesRut } from '../common/utils/rut.util.js';
import {
  ACCION_A_ESTADO_G1,
  DIAGNOSTICO_POR_DEFECTO,
  DIAGNOSTICO_RETIRO,
  ORIGENES_VALIDOS_G1,
  TRANSICIONES_G1,
  type AccionEquipo,
} from '../ordenes/estado-equipo.constants.js';
import { rangoDiaOperacion } from '../common/utils/dia-habil.util.js';
import type { PayloadCierre } from '../ordenes/fan-out/fan-out-cierre.js';
import { construirPayloadCierre, INCLUDE_PAYLOAD_CIERRE } from '../ordenes/fan-out/payload-cierre.js';
import { MOMENTO_FAN_OUT, estadosAvisados, type MomentoFanOut } from '../ordenes/fan-out/momento-fan-out.js';

const MAX_RANGO_DIAS = 90;


/**
 * El RUT que sale por `/api/integraciones/*` va en la grafia del contrato
 * (`12345678-5`), no en la que esta guardada.
 *
 * El webhook de cierre ya lo hacia; estos GET devolvian el valor crudo, de
 * modo que el mismo cierre llegaba con dos formatos segun si G8 lo recibia
 * por webhook o lo recuperaba por reconciliacion. G8 pidio por escrito que
 * los dos caminos produzcan el mismo resultado.
 */
function conRutDeContrato<T extends { rut?: string | null } | null>(c: T): T {
  return c ? { ...c, rut: rutParaApi(c.rut) } : c;
}

function conClienteDeContrato<
  T extends { cliente?: { rut?: string | null } | null },
>(fila: T): T {
  return 'cliente' in fila
    ? { ...fila, cliente: conRutDeContrato(fila.cliente ?? null) }
    : fila;
}

@Injectable()
export class IntegracionesService {
  constructor(
    private prisma: PrismaService,
    @Inject(MOMENTO_FAN_OUT) private momentoFanOut: MomentoFanOut,
  ) {}

  /**
   * Los cierres que ya se avisaron por webhook, que son los que G1 y G8 tienen
   * que poder reconciliar. Con el aviso al cierre del tecnico, una OT que
   * espera aprobacion ya se aviso (ver momento-fan-out.ts).
   */
  private get estadosCerrados() {
    return { in: estadosAvisados(this.momentoFanOut) };
  }

  // ---- helpers ----

  private exigirEmpresa(scope: ApiScope, id_empresa: number): number {
    return exigirEmpresaEnScope(scope, id_empresa);
  }

  /**
   * Convierte `desde`/`hasta` (YYYY-MM-DD, inclusivos) en un intervalo de
   * instantes semiabierto [gte, lt).
   *
   * Antes hacia `new Date('2026-09-06')` y lo usaba como `lte`. Eso es la
   * MEDIANOCHE UTC de ese dia, no su final, asi que:
   *   - una consulta de un solo dia (desde = hasta) devolvia practicamente
   *     nada: solo lo ocurrido exactamente a las 00:00 UTC;
   *   - en un rango, el ultimo dia quedaba fuera.
   * G1 y G8 usan esto para reconciliar cierres, o sea que perdian justo los
   * del dia que consultaban.
   *
   * El dia se toma en la zona de operacion, con el mismo helper que usan el
   * dashboard y la vista de terreno: si un cierre "del 6 de septiembre" cuenta
   * como del 6, tiene que ser el mismo 6 para todos.
   */
  private rango(desde?: string, hasta?: string): { gte: Date; lt: Date } {
    if (!desde || !hasta) throw new BadRequestException('desde y hasta son obligatorios (YYYY-MM-DD)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      throw new BadRequestException('Fechas inválidas: se espera YYYY-MM-DD');
    }
    // Mediodia UTC: cae dentro del dia calendario buscado en cualquier zona,
    // asi que el helper devuelve el rango del dia correcto sin depender del
    // offset ni del horario de verano.
    const dentroDe = (dia: string) => new Date(`${dia}T12:00:00Z`);
    if (isNaN(dentroDe(desde).getTime()) || isNaN(dentroDe(hasta).getTime())) {
      throw new BadRequestException('Fechas inválidas');
    }
    const { desde: gte } = rangoDiaOperacion(dentroDe(desde));
    const { hasta: lt } = rangoDiaOperacion(dentroDe(hasta));
    if (lt <= gte) throw new BadRequestException('hasta no puede ser anterior a desde');
    const dias = (lt.getTime() - gte.getTime()) / 86_400_000;
    if (dias > MAX_RANGO_DIAS) {
      throw new BadRequestException(`El rango no puede superar ${MAX_RANGO_DIAS} días`);
    }
    return { gte, lt };
  }

  // ---- OTs ----

  /** Listado de OT con cliente/técnico/dirección. Para T1-CU-61 (trabajos del día). */
  async ordenes(
    scope: ApiScope,
    q: { id_empresa: number; estado?: string; id_tecnico?: number; desde?: string; hasta?: string; page?: number; limit?: number },
  ) {
    const id_empresa = this.exigirEmpresa(scope, q.id_empresa);
    const page = q.page ?? 1;
    const limit = Math.min(q.limit ?? 50, 100);

    const where: Record<string, unknown> = { id_empresa };
    if (q.estado) where.estado = q.estado;
    if (q.id_tecnico) where.id_tecnico = q.id_tecnico;
    if (q.desde && q.hasta) {
      const { gte, lt } = this.rango(q.desde, q.hasta);
      where.fecha_creacion = { gte, lt };
    }

    const [data, total] = await Promise.all([
      this.prisma.orden_trabajo.findMany({
        where,
        orderBy: { fecha_creacion: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id_ot: true,
          tipo_ot: true,
          prioridad: true,
          estado: true,
          fecha_creacion: true,
          fecha_programada: true,
          fecha_completada: true,
          cliente: { select: { rut: true, nombre_completo: true, telefono: true } },
          tecnico: { select: { id_usuario: true, nombre_completo: true } },
          direccion: { select: { direccion_completa: true, comuna: true } },
        },
      }),
      this.prisma.orden_trabajo.count({ where }),
    ]);

    return { data: data.map(conClienteDeContrato), total, page, limit };
  }

  /** Cierres (OT COMPLETADAS) en un rango ≤90 días, con materiales. Para T1-CU-90. */
  async cierres(scope: ApiScope, q: { id_empresa: number; desde?: string; hasta?: string; page?: number }) {
    const id_empresa = this.exigirEmpresa(scope, q.id_empresa);
    const { gte, lt } = this.rango(q.desde, q.hasta);
    const page = q.page ?? 1;
    const limit = 100;

    const where = { id_empresa, estado: this.estadosCerrados, fecha_completada: { gte, lt } };
    const [data, total] = await Promise.all([
      this.prisma.orden_trabajo.findMany({
        where,
        orderBy: { fecha_completada: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id_ot: true,
          tipo_ot: true,
          fecha_completada: true,
          potencia_optica_dbm: true,
          id_categoria_falla: true,
          cliente: { select: { rut: true, nombre_completo: true } },
          tecnico: { select: { id_usuario: true, nombre_completo: true } },
          materiales: { select: { id_tipo_equipo: true, cantidad: true } },
          cierre_equipos: true,
        },
      }),
      this.prisma.orden_trabajo.count({ where }),
    ]);

    return { data: data.map(conClienteDeContrato), total, page, limit };
  }

  /**
   * P0-b del acuerdo con G8: estado y datos tecnicos de UNA OT, en cualquier
   * estado. Es la consulta oficial de seguimiento mientras la OT no se cierra;
   * el GET de `/cierre` solo sirve despues.
   *
   * No trae cliente ni persona: G8 ya los tiene, y lo que necesita saber aca es
   * en que va la OT. `origen_integracion` es null en las OT creadas en G3.
   */
  async orden(scope: ApiScope, id_ot: number, id_empresa: number) {
    if (!Number.isInteger(id_ot) || id_ot <= 0) throw new BadRequestException('id de OT invalido');
    this.exigirEmpresa(scope, id_empresa);

    const ot = await this.prisma.orden_trabajo.findFirst({
      where: { id_ot, id_empresa },
      select: {
        id_ot: true,
        id_empresa: true,
        tipo_ot: true,
        prioridad: true,
        estado: true,
        fecha_creacion: true,
        fecha_programada: true,
        fecha_completada: true,
        tecnico: { select: { id_usuario: true, nombre_completo: true } },
        solicitud_integracion: {
          select: {
            request_id: true,
            trace_id: true,
            id_contrato_externo: true,
            id_prospecto_externo: true,
            id_plan_externo: true,
          },
        },
      },
    });
    if (!ot) throw new NotFoundException(`OT ${id_ot} no encontrada en la empresa ${id_empresa}`);

    const { solicitud_integracion: s, ...resto } = ot;
    return {
      ...resto,
      tecnico: ot.tecnico ?? null,
      origen_integracion: s
        ? {
            request_id: s.request_id,
            trace_id: s.trace_id,
            id_contrato: s.id_contrato_externo,
            id_prospecto: s.id_prospecto_externo,
            id_plan: s.id_plan_externo,
          }
        : null,
    };
  }

  /**
   * Payload completo de un cierre — RECONCILIACIÓN. Devuelve exactamente lo
   * mismo que el webhook `fan-out`. G1 lo consume si el webhook falló.
   */
  async cierre(scope: ApiScope, id_ot: number, id_empresa: number): Promise<PayloadCierre> {
    this.exigirEmpresa(scope, id_empresa);

    const ot = await this.prisma.orden_trabajo.findFirst({
      where: { id_ot, id_empresa, estado: this.estadosCerrados },
      include: INCLUDE_PAYLOAD_CIERRE,
    });
    if (!ot) throw new NotFoundException(`OT ${id_ot} cerrada no encontrada en la empresa ${id_empresa}`);

    return construirPayloadCierre(ot);
  }

  // ---- catálogo / clientes ----

  /** Catálogo global de categorías de falla. Para T1-CU-70. */
  async categoriasFalla() {
    return this.prisma.categoria_falla.findMany({
      select: { id_categoria: true, nombre: true, sla_horas: true },
      orderBy: { nombre: 'asc' },
    });
  }

  async clientePorRut(scope: ApiScope, id_empresa: number, rut: string) {
    this.exigirEmpresa(scope, id_empresa);
    const cliente = await this.prisma.cliente.findFirst({
      where: { rut: { in: variantesRut(rut) }, id_empresa },
      select: {
        id_cliente: true,
        rut: true,
        nombre_completo: true,
        email: true,
        telefono: true,
        estado: true,
        direcciones: {
          where: { es_principal: true },
          select: { direccion_completa: true, comuna: true, ciudad: true },
        },
      },
    });
    if (!cliente) throw new NotFoundException(`Cliente ${rut} no encontrado en la empresa ${id_empresa}`);
    return conRutDeContrato(cliente);
  }

  async buscarClientes(scope: ApiScope, id_empresa: number, busqueda: string) {
    this.exigirEmpresa(scope, id_empresa);
    if (!busqueda || busqueda.trim().length < 3) {
      throw new BadRequestException('busqueda: mínimo 3 caracteres');
    }
    const q = busqueda.trim();
    // Un termino sin digitos no es un RUT: filtroRut lo descarta para que la
    // busqueda por nombre no arrastre la rama del RUT.
    const porRut = filtroRut(q);
    const encontrados = await this.prisma.cliente.findMany({
      where: {
        id_empresa,
        OR: [
          ...(porRut ? [{ rut: porRut }] : []),
          { nombre_completo: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 25,
      select: { id_cliente: true, rut: true, nombre_completo: true, telefono: true, estado: true },
      orderBy: { nombre_completo: 'asc' },
    });
    return encontrados.map(conRutDeContrato);
  }

  /**
   * Todo lo que G1 y G3 tienen que compartir sobre estados de equipo, en un
   * solo lugar, para que ninguno de los dos copie literales a mano.
   *
   * Reemplaza al mapeo plano anterior, que Javier pidio actualizar con los
   * origenes: aquella forma no tenia donde ponerlos. Ademas traia un
   * `confirmado_por_g1` calculado a mano que ya habia quedado desactualizado
   * --decia que "En revisión" seguia sin confirmar cuando G1 lo confirmo el
   * 4-sept-- y por eso se elimina en vez de arreglarse: un flag que hay que
   * recordar mantener vuelve a mentir.
   */
  mapeoEstados() {
    return {
      acciones: Object.entries(ACCION_A_ESTADO_G1).map(([accion, estado_destino]) => ({
        accion: accion as AccionEquipo,
        estado_destino,
        origenes_validos: ORIGENES_VALIDOS_G1[accion as AccionEquipo],
      })),
      transiciones: TRANSICIONES_G1,
      diagnosticos: Object.values(DIAGNOSTICO_RETIRO),
      diagnostico_por_defecto: DIAGNOSTICO_POR_DEFECTO,
    };
  }
}
