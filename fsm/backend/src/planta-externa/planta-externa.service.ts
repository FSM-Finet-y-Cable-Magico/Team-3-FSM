import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { parsearKml, type NodoTopologia } from './kml-parser.js';

export interface ResumenImportKml {
  leidos: number;
  descartados: number;
  olts: number;
  mufas: number;
  cajas_nap: number;
  puertos_creados: number;
}

@Injectable()
export class PlantaExternaService {
  private readonly logger = new Logger(PlantaExternaService.name);

  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Importación de topología desde KML (Tomodat / cualquier GIS)
  // ---------------------------------------------------------------------------

  async importarKml(xml: string, id_empresa: number | null): Promise<ResumenImportKml> {
    const { nodos, descartados } = parsearKml(xml);
    const r: ResumenImportKml = {
      leidos: nodos.length,
      descartados,
      olts: 0,
      mufas: 0,
      cajas_nap: 0,
      puertos_creados: 0,
    };

    for (const n of nodos.filter((x) => x.tipo === 'OLT')) {
      await this.upsertOlt(n, id_empresa);
      r.olts++;
    }
    for (const n of nodos.filter((x) => x.tipo === 'MUFA')) {
      await this.upsertMufa(n);
      r.mufas++;
    }
    for (const n of nodos.filter((x) => x.tipo === 'CAJA_NAP')) {
      r.puertos_creados += await this.upsertCaja(n, id_empresa);
      r.cajas_nap++;
    }

    this.logger.log(
      `Import KML: ${r.olts} OLT, ${r.mufas} mufas, ${r.cajas_nap} cajas NAP, ` +
        `${r.puertos_creados} puertos, ${r.descartados} descartados`,
    );
    return r;
  }

  private async upsertOlt(n: NodoTopologia, id_empresa: number | null) {
    const ubicacion = coordsATexto(n) ?? n.atributos['ubicacion'] ?? null;
    const existente = await this.prisma.olt.findFirst({ where: { nombre: n.nombre } });
    if (existente) {
      await this.prisma.olt.update({
        where: { id_olt: existente.id_olt },
        data: { ubicacion, ip_gestion: n.atributos['ip'] ?? n.atributos['ip_gestion'] ?? undefined },
      });
    } else {
      await this.prisma.olt.create({
        data: {
          nombre: n.nombre,
          ubicacion,
          ip_gestion: n.atributos['ip'] ?? n.atributos['ip_gestion'] ?? null,
          id_empresa,
        },
      });
    }
  }

  private async upsertMufa(n: NodoTopologia) {
    if (!n.identificador) return;
    const ubicacion = coordsATexto(n) ?? n.atributos['ubicacion'] ?? null;
    const existente = await this.prisma.mufa.findFirst({
      where: { identificador: n.identificador },
    });
    if (existente) {
      await this.prisma.mufa.update({ where: { id_mufa: existente.id_mufa }, data: { ubicacion } });
    } else {
      await this.prisma.mufa.create({ data: { identificador: n.identificador, ubicacion } });
    }
  }

  /** Devuelve cuántos puertos creó. */
  private async upsertCaja(n: NodoTopologia, id_empresa: number | null): Promise<number> {
    const identificador_unico = n.identificador;
    if (!identificador_unico) return 0;

    const id_mufa = n.padre
      ? ((await this.prisma.mufa.findFirst({ where: { identificador: n.padre } }))?.id_mufa ?? null)
      : null;

    const data = {
      zona: n.zona ?? undefined,
      capacidad_puertos: n.capacidad ?? undefined,
      latitud: n.latitud ?? undefined,
      longitud: n.longitud ?? undefined,
      numero_poste: n.atributos['poste'] ?? undefined,
      id_mufa: id_mufa ?? undefined,
    };

    const caja = await this.prisma.caja_nap.upsert({
      where: { identificador_unico },
      create: { identificador_unico, id_empresa, ...data },
      update: data,
    });

    // Crea los puertos de la caja si todavía no tiene ninguno.
    const cap = n.capacidad ?? 0;
    if (cap > 0) {
      const existentes = await this.prisma.puerto_nap.count({ where: { id_caja_nap: caja.id_caja_nap } });
      if (existentes === 0) {
        await this.prisma.puerto_nap.createMany({
          data: Array.from({ length: cap }, (_, i) => ({
            id_caja_nap: caja.id_caja_nap,
            numero_puerto: i + 1,
            estado: 'LIBRE',
          })),
        });
        return cap;
      }
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Lecturas
  // ---------------------------------------------------------------------------

  /** Árbol OLT → tarjetas → mufas → cajas → puertos. */
  async arbolOlts(id_empresa: number) {
    return this.prisma.olt.findMany({
      where: { OR: [{ id_empresa }, { id_empresa: null }] },
      orderBy: { nombre: 'asc' },
      include: {
        tarjetas: {
          include: {
            mufas: {
              include: {
                cajas_nap: {
                  include: { _count: { select: { puertos: true } } },
                },
              },
            },
          },
        },
      },
    });
  }

  /** Cajas NAP con ocupación de puertos. */
  async listarCajas(id_empresa: number) {
    const cajas = await this.prisma.caja_nap.findMany({
      where: { OR: [{ id_empresa }, { id_empresa: null }] },
      orderBy: { identificador_unico: 'asc' },
      include: { puertos: { select: { estado: true } } },
    });

    return cajas.map((c) => {
      const total = c.puertos.length;
      const ocupados = c.puertos.filter((p) => (p.estado ?? '').toUpperCase() === 'OCUPADO').length;
      return {
        id_caja_nap: c.id_caja_nap,
        identificador_unico: c.identificador_unico,
        zona: c.zona,
        numero_poste: c.numero_poste,
        latitud: c.latitud,
        longitud: c.longitud,
        capacidad_puertos: c.capacidad_puertos ?? total,
        puertos_ocupados: ocupados,
        puertos_libres: Math.max(0, (c.capacidad_puertos ?? total) - ocupados),
      };
    });
  }

  async detalleCaja(id_caja_nap: number) {
    const caja = await this.prisma.caja_nap.findUnique({
      where: { id_caja_nap },
      include: {
        mufa: { select: { id_mufa: true, identificador: true } },
        puertos: {
          orderBy: { numero_puerto: 'asc' },
          include: { cliente_asociado: { select: { id_cliente: true, nombre_completo: true, rut: true } } },
        },
      },
    });
    if (!caja) throw new NotFoundException(`Caja NAP ${id_caja_nap} no encontrada`);
    return caja;
  }

  /** Cajas con coordenadas, para pintar un mapa. */
  async mapa(id_empresa: number) {
    const cajas = await this.listarCajas(id_empresa);
    return cajas
      .filter((c) => c.latitud != null && c.longitud != null)
      .map((c) => ({
        ...c,
        // pista de estado para el color del pin
        estado:
          c.puertos_libres === 0 ? 'LLENA' : c.puertos_libres <= 2 ? 'CASI_LLENA' : 'DISPONIBLE',
      }));
  }

  // ---------------------------------------------------------------------------
  // Datos de demo (solo dev)
  // ---------------------------------------------------------------------------

  /**
   * Liga las 3 primeras ONT del mock a clientes y cajas NAP, simulando lo que
   * hará el enriquecimiento desde Tomodat/SmartOLT. Deja la cadena completa
   * (SN → cliente → caja → puerto) para poder demostrar el monitoreo sin
   * credenciales. Idempotente. Requiere haber importado el KML de ejemplo.
   */
  async sembrarDemo() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('sembrarDemo está deshabilitado en producción');
    }

    const finet = await this.prisma.empresa.findFirst({
      where: { nombre: { contains: 'FiNet' } },
    });

    const demo = [
      { sn: 'SN-0001', rut: '11111111-1', nombre: 'Juana Pérez', dir: 'Av. Costanera 100', comuna: 'Cartagena', caja: 'NAP-CTG-01' },
      { sn: 'SN-0002', rut: '22222222-2', nombre: 'Pedro Soto', dir: 'Calle El Muelle 25', comuna: 'Cartagena', caja: 'NAP-CTG-01' },
      { sn: 'SN-0003', rut: '33333333-3', nombre: 'Ana Rojas', dir: 'Los Aromos 8', comuna: 'San Antonio', caja: 'NAP-SA-01' },
    ];

    for (const d of demo) {
      const cliente = await this.prisma.cliente.upsert({
        where: { rut: d.rut },
        create: {
          rut: d.rut,
          nombre_completo: d.nombre,
          estado: 'ACTIVO',
          id_empresa: finet?.id_empresa,
          direcciones: { create: { direccion_completa: d.dir, comuna: d.comuna, es_principal: true } },
        },
        update: {},
      });

      const caja = await this.prisma.caja_nap.findUnique({
        where: { identificador_unico: d.caja },
      });

      if (caja) {
        const yaTiene = await this.prisma.puerto_nap.findFirst({
          where: { id_caja_nap: caja.id_caja_nap, id_cliente_asociado: cliente.id_cliente },
        });
        if (!yaTiene) {
          const libre = await this.prisma.puerto_nap.findFirst({
            where: { id_caja_nap: caja.id_caja_nap, estado: 'LIBRE' },
            orderBy: { numero_puerto: 'asc' },
          });
          if (libre) {
            await this.prisma.puerto_nap.update({
              where: { id_puerto: libre.id_puerto },
              data: { estado: 'OCUPADO', id_cliente_asociado: cliente.id_cliente },
            });
          }
        }
      }

      await this.prisma.registro_ont.upsert({
        where: { numero_serie: d.sn },
        create: {
          numero_serie: d.sn,
          id_cliente: cliente.id_cliente,
          id_caja_nap: caja?.id_caja_nap ?? null,
          nombre_cliente_ext: d.nombre,
        },
        update: { id_cliente: cliente.id_cliente, id_caja_nap: caja?.id_caja_nap ?? null },
      });
    }

    this.logger.log(`Demo sembrada: ${demo.length} clientes ligados a ONT + caja NAP`);
    return { ok: true, clientes: demo.length };
  }
}

function coordsATexto(n: NodoTopologia): string | null {
  if (n.latitud == null || n.longitud == null) return null;
  return `${n.latitud.toFixed(6)}, ${n.longitud.toFixed(6)}`;
}
