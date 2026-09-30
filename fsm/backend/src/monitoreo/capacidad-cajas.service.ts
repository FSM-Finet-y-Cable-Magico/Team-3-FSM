import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FUENTE_MONITOREO, type FuenteMonitoreo } from './fuente/fuente-monitoreo.js';

/**
 * Trim, mayúsculas y espacios colapsados. Nada más, y es a propósito.
 *
 * NO se usa `normalizarNombreCaja`, que es el del ligado. Aquel es tolerante
 * por diseño --parte letra/dígito y quita ceros a la izquierda-- porque cruza
 * dos sistemas distintos: nombres que escribieron los instaladores en SmartOLT
 * contra los del KML de Tomodat. Acá los dos lados son cadenas del MISMO
 * sistema, el `odb` del censo contra el `name` del catálogo, así que no hay
 * nada que tolerar.
 *
 * Y tolerar de más haría daño: `NAP 7`, `NAP-07` y `NAP07` colapsan a la misma
 * clave con aquel normalizador, y en SmartOLT son TRES cajas distintas, en tres
 * zonas y tres puertos PON distintos. Darles la capacidad de la equivocada crea
 * puertos que no existen.
 *
 * Medido contra producción: el estricto resuelve 221 cajas y el suelto 224. Las
 * tres de diferencia no valen el riesgo.
 */
function clave(nombre: string | null): string | null {
  const s = (nombre ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return s === '' ? null : s;
}

export interface ResumenCapacidad {
  cajas_sin_capacidad: number;
  /** Cajas a las que se les pudo resolver la capacidad sin ambigüedad. */
  resueltas: number;
  puertos_declarados: number;
  aplicado: boolean;
  /** Por qué no se resolvieron las demás. */
  sin_ont_ligada: number;
  ont_no_coinciden: number;
  sin_entrada_en_catalogo: number;
  homonimas_que_diferen: number;
  sin_capacidad_en_catalogo: number;
  ejemplos: { id_caja_nap: number; identificador_unico: string | null; odb: string; capacidad: number }[];
}

/**
 * Llena `caja_nap.capacidad_puertos` desde el catálogo de la fuente.
 *
 * POR QUE HACE FALTA. CU-20 crea los puertos de una caja a partir de su
 * capacidad, y la capacidad está poblada en 1 de 911 cajas. Medido contra
 * producción, `reconciliarPuertos` hoy crea 0 puertos y asigna 0 clientes: el
 * caso de uso existe y no puede demostrar nada. El dato que falta está en
 * SmartOLT, en `nr_of_ports`, poblado en 300 de 301 cajas del catálogo.
 *
 * POR QUE NO SE EMPAREJA POR NOMBRE. Las 911 cajas vienen del KML de Tomodat y
 * sus nombres no son únicos ni coinciden con los de SmartOLT: de las 301 del
 * catálogo, solo 3 calzan con UNA sola caja nuestra, 134 calzan con varias y
 * 164 con ninguna. Emparejar así asignaría capacidades equivocadas.
 *
 * EL PUENTE SON LAS ONT YA LIGADAS. Cada `registro_ont` sabe las dos cosas: de
 * qué caja nuestra cuelga (`id_caja_nap`, que resolvió el ligado geométrico del
 * Incremento 2) y cómo la llama SmartOLT (`odb`). Se usa solo cuando TODAS las
 * ONT de una caja coinciden en el nombre; si discrepan, el enlace es dudoso y
 * se informa en vez de adivinar.
 *
 * Medido el 29-09: 224 cajas quedan resueltas, las 224 sin ambigüedad, y se
 * declararían 3.568 puertos.
 *
 * NO ESCRIBE POR DEFECTO. Igual que `reconciliarPuertos`, con `aplicar` en
 * false solo dice lo que haría. Toca una tabla de la base compartida.
 *
 * No se parece a `DescubrimientoService`, que está apagado: aquel CREA cajas a
 * partir de SmartOLT, que es lo que quedó pendiente del acuerdo de propiedad de
 * la topología con G1 y G8. Este solo completa un campo vacío de cajas que ya
 * existen, y que además nadie fuera de G3 usa.
 */
@Injectable()
export class CapacidadCajasService {
  private readonly logger = new Logger(CapacidadCajasService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FUENTE_MONITOREO) private fuente: FuenteMonitoreo,
  ) {}

  async completarCapacidades(id_empresa: number, aplicar = false): Promise<ResumenCapacidad> {
    if (!this.fuente.listarOdbs) {
      throw new BadRequestException(
        `La fuente de monitoreo "${this.fuente.nombre}" no expone catálogo de cajas`,
      );
    }

    const [cajas, registros, catalogo] = await Promise.all([
      this.prisma.caja_nap.findMany({
        where: { id_empresa, capacidad_puertos: null },
        select: { id_caja_nap: true, identificador_unico: true },
      }),
      this.prisma.registro_ont.findMany({
        where: { id_empresa, id_caja_nap: { not: null }, odb: { not: null } },
        select: { id_caja_nap: true, odb: true },
      }),
      this.fuente.listarOdbs(),
    ]);

    // Nombre de ODB que reportan las ONT de cada caja. Se guarda el conjunto
    // para poder distinguir "todas dicen lo mismo" de "discrepan".
    const nombresPorCaja = new Map<number, Map<string, string>>();
    for (const r of registros) {
      const k = clave(r.odb);
      if (!k) continue;
      const mapa = nombresPorCaja.get(r.id_caja_nap!) ?? new Map<string, string>();
      // Se guarda el crudo junto a la clave para poder mostrarlo en el reporte.
      if (!mapa.has(k)) mapa.set(k, (r.odb ?? '').trim());
      nombresPorCaja.set(r.id_caja_nap!, mapa);
    }

    // Catálogo indexado con la misma clave que el censo: los dos lados son
    // cadenas de SmartOLT, así que se comparan como vienen.
    const porNombre = new Map<string, number[]>();
    for (const o of catalogo) {
      const k = clave(o.nombre);
      if (!k || o.capacidad == null) continue;
      porNombre.set(k, [...(porNombre.get(k) ?? []), o.capacidad]);
    }

    const r: ResumenCapacidad = {
      cajas_sin_capacidad: cajas.length,
      resueltas: 0,
      puertos_declarados: 0,
      aplicado: aplicar,
      sin_ont_ligada: 0,
      ont_no_coinciden: 0,
      sin_entrada_en_catalogo: 0,
      homonimas_que_diferen: 0,
      sin_capacidad_en_catalogo: 0,
      ejemplos: [],
    };

    const aEscribir: { id_caja_nap: number; capacidad: number }[] = [];

    for (const caja of cajas) {
      const nombres = nombresPorCaja.get(caja.id_caja_nap);
      if (!nombres || nombres.size === 0) {
        r.sin_ont_ligada++;
        continue;
      }
      if (nombres.size > 1) {
        // Las ONT de esta caja dicen nombres distintos: el ligado puso juntas
        // ONT de cajas diferentes. Adivinar acá arrastraría ese error.
        r.ont_no_coinciden++;
        continue;
      }

      const [[k, crudo]] = [...nombres.entries()];
      const capacidades = porNombre.get(k);
      if (!capacidades) {
        r.sin_entrada_en_catalogo++;
        continue;
      }
      const distintas = new Set(capacidades);
      if (distintas.size > 1) {
        // Varias cajas homónimas en el catálogo y con capacidades distintas:
        // no hay forma de saber cuál es. Coincidir en capacidad sí alcanza.
        r.homonimas_que_diferen++;
        continue;
      }
      const capacidad = capacidades[0];
      if (!capacidad || capacidad < 1) {
        r.sin_capacidad_en_catalogo++;
        continue;
      }

      r.resueltas++;
      r.puertos_declarados += capacidad;
      aEscribir.push({ id_caja_nap: caja.id_caja_nap, capacidad });
      if (r.ejemplos.length < 10) {
        r.ejemplos.push({
          id_caja_nap: caja.id_caja_nap,
          identificador_unico: caja.identificador_unico,
          odb: crudo,
          capacidad,
        });
      }
    }

    if (aplicar && aEscribir.length > 0) {
      // Se agrupan por capacidad: son dos o tres valores distintos (8 y 16),
      // asi que salen dos updateMany en vez de 224 escrituras sueltas.
      const porCapacidad = new Map<number, number[]>();
      for (const a of aEscribir) {
        porCapacidad.set(a.capacidad, [...(porCapacidad.get(a.capacidad) ?? []), a.id_caja_nap]);
      }
      await this.prisma.$transaction(
        [...porCapacidad.entries()].map(([capacidad, ids]) =>
          this.prisma.caja_nap.updateMany({
            // `capacidad_puertos: null` otra vez en el where: si alguien la
            // cargó entre la lectura y la escritura, no se le pisa.
            where: { id_caja_nap: { in: ids }, capacidad_puertos: null },
            data: { capacidad_puertos: capacidad },
          }),
        ),
      );
      this.logger.log(
        `Capacidad completada en ${aEscribir.length} cajas (${r.puertos_declarados} puertos declarados)`,
      );
    }

    return r;
  }
}
