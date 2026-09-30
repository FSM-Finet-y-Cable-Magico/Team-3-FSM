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
import { validarRut } from '../common/utils/rut.util.js';
import { RegistrarClienteDto } from './dto/registrar-cliente.dto.js';
import { EditarClienteDto } from './dto/editar-cliente.dto.js';
import { MarcarConflictivoDto } from './dto/marcar-conflictivo.dto.js';
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

    const existente = await this.prisma.cliente.findUnique({
      where: { rut: dto.rut },
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
        rut,
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
          where: { rut: q.rut.trim().toUpperCase(), id_empresa },
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
    const telefono = limpiar(filtros.telefono);
    const direccion = limpiar(filtros.direccion);

    // id_empresa va primero y sin condicion: es lo que impide que un usuario de
    // una empresa vea clientes de la otra, y ningun filtro puede relajarlo.
    const where: Prisma.clienteWhereInput = {
      id_empresa,
      ...(nombre && { nombre_completo: { contains: nombre, mode: 'insensitive' } }),
      // El RUT se guarda sin puntos ni guion (ver RutInput), pero el digito
      // verificador puede ser K y queda con la mayuscula que se tecleo al dar
      // de alta: RutInput solo la sube para mostrarla en pantalla, no en el
      // valor que propaga. Sin `insensitive`, buscar "...k" no encuentra al
      // cliente guardado con "...K", y es 1 de cada 11 RUT.
      ...(rut && { rut: { contains: rut, mode: 'insensitive' } }),
      ...(telefono && { telefono: { contains: telefono } }),
      ...(direccion && {
        direcciones: {
          some: { direccion_completa: { contains: direccion, mode: 'insensitive' } },
        },
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

  async listarPlanes(id_empresa: number) {
    return this.prisma.plan.findMany({
      where: {
        id_empresa,
        activo: true,
      },
      select: {
        id_plan: true,
        nombre_comercial: true,
        velocidad_mbps: true,
        precio_mensual: true,
      },
    });
  }
}
