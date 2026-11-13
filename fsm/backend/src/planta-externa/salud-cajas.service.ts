import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from '../monitoreo/alertas.service.js';
import { claveDeCaja, esInactiva, type EstadoOnt } from '../monitoreo/reglas-alerta.js';
import { armarSaludCajas } from './salud-cajas.js';
import { distanciaMetros } from './topologia.service.js';

const OT_CERRADA = ['COMPLETADA', 'CANCELADA'];

/**
 * Lectura del mapa de salud de la red (`/admin/topologia`). Ver `salud-cajas.ts`
 * para las reglas; aca solo se junta lo que hace falta de la base.
 *
 * Las ONT salen de `AlertasService.cargarEstado`, la misma consulta del motor
 * de alertas y del panel de criticos: que las tres pantallas lean del mismo
 * lugar es lo que impide que se contradigan.
 */
@Injectable()
export class SaludCajasService {
  constructor(
    private prisma: PrismaService,
    private alertas: AlertasService,
  ) {}

  async listar(id_empresa: number) {
    const { cajas, onts, alertas, ots } = await this.cargar(id_empresa);
    return armarSaludCajas(cajas, onts, alertas, ots, new Date());
  }

  async detalle(id_caja_nap: number, id_empresa: number) {
    const ahora = new Date();
    const { cajas, onts, alertas, ots } = await this.cargar(id_empresa);
    const fila = cajas.find((c) => c.id_caja_nap === id_caja_nap);
    if (!fila) throw new NotFoundException(`Caja ${id_caja_nap} no encontrada`);

    const { cajas: salud } = armarSaludCajas(cajas, onts, alertas, ots, ahora);
    const caja = salud.find((c) => c.id_caja_nap === id_caja_nap)!;
    const suyas = onts.filter((o) => o.id_caja_nap === id_caja_nap);

    const [alertasCaja, otsCaja] = await Promise.all([
      this.prisma.alerta_monitoreo.findMany({
        where: { id_empresa, id_caja_nap, resuelta: false },
        orderBy: { creada_en: 'desc' },
        select: {
          id_alerta: true,
          tipo: true,
          severidad: true,
          mensaje: true,
          afectados: true,
          creada_en: true,
          id_ot_generada: true,
        },
      }),
      this.prisma.orden_trabajo.findMany({
        where: { id_empresa, id_caja_nap },
        orderBy: { fecha_creacion: 'desc' },
        take: 10,
        select: {
          id_ot: true,
          tipo_ot: true,
          estado: true,
          prioridad: true,
          fecha_creacion: true,
          fecha_completada: true,
          tecnico: { select: { nombre_completo: true } },
        },
      }),
    ]);

    return {
      caja: {
        ...caja,
        mufa: (fila as { mufa?: { identificador: string | null } | null }).mufa?.identificador ?? null,
      },
      onts: suyas
        .map((o) => ({
          numero_serie: o.numero_serie,
          id_cliente: o.id_cliente,
          nombre_cliente: o.nombre_cliente ?? null,
          estado_conexion: o.estado_conexion,
          potencia_dbm: o.potencia_dbm,
          sin_senal_desde: o.sin_senal_desde,
          odb: o.odb ?? null,
          odb_puerto: o.odb_puerto ?? null,
          olt_externo: o.olt_externo,
          board: o.board,
          puerto_pon: o.puerto_pon,
          // Se muestra, marcada, en vez de esconderla: es lo que permite ver
          // que la caja tiene equipos viejos que nadie dio de baja.
          posible_baja: esInactiva(o, ahora),
        }))
        .sort((a, b) => (a.odb_puerto ?? 999) - (b.odb_puerto ?? 999) || a.numero_serie.localeCompare(b.numero_serie)),
      claves_smartolt: clavesPorFrecuencia(suyas),
      alertas: alertasCaja,
      // Las 10 mas recientes, abiertas o no: el historial de la caja tambien
      // le dice al jefe tecnico si es un punto que falla seguido.
      ots: otsCaja,
      cercanas: cercanas(caja, salud),
    };
  }

  private async cargar(id_empresa: number) {
    const [cajas, onts, alertas, ots] = await Promise.all([
      this.prisma.caja_nap.findMany({
        // Igual que el resto de la topologia: el KML importa cajas sin dueño.
        where: { OR: [{ id_empresa }, { id_empresa: null }] },
        select: {
          id_caja_nap: true,
          identificador_unico: true,
          zona: true,
          numero_poste: true,
          latitud: true,
          longitud: true,
          mufa: { select: { identificador: true } },
        },
      }),
      this.alertas.cargarEstado(id_empresa),
      this.prisma.alerta_monitoreo.findMany({
        where: { id_empresa, resuelta: false, id_caja_nap: { not: null } },
        select: { id_caja_nap: true, tipo: true },
      }),
      this.prisma.orden_trabajo.findMany({
        where: { id_empresa, estado: { notIn: OT_CERRADA }, id_caja_nap: { not: null } },
        select: { id_caja_nap: true },
      }),
    ]);
    return { cajas, onts, alertas, ots };
  }
}

/**
 * Claves SmartOLT (`olt/placa/puerto|NOMBRE`) de las ONT de la caja, de la mas
 * usada a la menos. Una caja de Tomodat puede calzar con mas de una caja de
 * SmartOLT; se entregan todas para no esconder ese desacuerdo.
 */
function clavesPorFrecuencia(onts: EstadoOnt[]): string[] {
  const n = new Map<string, number>();
  for (const o of onts) {
    const k = claveDeCaja(o);
    if (k) n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

function cercanas<T extends { id_caja_nap: number; latitud: number | null; longitud: number | null }>(
  origen: T,
  todas: T[],
  cuantas = 5,
) {
  if (origen.latitud == null || origen.longitud == null) return [];
  return todas
    .filter((c) => c.id_caja_nap !== origen.id_caja_nap && c.latitud != null && c.longitud != null)
    .map((c) => ({
      ...c,
      distancia_m: Math.round(distanciaMetros(origen.latitud!, origen.longitud!, c.latitud!, c.longitud!)),
    }))
    .sort((a, b) => a.distancia_m - b.distancia_m)
    .slice(0, cuantas);
}
