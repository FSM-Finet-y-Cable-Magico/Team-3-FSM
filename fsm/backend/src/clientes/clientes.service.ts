import { normalizarPaginacion } from '../common/utils/paginacion.util.js';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';
import { filtroRut, validarRut, variantesRut } from '../common/utils/rut.util.js';
import { RegistrarClienteDto } from './dto/registrar-cliente.dto.js';
import { EditarClienteDto } from './dto/editar-cliente.dto.js';
import { MarcarConflictivoDto } from './dto/marcar-conflictivo.dto.js';
import { MOTIVOS_BAJA, type MotivoBaja } from './dto/baja-servicio.dto.js';
import {
  ADVERTENCIA_DIRECCION,
  MENSAJE_JUSTIFICACION_RIESGO,
  MIN_JUSTIFICACION_RIESGO,
  NIVEL_RIESGO,
  direccionConAntecedentes,
  mensajeVetado,
  nivelVigente,
  normalizarDireccion,
  textoDireccion,
  type NivelRiesgo,
} from './lista-roja.js';

/** Criterios de la busqueda de clientes (RF-54). Todos opcionales y combinables. */
export interface FiltrosClientes {
  nombre?: string;
  rut?: string;
  telefono?: string;
  direccion?: string;
  /** RF-54. */
  zona?: string;
}
const MAX_CONTRATOS_ACTIVOS = 50;

/** Texto de la excepcion 2 de CU-07. */
export const MENSAJE_SIN_CLIENTES_EN_DIRECCION =
  'No se encontraron clientes en esa dirección. Verifique la información ingresada.';

@Injectable()
export class ClientesService {
  constructor(private reparaciones: ReparacionesRecurrentesService,
    private prisma: PrismaService) {}

  async registrarCliente(dto: RegistrarClienteDto, userId: number, id_empresa: number) {
    if (!validarRut(dto.rut)) {
      throw new BadRequestException('RUT inválido. Verifique el número');
    }

    // El @unique de la columna no alcanza: para la base, "12345678-5" y
    // "123456785" son dos valores distintos, asi que deja entrar dos veces a
    // la misma persona. El duplicado se busca en todas las grafias.
    const existente = await this.prisma.cliente.findFirst({
      where: { rut: { in: variantesRut(dto.rut) } },
      select: { id_cliente: true },
    });

    if (existente) {
      throw new ConflictException('Este RUT ya está registrado');
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      const cliente = await tx.cliente.create({
        data: {
          id_empresa,
          rut: dto.rut,
          nombre_completo: dto.nombre_completo,
          email: dto.email,
          telefono: dto.telefono,
          estado: dto.estado ?? 'PENDIENTE',
          es_conflictivo: false,
          direcciones: {
            create: {
              direccion_completa: dto.direccion_completa,
              comuna: dto.comuna,
              ciudad: dto.ciudad,
              es_principal: true,
            },
          },
        },
        include: {
          direcciones: true,
        },
      });

      if (dto.id_plan) {
        await tx.contrato.create({
          data: {
            id_cliente: cliente.id_cliente,
            id_plan: dto.id_plan,
            id_empresa,
            fecha_inicio: new Date(),
            dia_vencimiento: 1,
            estado: 'ACTIVO',
          },
        });
      }

      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'REGISTRAR_CLIENTE',
          entidad_afectada: 'cliente',
          id_entidad_afectada: cliente.id_cliente,
          fecha_hora: new Date(),
        },
      });

      return cliente;
    });

    return resultado;
  }

  async consultarPorRut(rut: string, id_empresa: number) {
    if (!validarRut(rut)) {
      throw new BadRequestException('RUT inválido');
    }

    const cliente = await this.prisma.cliente.findFirst({
      where: {
        rut: { in: variantesRut(rut) },
        id_empresa,
      },
      include: {
        direcciones: {
          where: { es_principal: true },
        },
        contratos: {
          where: { estado: 'ACTIVO', id_empresa },
          include: { plan: true },
          orderBy: { fecha_inicio: 'desc' },
          take: MAX_CONTRATOS_ACTIVOS,
        },
      },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const historial_ot = await this.prisma.orden_trabajo.findMany({
      where: { id_cliente: cliente.id_cliente, id_empresa },
      orderBy: { fecha_creacion: 'desc' },
      take: 20,
      select: {
        id_ot: true,
        tipo_ot: true,
        estado: true,
        prioridad: true,
        fecha_creacion: true,
        fecha_completada: true,
      },
    });
    // RF-08. La regla vive en `ReparacionesRecurrentesService` y no aca: antes
    // estaba duplicada entre este archivo y `ordenes.service`, con el mismo
    // error copiado en los dos.
    const reparacionesRecurrentes = await this.reparaciones.evaluar(
      cliente.id_cliente,
      id_empresa,
    );

    return {
      cliente: {
        id_cliente: cliente.id_cliente,
        rut: cliente.rut,
        nombre_completo: cliente.nombre_completo,
        email: cliente.email,
        telefono: cliente.telefono,
        estado: cliente.estado,
        es_conflictivo: cliente.es_conflictivo,
        obs_conflictivo: cliente.obs_conflictivo,
        // MOD RF-32: el semaforo. El motivo es el de obs_conflictivo.
        nivel_riesgo: await this.nivelDe(cliente.id_cliente),
        // RF-53: zona del servicio, con su origen (ver zonaDe).
        zona: await this.zonaDe(cliente.id_cliente, id_empresa),
        fecha_creacion: cliente.fecha_creacion,
        direccion_principal: cliente.direcciones[0] ?? null,
        contratos_activos: cliente.contratos.map((contrato) => ({
          id_contrato: contrato.id_contrato,
          // fecha_inicio es un DATE puro. Se entrega como YYYY-MM-DD para que el
          // front no lo reinterprete en su zona horaria y muestre el dia anterior.
          fecha_inicio: contrato.fecha_inicio.toISOString().slice(0, 10),
          estado: contrato.estado,
          // La relacion con plan es opcional en el esquema.
          plan: contrato.plan
            ? {
                nombre_comercial: contrato.plan.nombre_comercial,
                velocidad_mbps: contrato.plan.velocidad_mbps,
                // Decimal se serializa como string; se normaliza a numero aqui.
                precio_mensual: Number(contrato.plan.precio_mensual),
              }
            : null,
        })),
      },
      historial_ot,
      alerta_reparaciones_30_dias: reparacionesRecurrentes,
    };
  }

  async editarFicha(
    id_cliente: number,
    dto: EditarClienteDto,
    userId: number,
    id_empresa: number,
  ) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa },
      include: {
        direcciones: {
          where: { es_principal: true },
        },
      },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const valor_anterior = {
      nombre_completo: cliente.nombre_completo,
      email: cliente.email,
      telefono: cliente.telefono,
      estado: cliente.estado,
      direccion: cliente.direcciones[0]
        ? {
            direccion_completa: cliente.direcciones[0].direccion_completa,
            comuna: cliente.direcciones[0].comuna,
            ciudad: cliente.direcciones[0].ciudad,
          }
        : null,
    };

    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.cliente.update({
        where: { id_cliente },
        data: {
          ...(dto.nombre_completo !== undefined && { nombre_completo: dto.nombre_completo }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.telefono !== undefined && { telefono: dto.telefono }),
          ...(dto.estado !== undefined && { estado: dto.estado }),
        },
      });

      if (dto.direccion_completa || dto.comuna || dto.ciudad) {
        const dirPrincipal = cliente.direcciones[0];
        if (dirPrincipal) {
          await tx.direccion_servicio.update({
            where: { id_direccion: dirPrincipal.id_direccion },
            data: {
              ...(dto.direccion_completa !== undefined && { direccion_completa: dto.direccion_completa }),
              ...(dto.comuna !== undefined && { comuna: dto.comuna }),
              ...(dto.ciudad !== undefined && { ciudad: dto.ciudad }),
            },
          });
        }
      }

      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'EDITAR_CLIENTE',
          entidad_afectada: 'cliente',
          id_entidad_afectada: id_cliente,
          valor_anterior: JSON.parse(JSON.stringify(valor_anterior)),
          valor_nuevo: JSON.parse(JSON.stringify(dto)),
          fecha_hora: new Date(),
        },
      });

      return tx.cliente.findUnique({
        where: { id_cliente },
        include: {
          direcciones: { where: { es_principal: true } },
        },
      });
    });

    return resultado;
  }

  /** CU-25: lo que muestra el formulario de baja antes de confirmar. */
  async resumenBaja(id_cliente: number, id_empresa: number) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa },
      include: { direcciones: { where: { es_principal: true }, take: 1 } },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');
    const [onts, puertos] = await Promise.all([
      this.prisma.registro_ont.findMany({ where: { id_cliente, id_empresa }, select: { numero_serie: true } }),
      this.prisma.puerto_nap.findMany({
        where: { id_cliente_asociado: id_cliente, estado: 'OCUPADO', caja_nap: { id_empresa } },
        select: { id_puerto: true, numero_puerto: true, id_caja_nap: true, caja_nap: { select: { identificador_unico: true } } },
      }),
    ]);
    const dir = cliente.direcciones[0];
    return {
      id_cliente,
      nombre_completo: cliente.nombre_completo,
      rut: cliente.rut,
      estado: cliente.estado,
      direccion: dir ? textoDireccion(dir) : null,
      onts: onts.map((o) => o.numero_serie),
      puertos: puertos.map((p) => ({
        id_puerto: p.id_puerto,
        numero_puerto: p.numero_puerto,
        id_caja_nap: p.id_caja_nap,
        caja: p.caja_nap?.identificador_unico ?? null,
      })),
      motivos: [...MOTIVOS_BAJA],
    };
  }

  /**
   * CU-25: baja de servicio. El cliente pasa a BAJA y se generan dos OT en
   * PENDIENTE para el panel del jefe tecnico:
   *  - OT-BAJA-PUERTO: desconectar el puerto NAP. Lleva la caja; al cerrarla,
   *    el puerto del cliente queda LIBRE (OrdenesService.cerrarOT).
   *  - OT-BAJA-EQUIPO: retirar la ONT. Al cerrarla el tecnico la declara
   *    retirada para diagnostico, que G1 lleva a "En revision".
   * Si el cliente esta ausente, esa OT sigue el flujo normal de cliente ausente
   * (excepcion 2).
   */
  async darDeBaja(
    id_cliente: number,
    dto: { motivo: MotivoBaja; confirma_sin_deuda: boolean; observaciones?: string },
    actor: { userId: number; id_empresa: number },
  ) {
    if (dto.confirma_sin_deuda !== true) {
      throw new BadRequestException('Confirma que el cliente no tiene deuda pendiente antes de registrar la baja');
    }
    const resumen = await this.resumenBaja(id_cliente, actor.id_empresa);
    if (resumen.estado === 'BAJA') throw new BadRequestException('El cliente ya está dado de baja');
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa: actor.id_empresa },
      include: { direcciones: { where: { es_principal: true }, take: 1 } },
    });
    const id_direccion = cliente?.direcciones[0]?.id_direccion ?? null;
    const puerto = resumen.puertos[0];
    const extra = dto.observaciones?.trim() ? ` Observaciones: ${dto.observaciones.trim()}` : '';

    const creadas = await this.prisma.$transaction(async (tx) => {
      await tx.cliente.update({ where: { id_cliente }, data: { estado: 'BAJA' } });

      const base = {
        id_empresa: actor.id_empresa,
        id_cliente,
        id_direccion,
        tipo_ot: 'BAJA',
        prioridad: 'MEDIA',
        estado: 'PENDIENTE',
        fecha_creacion: new Date(),
      };
      const otPuerto = await tx.orden_trabajo.create({
        data: {
          ...base,
          ...(puerto?.id_caja_nap && { id_caja_nap: puerto.id_caja_nap }),
          observaciones: puerto
            ? `OT-BAJA-PUERTO: desconectar el puerto ${puerto.numero_puerto} de la caja ${puerto.caja ?? puerto.id_caja_nap}. Motivo: ${dto.motivo}.${extra}`
            : `OT-BAJA-PUERTO: desconectar el puerto NAP del cliente (sin puerto registrado). Motivo: ${dto.motivo}.${extra}`,
        },
      });
      const otEquipo = await tx.orden_trabajo.create({
        data: {
          ...base,
          observaciones: `OT-BAJA-EQUIPO: retirar la ONT ${resumen.onts.join(', ') || '(sin serie registrada)'} y declararla retirada para diagnostico. Motivo: ${dto.motivo}.${extra}`,
        },
      });
      for (const ot of [otPuerto, otEquipo]) {
        await tx.historial_ot.create({
          data: { id_ot: ot.id_ot, id_usuario: actor.userId, estado_anterior: null, estado_nuevo: 'PENDIENTE', observaciones: `Baja de servicio: ${dto.motivo}` },
        });
      }
      await tx.log_auditoria.create({
        data: {
          id_usuario: actor.userId,
          accion: 'BAJA_SERVICIO',
          entidad_afectada: 'cliente',
          id_entidad_afectada: id_cliente,
          valor_anterior: { estado: resumen.estado },
          valor_nuevo: { estado: 'BAJA', motivo: dto.motivo, ot_baja_puerto: otPuerto.id_ot, ot_baja_equipo: otEquipo.id_ot },
        },
      });
      return { ot_baja_puerto: otPuerto.id_ot, ot_baja_equipo: otEquipo.id_ot };
    });

    return { id_cliente, estado: 'BAJA', ...creadas };
  }

  /**
   * CU-07: todos los clientes asociados a una direccion, actuales y anteriores
   * (una direccion que no es la principal es una anterior). Se elige uno y se
   * abre su ficha (CU-06).
   *
   * `orden_trabajo` no tiene indice por `id_direccion`: buscar por las OT
   * recorreria la tabla entera. Se traen las direcciones con cliente de la
   * comuna y se filtra en memoria, con la normalizacion de la lista roja, para
   * que "Av. Ejemplo" y "AVENIDA EJEMPLO" coincidan. El numero se compara
   * entero: 99 no encuentra el 999.
   */
  async buscarPorDireccion(id_empresa: number, q: { calle?: string; numero?: string; comuna?: string }) {
    const calle = normalizarDireccion(q.calle ?? '');
    const numero = normalizarDireccion(q.numero ?? '');
    const comuna = (q.comuna ?? '').trim();
    // Excepcion 1 del CU: con los campos vacios no se busca.
    if (!calle || !numero || !comuna) {
      throw new BadRequestException('Ingresa calle, número y comuna');
    }

    const direcciones = await this.prisma.direccion_servicio.findMany({
      where: {
        id_cliente: { not: null },
        cliente: { id_empresa },
        comuna: { equals: comuna, mode: 'insensitive' },
      },
      select: {
        direccion_completa: true,
        comuna: true,
        es_principal: true,
        cliente: { select: { id_cliente: true, rut: true, nombre_completo: true, estado: true } },
      },
      take: 5000,
    });

    return direcciones
      .filter((d) => {
        const texto = normalizarDireccion(d.direccion_completa);
        return texto.includes(calle) && texto.split(' ').includes(numero);
      })
      .filter((d) => d.cliente !== null)
      .map((d) => ({
        id_cliente: d.cliente!.id_cliente,
        rut: d.cliente!.rut,
        nombre_completo: d.cliente!.nombre_completo,
        estado: d.cliente!.estado,
        direccion: textoDireccion(d),
        actual: d.es_principal,
      }))
      .sort((a, b) => Number(b.actual) - Number(a.actual) || a.nombre_completo.localeCompare(b.nombre_completo));
  }

  /**
   * "Marcar conflictivo" de CU-37 es, con el semaforo, pasar a ROJO. Se deja
   * el endpoint viejo apuntando aca para no romper a quien lo use.
   */
  async marcarConflictivo(
    id_cliente: number,
    dto: MarcarConflictivoDto,
    userId: number,
    id_empresa: number,
  ) {
    return this.cambiarNivelRiesgo(id_cliente, { nivel: NIVEL_RIESGO.ROJO, motivo: dto.motivo }, userId, id_empresa);
  }

  /**
   * RF-53: zona del servicio del cliente. El catalogo de zonas es del Grupo 2
   * (acta, D-02) y todavia no se expone; mientras tanto la zona sale de lo que
   * G3 ya sabe, y se dice de donde:
   *  - MONITOREO: la que informa SmartOLT para la ONT del cliente;
   *  - CAJA_NAP: la de la caja de su puerto.
   * Cuando G2 exponga su catalogo, esto se mapea a su zona.
   */
  async zonaDe(id_cliente: number, id_empresa: number) {
    const ont = await this.prisma.registro_ont.findFirst({
      where: { id_cliente, id_empresa, zona: { not: null } },
      select: { zona: true },
    });
    if (ont?.zona) return { nombre: ont.zona, origen: 'MONITOREO' as const };
    const puerto = await this.prisma.puerto_nap.findFirst({
      where: { id_cliente_asociado: id_cliente, caja_nap: { id_empresa, zona: { not: null } } },
      select: { caja_nap: { select: { zona: true } } },
    });
    if (puerto?.caja_nap?.zona) return { nombre: puerto.caja_nap.zona, origen: 'CAJA_NAP' as const };
    return null;
  }

  private async nivelDe(id_cliente: number): Promise<NivelRiesgo> {
    const filas = await this.prisma.lista_negra.findMany({
      where: { id_cliente },
      orderBy: { id_vetado: 'desc' },
      take: 1,
      select: { nivel: true },
    });
    return nivelVigente(filas);
  }

  /**
   * MOD RF-32: semaforo de riesgo. AMARILLO y ROJO exigen justificacion de 20
   * caracteres; VERDE no. Cada cambio es una fila nueva en lista_negra (D3), y
   * `es_conflictivo` queda igual a (ROJO) para que lo que ya lo lee --el
   * bloqueo de instalacion, la tarjeta de terreno-- siga funcionando.
   *
   * ROJO guarda la direccion principal del cliente: es lo que usa la lista
   * roja por direccion de CU-35.
   */
  async cambiarNivelRiesgo(
    id_cliente: number,
    dto: { nivel: NivelRiesgo; motivo?: string },
    userId: number,
    id_empresa: number,
  ) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa },
      include: { direcciones: { where: { es_principal: true }, take: 1 } },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const motivo = dto.motivo?.trim() ?? '';
    if (dto.nivel !== NIVEL_RIESGO.VERDE && motivo.length < MIN_JUSTIFICACION_RIESGO) {
      throw new BadRequestException(MENSAJE_JUSTIFICACION_RIESGO);
    }
    const anterior = await this.nivelDe(id_cliente);
    if (anterior === dto.nivel) {
      throw new BadRequestException(`El cliente ya está en nivel ${dto.nivel}`);
    }

    const direccion = cliente.direcciones[0];
    await this.prisma.$transaction(async (tx) => {
      await tx.lista_negra.create({
        data: {
          id_cliente,
          rut_vetado: cliente.rut ?? '',
          nivel: dto.nivel,
          motivo: motivo || 'Vuelve a VERDE',
          direccion_vetada: dto.nivel === NIVEL_RIESGO.ROJO && direccion ? textoDireccion(direccion) : null,
          fecha_registro: new Date(),
          id_usuario_registro: userId,
        },
      });
      await tx.cliente.update({
        where: { id_cliente },
        data: {
          es_conflictivo: dto.nivel === NIVEL_RIESGO.ROJO,
          obs_conflictivo: dto.nivel === NIVEL_RIESGO.VERDE ? null : motivo,
        },
      });
      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'CAMBIAR_NIVEL_RIESGO',
          entidad_afectada: 'cliente',
          id_entidad_afectada: id_cliente,
          valor_anterior: { nivel: anterior },
          valor_nuevo: { nivel: dto.nivel, ...(motivo && { motivo }) },
        },
      });
    });

    return { id_cliente, nivel_riesgo: dto.nivel, motivo: dto.nivel === NIVEL_RIESGO.VERDE ? null : motivo };
  }

  /**
   * CU-35: lo que ve quien va a crear una OT, antes de crearla. Por RUT, un
   * cliente en ROJO esta vetado; por direccion, una que pertenece a un cliente
   * en ROJO da una advertencia, no un bloqueo (excepcion 2).
   */
  async verificarListaRoja(
    id_empresa: number,
    q: { rut?: string; direccion_completa?: string; comuna?: string },
  ) {
    const cliente = q.rut
      ? await this.prisma.cliente.findFirst({
          where: { rut: { in: variantesRut(q.rut) }, id_empresa },
          select: { id_cliente: true, es_conflictivo: true, obs_conflictivo: true },
        })
      : null;
    const vetado = cliente?.es_conflictivo ? { motivo: cliente.obs_conflictivo ?? 'CONFLICTIVO' } : null;

    const conAntecedentes =
      !vetado && q.direccion_completa && q.comuna
        ? await direccionConAntecedentes(
            this.prisma,
            id_empresa,
            { direccion_completa: q.direccion_completa, comuna: q.comuna },
            cliente?.id_cliente,
          )
        : false;

    return {
      vetado,
      mensaje: vetado ? mensajeVetado(vetado.motivo) : null,
      advertencia: conAntecedentes ? ADVERTENCIA_DIRECCION : null,
    };
  }

  async listarClientes(
    id_empresa: number,
    page: unknown = 1,
    limit: unknown = 20,
    filtros: FiltrosClientes = {},
  ) {
    const { page: pageSeguro, limit: limitSeguro, skip } = normalizarPaginacion(page, limit);

    // Un filtro que llega en blanco o con solo espacios no filtra nada: sin el
    // trim, buscar " " devolveria vacio en vez del listado completo.
    const limpiar = (valor?: string) => valor?.trim() || undefined;
    const nombre = limpiar(filtros.nombre);
    const rut = limpiar(filtros.rut);
    const porRut = rut ? filtroRut(rut) : undefined;
    const telefono = limpiar(filtros.telefono);
    const direccion = limpiar(filtros.direccion);
    const zona = limpiar(filtros.zona);

    // RF-54: zona. Sale de la ONT (SmartOLT) o de la caja del puerto; ver zonaDe.
    // registro_ont no tiene relacion con cliente en el esquema, asi que sus ids
    // se buscan antes.
    const porZonaOnt = zona
      ? (
          await this.prisma.registro_ont.findMany({
            where: { id_empresa, id_cliente: { not: null }, zona: { contains: zona, mode: 'insensitive' } },
            select: { id_cliente: true },
          })
        ).map((r) => r.id_cliente as number)
      : [];

    // id_empresa va primero y sin condicion: es lo que impide que un usuario de
    // una empresa vea clientes de la otra, y ningun filtro puede relajarlo.
    const where: Prisma.clienteWhereInput = {
      id_empresa,
      ...(nombre && { nombre_completo: { contains: nombre, mode: 'insensitive' } }),
      // La columna guarda dos grafias a la vez --mitad "12345678-5" y mitad
      // "123456785"-- porque los cuatro grupos escriben en ella. filtroRut
      // compara contra todas; ver variantesRut.
      ...(porRut && { rut: porRut }),
      ...(telefono && { telefono: { contains: telefono } }),
      ...(direccion && {
        direcciones: {
          some: { direccion_completa: { contains: direccion, mode: 'insensitive' } },
        },
      }),
      ...(zona && {
        OR: [
          { id_cliente: { in: porZonaOnt } },
          { puertos_nap: { some: { caja_nap: { zona: { contains: zona, mode: 'insensitive' } } } } },
        ],
      }),
    };

    const [clientes, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where,
        orderBy: { fecha_creacion: 'desc' },
        skip,
        take: limitSeguro,
        include: {
          direcciones: {
            where: { es_principal: true },
          },
        },
      }),
      this.prisma.cliente.count({ where }),
    ]);

    return { data: clientes, total, page: pageSeguro, limit: limitSeguro };
  }

  /**
   * Catalogo de planes, en solo lectura (acta con FiNet). El alta y la edicion
   * quedan pendientes de B-01: de quien son `plan` y `contrato`. El precio es
   * Decimal y Prisma lo entrega como string: se normaliza a numero aca.
   */
  async listarPlanes(id_empresa: number) {
    const planes = await this.prisma.plan.findMany({
      where: {
        id_empresa,
        activo: true,
      },
      orderBy: [{ tipo_plan: 'asc' }, { precio_mensual: 'asc' }],
      select: {
        id_plan: true,
        nombre_comercial: true,
        tipo_plan: true,
        tipo_cliente: true,
        velocidad_mbps: true,
        precio_mensual: true,
        descripcion: true,
      },
    });
    return planes.map((p) => ({ ...p, precio_mensual: Number(p.precio_mensual) }));
  }
}
