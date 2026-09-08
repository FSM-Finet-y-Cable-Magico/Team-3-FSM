import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizarNombreCaja } from '../monitoreo/ligado-caja.js';
import type { CrearCajaDto, CrearMufaDto, CrearOltDto, CrearTarjetaDto } from './dto/crear-elemento.dto.js';
import { ESTADO_PUERTO, type EditarCajaDto, type EditarPuertoDto } from './dto/editar-topologia.dto.js';

/**
 * Dos cajas con el mismo nombre a menos de esto se disputan las mismas ONT: el
 * ligado desambigua por distancia y por grupo PON, y a esta escala ya no puede.
 * Mas lejos son cajas distintas que comparten nombre, que es lo normal en la
 * red real de FiNet.
 */
const RADIO_COLISION_M = 300;

/** Distancia aproximada en metros. Basta a esta escala. */
function metrosEntre(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const m = (((aLat + bLat) / 2) * Math.PI) / 180;
  const x = dLon * Math.cos(m);
  return Math.round(R * Math.sqrt(dLat * dLat + x * x));
}

/**
 * `true` si el cuerpo no trae ni un campo con valor.
 *
 * No sirve `Object.keys(dto).length === 0`: con `target: ES2023` TypeScript
 * define los campos declarados como propiedades reales, asi que un DTO
 * transformado por ValidationPipe SIEMPRE tiene todas las claves, con valor
 * `undefined`. Contarlas da el numero de campos de la clase, nunca cero.
 */
function sinCambios(dto: object): boolean {
  return Object.values(dto).every((v) => v === undefined);
}

/**
 * Alta y edicion de la topologia de planta externa (CU-18, CU-19 y CU-20).
 *
 * Va aparte de `PlantaExternaService`, que es de lectura y del importador de
 * KML. La escritura tiene reglas propias --validar el padre, no duplicar cajas,
 * auditar-- y mezclarlas con las consultas dejaria un archivo que hace de todo.
 *
 * Toda escritura queda en `log_auditoria` con quien y cuando: la topologia es
 * el mapa con el que se despacha una cuadrilla, y una caja movida 200 metros
 * por error manda a un tecnico a la esquina equivocada.
 */
@Injectable()
export class TopologiaService {
  private readonly logger = new Logger(TopologiaService.name);

  constructor(private prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // CU-18 · Registrando elemento de topologia
  // ---------------------------------------------------------------------------

  async crearOlt(dto: CrearOltDto, id_usuario: number, id_empresa: number) {
    const olt = await this.prisma.olt.create({
      data: { ...dto, id_empresa },
    });
    await this.auditar(id_usuario, 'CREAR_OLT', 'olt', olt.id_olt, dto);
    return olt;
  }

  async crearTarjeta(dto: CrearTarjetaDto, id_usuario: number, id_empresa: number) {
    // La OLT tiene que ser de la empresa: sin esto se podrian colgar tarjetas
    // del equipamiento de la otra.
    const olt = await this.prisma.olt.findFirst({
      where: { id_olt: dto.id_olt, id_empresa },
    });
    if (!olt) throw new NotFoundException(`OLT ${dto.id_olt} no encontrada`);

    const repetida = await this.prisma.tarjeta_pon.findFirst({
      where: { id_olt: dto.id_olt, numero_tarjeta: dto.numero_tarjeta },
    });
    if (repetida) {
      throw new ConflictException(
        `La OLT ya tiene una tarjeta ${dto.numero_tarjeta}`,
      );
    }

    const tarjeta = await this.prisma.tarjeta_pon.create({ data: { ...dto } });
    await this.auditar(id_usuario, 'CREAR_TARJETA_PON', 'tarjeta_pon', tarjeta.id_tarjeta, dto);
    return tarjeta;
  }

  async crearMufa(dto: CrearMufaDto, id_usuario: number, id_empresa: number) {
    if (dto.id_tarjeta_pon != null) await this.exigirTarjetaDeLaEmpresa(dto.id_tarjeta_pon, id_empresa);

    const mufa = await this.prisma.mufa.create({ data: { ...dto } });
    await this.auditar(id_usuario, 'CREAR_MUFA', 'mufa', mufa.id_mufa, dto);
    return mufa;
  }

  /**
   * Alta de una caja NAP, con sus puertos.
   *
   * Los puertos se crean en la misma transaccion que la caja: una caja sin
   * puertos no sirve para nada --no se le puede asignar un cliente ni calcular
   * ocupacion-- y dejarla a medias obliga a un segundo paso que alguien va a
   * olvidar. Es el mismo criterio del importador de KML.
   */
  async crearCaja(dto: CrearCajaDto, id_usuario: number, id_empresa: number) {
    if (dto.id_mufa != null) {
      const mufa = await this.prisma.mufa.findUnique({ where: { id_mufa: dto.id_mufa } });
      if (!mufa) throw new NotFoundException(`Mufa ${dto.id_mufa} no encontrada`);
    }

    await this.exigirNombreDeCajaLibre(dto.identificador_unico, id_empresa, {
      latitud: dto.latitud,
      longitud: dto.longitud,
      zona: dto.zona,
    });

    const capacidad = dto.capacidad_puertos ?? 16;
    // `identificador_unico` tiene un @unique GLOBAL sobre el texto crudo, y eso
    // choca con la realidad: la red tiene nueve cajas que se llaman "NAP 5" en
    // zonas distintas. El importador de KML lo esquiva agregando " (n)" al
    // repetido; aca se hace lo mismo, para que las cajas manuales y las
    // importadas queden con la misma forma y el ligado las trate igual.
    const identificador = await this.identificadorLibre(dto.identificador_unico.trim());

    const caja = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.caja_nap.create({
        data: {
          id_empresa,
          id_mufa: dto.id_mufa ?? null,
          identificador_unico: identificador,
          numero_poste: dto.numero_poste ?? null,
          zona: dto.zona ?? null,
          capacidad_puertos: capacidad,
          latitud: dto.latitud ?? null,
          longitud: dto.longitud ?? null,
        },
      });
      await tx.puerto_nap.createMany({
        data: Array.from({ length: capacidad }, (_, i) => ({
          id_caja_nap: creada.id_caja_nap,
          numero_puerto: i + 1,
          estado: ESTADO_PUERTO.LIBRE,
        })),
      });
      return creada;
    });

    await this.auditar(id_usuario, 'CREAR_CAJA_NAP', 'caja_nap', caja.id_caja_nap, dto);
    this.logger.log(
      `Caja ${caja.identificador_unico} creada por usuario ${id_usuario} con ${capacidad} puertos`,
    );
    return caja;
  }

  // ---------------------------------------------------------------------------
  // CU-19 · Consultando y editando topologia
  // ---------------------------------------------------------------------------

  async editarCaja(
    id_caja_nap: number,
    dto: EditarCajaDto,
    id_usuario: number,
    id_empresa: number,
  ) {
    if (sinCambios(dto)) {
      throw new BadRequestException('No se envió ningún campo para editar');
    }

    const caja = await this.prisma.caja_nap.findFirst({
      where: { id_caja_nap, id_empresa },
      include: { puertos: { select: { estado: true } } },
    });
    if (!caja) throw new NotFoundException(`Caja ${id_caja_nap} no encontrada`);

    if (dto.identificador_unico != null && dto.identificador_unico !== caja.identificador_unico) {
      await this.exigirNombreDeCajaLibre(
        dto.identificador_unico,
        id_empresa,
        {
          latitud: dto.latitud ?? (caja.latitud == null ? null : Number(caja.latitud)),
          longitud: dto.longitud ?? (caja.longitud == null ? null : Number(caja.longitud)),
          zona: dto.zona ?? caja.zona,
        },
        id_caja_nap,
      );
    }
    if (dto.id_mufa != null) {
      const mufa = await this.prisma.mufa.findUnique({ where: { id_mufa: dto.id_mufa } });
      if (!mufa) throw new NotFoundException(`Mufa ${dto.id_mufa} no encontrada`);
    }

    // Bajar la capacidad por debajo de lo que ya esta ocupado dejaria puertos
    // en uso fuera de la caja: el calculo de ocupacion daria negativo y la
    // disponibilidad de CU-20 mentiria.
    if (dto.capacidad_puertos != null) {
      const ocupados = caja.puertos.filter(
        (p) => (p.estado ?? '').toUpperCase() === ESTADO_PUERTO.OCUPADO,
      ).length;
      if (dto.capacidad_puertos < ocupados) {
        throw new ConflictException(
          `La caja tiene ${ocupados} puertos ocupados: la capacidad no puede bajar de ese número`,
        );
      }
    }

    const antes = {
      identificador_unico: caja.identificador_unico,
      id_mufa: caja.id_mufa,
      numero_poste: caja.numero_poste,
      zona: caja.zona,
      capacidad_puertos: caja.capacidad_puertos,
      latitud: caja.latitud?.toString() ?? null,
      longitud: caja.longitud?.toString() ?? null,
    };

    const actualizada = await this.prisma.caja_nap.update({
      where: { id_caja_nap },
      data: {
        ...(dto.id_mufa !== undefined && { id_mufa: dto.id_mufa }),
        ...(dto.identificador_unico !== undefined && {
          identificador_unico: dto.identificador_unico.trim(),
        }),
        ...(dto.numero_poste !== undefined && { numero_poste: dto.numero_poste }),
        ...(dto.zona !== undefined && { zona: dto.zona }),
        ...(dto.capacidad_puertos !== undefined && { capacidad_puertos: dto.capacidad_puertos }),
        ...(dto.latitud !== undefined && { latitud: dto.latitud }),
        ...(dto.longitud !== undefined && { longitud: dto.longitud }),
      },
    });

    await this.auditar(id_usuario, 'EDITAR_CAJA_NAP', 'caja_nap', id_caja_nap, dto, antes);
    return actualizada;
  }

  async editarPuerto(
    id_puerto: number,
    dto: EditarPuertoDto,
    id_usuario: number,
    id_empresa: number,
  ) {
    if (sinCambios(dto)) {
      throw new BadRequestException('No se envió ningún campo para editar');
    }

    const puerto = await this.prisma.puerto_nap.findFirst({
      where: { id_puerto, caja_nap: { id_empresa } },
      include: { caja_nap: { select: { identificador_unico: true } } },
    });
    if (!puerto) throw new NotFoundException(`Puerto ${id_puerto} no encontrado`);

    if (dto.id_cliente_asociado != null) {
      const cliente = await this.prisma.cliente.findFirst({
        where: { id_cliente: dto.id_cliente_asociado, id_empresa },
      });
      if (!cliente) throw new NotFoundException(`Cliente ${dto.id_cliente_asociado} no encontrado`);
    }

    // Un puerto OCUPADO sin cliente no dice a quien atiende, y un puerto LIBRE
    // con cliente colgando es una ocupacion fantasma que el conteo no ve.
    const estadoFinal = dto.estado ?? puerto.estado;
    const clienteFinal =
      dto.id_cliente_asociado !== undefined ? dto.id_cliente_asociado : puerto.id_cliente_asociado;
    if (estadoFinal === ESTADO_PUERTO.OCUPADO && clienteFinal == null) {
      throw new BadRequestException('Un puerto OCUPADO necesita un cliente asociado');
    }
    if (estadoFinal !== ESTADO_PUERTO.OCUPADO && clienteFinal != null) {
      throw new BadRequestException(
        `Un puerto ${estadoFinal} no puede tener un cliente asociado`,
      );
    }

    const antes = { estado: puerto.estado, id_cliente_asociado: puerto.id_cliente_asociado };
    const actualizado = await this.prisma.puerto_nap.update({
      where: { id_puerto },
      data: {
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.id_cliente_asociado !== undefined && {
          id_cliente_asociado: dto.id_cliente_asociado,
        }),
      },
    });

    await this.auditar(id_usuario, 'EDITAR_PUERTO_NAP', 'puerto_nap', id_puerto, dto, antes);
    return actualizado;
  }

  // ---------------------------------------------------------------------------
  // CU-20 · Consultando disponibilidad de puertos NAP
  // ---------------------------------------------------------------------------

  /**
   * Puertos de una caja, con lo que se sabe de cada uno.
   *
   * OJO CON LA SEMANTICA, que no es la que sugiere el nombre del CU. Las cajas
   * NAP estan en postes y NO son exclusivas de FiNet: otros operadores usan la
   * misma caja. El sistema no puede saber si un puerto esta realmente libre
   * hasta que un tecnico lo mira en terreno.
   *
   * Por eso `LIBRE` significa "sin registro", no "disponible garantizado", y
   * `sin_registro` se llama asi a proposito: publicar 14.576 puertos como
   * disponibles cuando nadie los ha visto seria una promesa que la realidad no
   * respalda, y el jefe tecnico planificaria sobre humo.
   *
   * Lo que si es dato duro es `ocupados`: alguien lo confirmo y dejo el cliente
   * asociado. Es el mismo criterio de la confirmacion de caja del monitoreo --
   * el sistema no adivina, registra lo que alguien vio.
   */
  async puertosDeCaja(id_caja_nap: number, id_empresa: number) {
    const caja = await this.prisma.caja_nap.findFirst({
      where: { id_caja_nap, id_empresa },
      include: { puertos: { orderBy: { numero_puerto: 'asc' } } },
    });
    if (!caja) throw new NotFoundException(`Caja ${id_caja_nap} no encontrada`);

    const cuenta = (e: string) =>
      caja.puertos.filter((p) => (p.estado ?? '').toUpperCase() === e).length;

    return {
      id_caja_nap: caja.id_caja_nap,
      identificador_unico: caja.identificador_unico,
      zona: caja.zona,
      capacidad_puertos: caja.capacidad_puertos ?? caja.puertos.length,
      /** Nadie confirmo su estado en terreno. NO es "disponible". */
      sin_registro: cuenta(ESTADO_PUERTO.LIBRE),
      reservados: cuenta(ESTADO_PUERTO.RESERVADO),
      /** Confirmado en terreno, con cliente asociado. Este si es dato duro. */
      ocupados: cuenta(ESTADO_PUERTO.OCUPADO),
      puertos: caja.puertos.map((p) => ({
        id_puerto: p.id_puerto,
        numero_puerto: p.numero_puerto,
        estado: p.estado,
        id_cliente_asociado: p.id_cliente_asociado,
      })),
    };
  }

  /**
   * Cajas con puertos SIN OCUPACION REGISTRADA, de la mas holgada a la mas
   * justa. `zona` acota la busqueda.
   *
   * No confundir con "cajas disponibles": ver la nota de `puertosDeCaja`. Las
   * cajas son de los postes y compartidas entre operadores, asi que esto no
   * dice donde HAY puerto libre, dice donde NO CONSTA que este ocupado. Sirve
   * para descartar las que ya se sabe llenas, no para prometer un cupo.
   *
   * Se ordena por esa cuenta porque, a falta de dato mejor, una caja con 16 sin
   * registro es mejor candidata a tener cupo que una con 1.
   */
  async cajasConDisponibilidad(id_empresa: number, zona?: string) {
    const cajas = await this.prisma.caja_nap.findMany({
      where: {
        id_empresa,
        ...(zona ? { zona: { contains: zona, mode: 'insensitive' as const } } : {}),
        puertos: { some: { estado: ESTADO_PUERTO.LIBRE } },
      },
      include: { puertos: { select: { estado: true } } },
    });

    return cajas
      .map((c) => {
        const libres = c.puertos.filter(
          (p) => (p.estado ?? '').toUpperCase() === ESTADO_PUERTO.LIBRE,
        ).length;
        return {
          id_caja_nap: c.id_caja_nap,
          identificador_unico: c.identificador_unico,
          zona: c.zona,
          numero_poste: c.numero_poste,
          latitud: c.latitud,
          longitud: c.longitud,
          capacidad_puertos: c.capacidad_puertos ?? c.puertos.length,
          libres,
        };
      })
      .sort((a, b) => b.libres - a.libres);
  }

  // ---------------------------------------------------------------------------
  // internos
  // ---------------------------------------------------------------------------

  private async exigirTarjetaDeLaEmpresa(id_tarjeta: number, id_empresa: number) {
    const tarjeta = await this.prisma.tarjeta_pon.findFirst({
      where: { id_tarjeta, olt: { id_empresa } },
    });
    if (!tarjeta) throw new NotFoundException(`Tarjeta PON ${id_tarjeta} no encontrada`);
    return tarjeta;
  }

  /**
   * Rechaza un nombre de caja que colisione con otra CERCANA.
   *
   * La comparacion es sobre el nombre NORMALIZADO, no sobre el crudo: la
   * columna tiene un @unique de base, pero es literal, y "NAP06" y "NAP 6" lo
   * pasan sin problema. El ligado ONT->caja compara normalizado
   * (`normalizarNombreCaja`), asi que esas dos filas serian dos cajas
   * peleandose las mismas ONT.
   *
   * PERO LA CERCANIA IMPORTA, y esto costo entenderlo. Los datos reales de
   * FiNet tienen NUEVE cajas que normalizan a "NAP 5", repartidas en 7 km y en
   * zonas distintas: ZONA 3, ZONA 5, ZONA 4, ZONA CC 37. No son un error --
   * asi numera la red, cada zona tiene su propia NAP 5. Rechazar por nombre a
   * secas impediria crear una NAP 5 legitima en una zona nueva, que es
   * justamente lo que hace falta para las 166 cajas sin numerar.
   *
   * Lo que confunde al ligado no es el nombre repetido, es el nombre repetido
   * CERCA: el matcher desambigua por distancia y por grupo PON, asi que dos
   * "NAP 5" a 7 km nunca se disputan una ONT. Dos a 20 m, si.
   */
  private async exigirNombreDeCajaLibre(
    identificador: string,
    id_empresa: number,
    contexto: { latitud?: number | null; longitud?: number | null; zona?: string | null } = {},
    exceptoId?: number,
  ) {
    const clave = normalizarNombreCaja(identificador);
    if (!clave) {
      throw new BadRequestException(
        'El identificador no tiene letras ni números utilizables',
      );
    }

    // Las cajas sin empresa tambien cuentan: el ligado las ve igual.
    const candidatas = await this.prisma.caja_nap.findMany({
      where: { OR: [{ id_empresa }, { id_empresa: null }] },
      select: {
        id_caja_nap: true,
        identificador_unico: true,
        zona: true,
        latitud: true,
        longitud: true,
      },
    });

    const mismoNombre = candidatas.filter(
      (c) => c.id_caja_nap !== exceptoId && normalizarNombreCaja(c.identificador_unico) === clave,
    );
    if (mismoNombre.length === 0) return;

    const choque = mismoNombre.find((c) => {
      if (contexto.latitud != null && contexto.longitud != null && c.latitud != null && c.longitud != null) {
        return (
          metrosEntre(contexto.latitud, contexto.longitud, Number(c.latitud), Number(c.longitud)) <=
          RADIO_COLISION_M
        );
      }
      // Sin coordenadas de un lado no se puede medir: se cae a la zona, que es
      // el otro criterio con el que la red numera sus cajas.
      return !!contexto.zona && !!c.zona && contexto.zona.trim() === c.zona.trim();
    });

    if (choque) {
      throw new ConflictException(
        `Ya existe la caja "${choque.identificador_unico}" cerca de esta ubicación, y es el ` +
          `mismo identificador una vez normalizado ("${clave}"). Dos cajas con el mismo nombre ` +
          `en la misma zona se disputarían las mismas ONT al ligar. Si es otra caja, dale un ` +
          `identificador que la distinga.`,
      );
    }
  }

  /**
   * Devuelve el identificador tal cual, o con un sufijo " (n)" si el texto
   * exacto ya esta tomado.
   *
   * No es cosmetico: la columna tiene un @unique global sobre el texto crudo,
   * asi que sin esto crear una segunda "NAP 5" --legitima, en otra zona-- se
   * cae con un 500 de Prisma. El sufijo es el mismo que usa el importador de
   * KML para las cajas homonimas de Tomodat, y `normalizarNombreCaja` lo
   * ignora a proposito, asi que el ligado sigue viendo "NAP 5".
   */
  private async identificadorLibre(base: string): Promise<string> {
    const tomados = new Set(
      (
        await this.prisma.caja_nap.findMany({
          where: { identificador_unico: { startsWith: base } },
          select: { identificador_unico: true },
        })
      ).map((c) => c.identificador_unico),
    );
    if (!tomados.has(base)) return base;
    for (let n = 2; n < 1000; n++) {
      const intento = `${base} (${n})`;
      if (!tomados.has(intento)) return intento;
    }
    throw new ConflictException(`Demasiadas cajas llamadas "${base}"`);
  }

  private async auditar(
    id_usuario: number,
    accion: string,
    entidad: string,
    id_entidad: number,
    valorNuevo: unknown,
    valorAnterior?: unknown,
  ) {
    await this.prisma.log_auditoria.create({
      data: {
        id_usuario,
        accion,
        entidad_afectada: entidad,
        id_entidad_afectada: id_entidad,
        ...(valorAnterior !== undefined
          ? { valor_anterior: JSON.parse(JSON.stringify(valorAnterior)) }
          : {}),
        valor_nuevo: JSON.parse(JSON.stringify(valorNuevo)),
        fecha_hora: new Date(),
      },
    });
  }
}
