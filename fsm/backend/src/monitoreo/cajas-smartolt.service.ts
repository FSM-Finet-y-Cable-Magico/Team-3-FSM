import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from './alertas.service.js';
import { claveDeCaja, type EstadoOnt } from './reglas-alerta.js';
import {
  armarGrilla,
  cabeceraDeCaja,
  type CabeceraCaja,
  type EntradaCatalogo,
  type GrillaDeCaja,
} from './cajas-smartolt.js';

export interface ResumenCajaSmartolt extends CabeceraCaja {
  capacidad: number;
  capacidad_estimada: boolean;
  ocupados: number;
  /** ONT de la caja, con y sin puerto. */
  ont_total: number;
  /** ONT de la caja sin puerto en SmartOLT. */
  sin_puerto: number;
}

export type DetalleCajaSmartolt = CabeceraCaja & GrillaDeCaja;

/**
 * Cajas NAP tal como las conoce SmartOLT, con la ocupacion de sus puertos.
 *
 * Usa `cargarEstado`, el mismo lector del motor de alertas y del panel de
 * criticos, y la misma clave de caja: las tres vistas hablan de las mismas
 * cajas. A diferencia del panel, NO saca las bajas: un equipo dado de baja
 * sigue enchufado a su puerto hasta que alguien lo retira.
 */
@Injectable()
export class CajasSmartoltService {
  constructor(
    private prisma: PrismaService,
    private alertas: AlertasService,
  ) {}

  private async cargar(id_empresa: number) {
    const [onts, catalogo] = await Promise.all([
      this.alertas.cargarEstado(id_empresa),
      this.prisma.odb_smartolt.findMany({
        where: { id_empresa },
        select: { nombre: true, capacidad: true },
      }) as Promise<EntradaCatalogo[]>,
    ]);
    const grupos = new Map<string, EstadoOnt[]>();
    for (const o of onts) {
      const k = claveDeCaja(o);
      if (!k) continue;
      const lista = grupos.get(k);
      if (lista) lista.push(o);
      else grupos.set(k, [o]);
    }
    return { grupos, catalogo };
  }

  async listar(id_empresa: number, zona?: string): Promise<ResumenCajaSmartolt[]> {
    const ahora = new Date();
    const { grupos, catalogo } = await this.cargar(id_empresa);
    const z = zona?.trim().toLowerCase();
    return [...grupos]
      .map(([clave, miembros]) => {
        const g = armarGrilla(miembros, catalogo, ahora);
        return {
          ...cabeceraDeCaja(clave, miembros),
          capacidad: g.capacidad,
          capacidad_estimada: g.capacidad_estimada,
          ocupados: g.ocupados,
          ont_total: miembros.length,
          sin_puerto: g.sin_puerto.length,
        };
      })
      .filter((c) => !z || (c.zona ?? '').toLowerCase().includes(z))
      // `numeric` para que "NAP 9" vaya antes que "NAP 10".
      .sort(
        (a, b) =>
          (a.zona ?? '~').localeCompare(b.zona ?? '~', 'es', { numeric: true }) ||
          a.nombre.localeCompare(b.nombre, 'es', { numeric: true }),
      );
  }

  async detalle(id_empresa: number, clave: string): Promise<DetalleCajaSmartolt> {
    const { grupos, catalogo } = await this.cargar(id_empresa);
    const miembros = grupos.get(clave);
    if (!miembros) throw new NotFoundException(`Caja ${clave} no encontrada`);
    return { ...cabeceraDeCaja(clave, miembros), ...armarGrilla(miembros, catalogo, new Date()) };
  }
}
