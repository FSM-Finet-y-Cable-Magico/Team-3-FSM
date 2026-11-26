import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import type { OntDetalle } from './fuente/fuente-monitoreo.js';
import { ejecutarEnLotes } from './lotes.js';

export interface RegistroResuelto {
  id_registro_ont: number;
  id_unidad: number | null;
  id_cliente: number | null;
  id_caja_nap: number | null;
  /** Cuándo la ingesta vio la ONT por primera vez. */
  primera_vez: Date;
}

/**
 * Mantiene la tabla `registro_ont`: una fila por ONT vista en la fuente,
 * identificada por su número de serie.
 *
 * Es lo que le da identidad a una ONT antes de que exista como `unidad_equipo`
 * (G1) o esté ligada a un `cliente` (G8). Cuando esos enlaces se puedan
 * resolver (cruce por `numero_serie` contra `unidad_equipo`), se completan acá.
 */
@Injectable()
export class RegistroOntService {
  private readonly logger = new Logger(RegistroOntService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Empresa dueña de las credenciales de la fuente. Las de SmartOLT son de una
   * empresa concreta, así que TODA la ONT que entra por ahí es de esa empresa —
   * no se deduce por fila. Configurable por si mañana hay una fuente por
   * empresa; hoy es una sola.
   *
   * Publico porque es la unica fuente de verdad sobre "de quien es lo que entra
   * por la fuente", y `MonitoreoService` la necesita para saber a que sala del
   * WebSocket publicar. Duplicar la lectura de la variable en dos servicios es
   * como terminan desincronizados.
   */
  get idEmpresaFuente(): number {
    return Number(this.config.get('MONITOREO_ID_EMPRESA') ?? 1);
  }

  /**
   * Garantiza una fila de `registro_ont` por cada SN. Crea las que falten (con
   * lo mínimo), y devuelve el mapa SN → ids resueltos.
   */
  async asegurarRegistros(sns: string[]): Promise<Map<string, RegistroResuelto>> {
    const mapa = new Map<string, RegistroResuelto>();
    if (sns.length === 0) return mapa;

    const existentes = await this.prisma.registro_ont.findMany({
      where: { numero_serie: { in: sns } },
    });
    const porSn = new Map(existentes.map((r) => [r.numero_serie, r]));

    const faltantes = sns.filter((sn) => !porSn.has(sn));
    if (faltantes.length) {
      // Una sola sentencia en vez de un INSERT por ONT: la primera ingesta
      // trae 941 seriales, y ese bucle eran 941 viajes a la base.
      //
      // `skipDuplicates` no es decorativo: dos ciclos de ingesta solapados
      // pueden calcular la misma lista de faltantes, y el segundo chocaria
      // contra el unique de `numero_serie`. Con esto el segundo no crea nada
      // y la relectura de abajo recupera igual las filas del primero.
      await this.prisma.registro_ont.createMany({
        data: faltantes.map((sn) => ({ numero_serie: sn, id_empresa: this.idEmpresaFuente })),
        skipDuplicates: true,
      });

      // `createMany` no devuelve las filas creadas, y hacen falta sus ids.
      const creadas = await this.prisma.registro_ont.findMany({
        where: { numero_serie: { in: faltantes } },
      });
      for (const r of creadas) porSn.set(r.numero_serie, r);
    }

    // Backfill: las filas creadas antes de que existiera la columna quedaron en
    // null y el motor de alertas no las vería.
    const sinEmpresa = [...porSn.values()].filter((r) => r.id_empresa == null).map((r) => r.numero_serie);
    if (sinEmpresa.length) {
      await this.prisma.registro_ont.updateMany({
        where: { numero_serie: { in: sinEmpresa } },
        data: { id_empresa: this.idEmpresaFuente },
      });
    }
    if (faltantes.length) {
      this.logger.log(`registro_ont: ${faltantes.length} ONT nuevas`);
    }

    for (const [sn, r] of porSn) {
      mapa.set(sn, {
        id_registro_ont: r.id_registro_ont,
        id_unidad: r.id_unidad,
        id_cliente: r.id_cliente,
        id_caja_nap: r.id_caja_nap,
        primera_vez: r.primera_vez,
      });
    }
    return mapa;
  }

  /**
   * Enriquece los registros con el censo de la fuente (topología, datos de
   * cliente externos) y con el cruce por `numero_serie` contra `unidad_equipo`
   * para resolver `id_unidad` / `id_cliente` / `id_caja_nap`.
   *
   * Barato de llamar: solo escribe si algo cambió. El poller lo corre de vez en
   * cuando, no en cada tick.
   */
  async enriquecer(detalles: OntDetalle[]): Promise<number> {
    if (detalles.length === 0) return 0;

    const sns = detalles.map((d) => d.sn);
    const unidades = await this.prisma.unidad_equipo.findMany({
      // `numero_serie` es unico global, asi que un serial pertenece a una sola
      // empresa. Sin acotar por la empresa dueña de la fuente, un serial que la
      // OLT de una reporta pero que esta registrado en la otra escribiria su
      // id_cliente / id_caja_nap dentro de nuestro registro_ont.
      where: { numero_serie: { in: sns }, id_empresa: this.idEmpresaFuente },
      select: {
        numero_serie: true,
        id_unidad: true,
        id_cliente_instalado: true,
        id_caja_nap: true,
      },
    });
    const unidadPorSn = new Map(unidades.map((u) => [u.numero_serie, u]));

    let tocados = 0;
    for (const d of detalles) {
      const u = unidadPorSn.get(d.sn);
      await this.prisma.registro_ont.upsert({
        where: { numero_serie: d.sn },
        create: {
          numero_serie: d.sn,
          id_externo: d.id_externo,
          olt_externo: d.olt_externo,
          board: d.board,
          puerto_pon: d.puerto_pon,
          zona: d.zona,
          odb: d.odb,
          ...(d.odb_puerto !== undefined ? { odb_puerto: d.odb_puerto } : {}),
          modelo: d.modelo,
          nombre_cliente_ext: d.nombre_cliente,
          direccion_cliente_ext: d.direccion_cliente,
          id_unidad: u?.id_unidad ?? null,
          id_cliente: u?.id_cliente_instalado ?? null,
          id_caja_nap: u?.id_caja_nap ?? null,
        },
        update: {
          id_externo: d.id_externo,
          olt_externo: d.olt_externo,
          board: d.board,
          puerto_pon: d.puerto_pon,
          zona: d.zona,
          odb: d.odb,
          ...(d.odb_puerto !== undefined ? { odb_puerto: d.odb_puerto } : {}),
          modelo: d.modelo,
          nombre_cliente_ext: d.nombre_cliente,
          direccion_cliente_ext: d.direccion_cliente,
          ...(u
            ? {
                id_unidad: u.id_unidad,
                id_cliente: u.id_cliente_instalado ?? null,
                id_caja_nap: u.id_caja_nap ?? null,
              }
            : {}),
        },
      });
      tocados++;
    }
    this.logger.log(`registro_ont: ${tocados} enriquecidas desde el censo`);
    return tocados;
  }

  /**
   * Mantiene al dia DONDE esta cada ONT segun la fuente: su puerto PON (OLT,
   * placa, puerto), su zona, su caja (`odb`) y su puerto en la caja
   * (`odb_puerto`).
   *
   * Corre en cada sondeo y sobre TODAS las ONT del censo, no solo las que no
   * tienen unidad como `enriquecer`: si no, una ONT ya enlazada a G1 nunca se
   * enteraria de que la movieron de caja ni recibiria su puerto. Van todos
   * juntos porque la identidad de la caja es "puerto PON + nombre": actualizar
   * solo el nombre dejaria a la ONT en una caja que no existe. Escribe solo las
   * filas que cambiaron, asi que en un sondeo normal no escribe nada.
   *
   * `odb_puerto` undefined es "la fuente no lo sabe" y no se toca; null es
   * "SmartOLT dice que no tiene" y se escribe.
   *
   * Con `censoCompleto` (el sondeo sin filtro), las ONT de la empresa que ya no
   * aparecen en el censo sueltan su puerto: una ONT reemplazada y borrada de
   * SmartOLT lo dejaba tomado para siempre. No se hace con un censo vacio, que
   * es mas probable que sea una falla que una red sin clientes.
   *
   * @returns cuantas ONT del censo cambiaron.
   */
  async sincronizarUbicacion(
    detalles: OntDetalle[],
    opciones: { censoCompleto?: boolean } = {},
  ): Promise<number> {
    if (detalles.length === 0) return 0;
    const sns = detalles.map((d) => d.sn);

    const actuales = await this.prisma.registro_ont.findMany({
      where: { numero_serie: { in: sns }, id_empresa: this.idEmpresaFuente },
      select: {
        numero_serie: true,
        olt_externo: true,
        board: true,
        puerto_pon: true,
        zona: true,
        odb: true,
        odb_puerto: true,
      },
    });
    const porSn = new Map(actuales.map((r) => [r.numero_serie, r]));

    type Ubicacion = {
      olt_externo?: string | null;
      board?: number | null;
      puerto_pon?: number | null;
      zona?: string | null;
      odb?: string | null;
      odb_puerto?: number | null;
    };
    const cambios: (() => PromiseLike<unknown>)[] = [];
    for (const d of detalles) {
      const r = porSn.get(d.sn);
      if (!r) continue;
      const data: Ubicacion = {};
      if (r.olt_externo !== d.olt_externo) data.olt_externo = d.olt_externo;
      if (r.board !== d.board) data.board = d.board;
      if (r.puerto_pon !== d.puerto_pon) data.puerto_pon = d.puerto_pon;
      if (r.zona !== d.zona) data.zona = d.zona;
      if (r.odb !== d.odb) data.odb = d.odb;
      if (d.odb_puerto !== undefined && r.odb_puerto !== d.odb_puerto) data.odb_puerto = d.odb_puerto;
      if (Object.keys(data).length > 0) {
        cambios.push(() => this.prisma.registro_ont.update({ where: { numero_serie: d.sn }, data }));
      }
    }

    const liberar = opciones.censoCompleto
      ? [
          () =>
            this.prisma.registro_ont.updateMany({
              where: { id_empresa: this.idEmpresaFuente, numero_serie: { notIn: sns }, odb_puerto: { not: null } },
              data: { odb_puerto: null },
            }),
        ]
      : [];

    // Sin transaccion: cada fila es independiente (ver `ejecutarEnLotes`).
    await ejecutarEnLotes([...cambios, ...liberar]);
    return cambios.length;
  }
}
