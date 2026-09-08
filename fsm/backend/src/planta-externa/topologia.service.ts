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

    await this.exigirNombreDeCajaLibre(dto.identificador_unico, id_empresa);

    const capacidad = dto.capacidad_puertos ?? 16;
    const caja = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.caja_nap.create({
        data: {
          id_empresa,
          id_mufa: dto.id_mufa ?? null,
          identificador_unico: dto.identificador_unico.trim(),
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
      await this.exigirNombreDeCajaLibre(dto.identificador_unico, id_empresa, id_caja_nap);
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
   * Puertos de una caja, con su estado. Es lo que mira quien va a conectar a un
   * cliente nuevo: cuales quedan libres y cual toca.
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
      libres: cuenta(ESTADO_PUERTO.LIBRE),
      reservados: cuenta(ESTADO_PUERTO.RESERVADO),
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
   * Cajas con al menos un puerto libre, de la mas holgada a la mas justa.
   *
   * Ordenar por libres y no por cercania es a proposito: el jefe tecnico
   * pregunta esto cuando ya sabe A QUE ZONA va, y lo que necesita es no llenar
   * una caja al tope. `zona` acota la busqueda.
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
   * Rechaza un nombre de caja que colisione con uno existente.
   *
   * La comparacion es sobre el nombre NORMALIZADO, no sobre el crudo, y esa es
   * la parte que importa. La columna tiene un @unique de base, pero es sobre el
   * texto tal cual: "NAP06" y "NAP 6" lo pasan sin problema. El ligado
   * ONT->caja, en cambio, compara normalizado (`normalizarNombreCaja`), asi que
   * esas dos filas serian DOS cajas peleandose las mismas ONT, y la
   * exclusividad del algoritmo le daria las ONT a una de las dos al azar.
   *
   * Es exactamente el tipo de duplicado que el @unique no ve.
   */
  private async exigirNombreDeCajaLibre(
    identificador: string,
    id_empresa: number,
    exceptoId?: number,
  ) {
    const clave = normalizarNombreCaja(identificador);
    if (!clave) {
      throw new BadRequestException(
        'El identificador no tiene letras ni números utilizables',
      );
    }

    // Se comparan las de la empresa; las cajas sin empresa (importadas antes de
    // que se supiera de quien eran) tambien cuentan, porque el ligado las ve.
    const candidatas = await this.prisma.caja_nap.findMany({
      where: { OR: [{ id_empresa }, { id_empresa: null }] },
      select: { id_caja_nap: true, identificador_unico: true },
    });

    const choque = candidatas.find(
      (c) => c.id_caja_nap !== exceptoId && normalizarNombreCaja(c.identificador_unico) === clave,
    );
    if (choque) {
      throw new ConflictException(
        `Ya existe la caja "${choque.identificador_unico}", que es el mismo identificador ` +
          `una vez normalizado ("${clave}"). Dos cajas con el mismo nombre se disputarían ` +
          `las mismas ONT al ligar.`,
      );
    }
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
