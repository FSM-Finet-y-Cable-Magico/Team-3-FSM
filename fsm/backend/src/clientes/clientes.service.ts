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

/** Criterios de la busqueda de clientes (RF-54). Todos opcionales y combinables. */
export interface FiltrosClientes {
  nombre?: string;
  rut?: string;
  telefono?: string;
  direccion?: string;
}
const MAX_CONTRATOS_ACTIVOS = 50;
/** Tope de OT que CU-07 trae para agrupar. Con decenas por cliente sobra. */
const MAX_OT_HISTORIAL = 500;
/** Cuantas OT se detallan por direccion; el resumen no se recorta. */
const MAX_OT_POR_DIRECCION = 20;

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
          ...(dto.es_conflictivo !== undefined && { es_conflictivo: dto.es_conflictivo }),
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

  async marcarConflictivo(
    id_cliente: number,
    dto: MarcarConflictivoDto,
    userId: number,
    id_empresa: number,
  ) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cliente.update({
        where: { id_cliente },
        data: {
          es_conflictivo: true,
          obs_conflictivo: dto.motivo,
        },
      });

      await tx.lista_negra.create({
        data: {
          id_cliente,
          rut_vetado: cliente.rut ?? '',
          motivo: dto.motivo,
          fecha_registro: new Date(),
          id_usuario_registro: userId,
        },
      });

      await tx.log_auditoria.create({
        data: {
          id_usuario: userId,
          accion: 'MARCAR_CONFLICTIVO',
          entidad_afectada: 'cliente',
          id_entidad_afectada: id_cliente,
          fecha_hora: new Date(),
        },
      });
    });
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

  /**
   * CU-07 "Consultando el historial de un cliente por direccion".
   *
   * Un cliente puede tener varias direcciones de servicio, y lo que le sirve al
   * jefe tecnico no es la lista plana de OT sino QUE PASO EN CADA CASA: si la
   * de Quilvo lleva tres reparaciones en dos meses y la otra ninguna, el
   * problema es del domicilio y no del cliente.
   *
   * SE CONSULTA POR CLIENTE, NO POR DIRECCION, y se agrupa en memoria. No es
   * un rodeo: `orden_trabajo` tiene `@@index([id_cliente])` pero NO tiene
   * indice sobre `id_direccion`, asi que filtrar por direccion haria un scan de
   * la tabla. Agregar ese indice es aditivo pero va sobre una tabla compartida
   * con G1 y G8, o sea ventana coordinada; y para el volumen real --decenas de
   * OT por cliente-- agrupar en memoria no se nota.
   */
  async historialPorDireccion(id_cliente: number, id_empresa: number) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa },
      select: {
        id_cliente: true,
        rut: true,
        nombre_completo: true,
        direcciones: {
          select: {
            id_direccion: true,
            direccion_completa: true,
            comuna: true,
            ciudad: true,
            es_principal: true,
          },
          orderBy: [{ es_principal: 'desc' }, { id_direccion: 'asc' }],
        },
      },
    });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const ordenes = await this.prisma.orden_trabajo.findMany({
      where: { id_cliente, id_empresa },
      orderBy: { fecha_creacion: 'desc' },
      // Tope de seguridad. Si algun cliente llegara a superarlo, el resumen
      // seria de las mas recientes y no de todo; se avisa abajo en vez de
      // dejar que el conteo mienta.
      take: MAX_OT_HISTORIAL + 1,
      select: {
        id_ot: true,
        id_direccion: true,
        tipo_ot: true,
        estado: true,
        prioridad: true,
        fecha_creacion: true,
        fecha_completada: true,
        categoria_falla: { select: { id_categoria: true, nombre: true } },
      },
    });

    const truncado = ordenes.length > MAX_OT_HISTORIAL;
    const usadas = truncado ? ordenes.slice(0, MAX_OT_HISTORIAL) : ordenes;

    const porDireccion = new Map<number, typeof usadas>();
    let sin_direccion = 0;
    for (const ot of usadas) {
      if (ot.id_direccion == null) {
        sin_direccion++;
        continue;
      }
      const lista = porDireccion.get(ot.id_direccion);
      if (lista) lista.push(ot);
      else porDireccion.set(ot.id_direccion, [ot]);
    }

    const contar = <T extends string>(valores: (T | null)[]) => {
      const cuenta: Record<string, number> = {};
      for (const v of valores) if (v) cuenta[v] = (cuenta[v] ?? 0) + 1;
      return cuenta;
    };

    const direcciones = cliente.direcciones.map((d) => {
      // Una direccion sin OT entra igual, con total 0: saber que en esa casa
      // nunca paso nada es informacion, y omitirla la haria parecer inexistente.
      const suyas = porDireccion.get(d.id_direccion) ?? [];
      const categorias = contar(suyas.map((o) => o.categoria_falla?.nombre ?? null));
      const [masFrecuente] = Object.entries(categorias).sort((a, b) => b[1] - a[1]);

      return {
        ...d,
        total_ot: suyas.length,
        por_tipo: contar(suyas.map((o) => o.tipo_ot)),
        por_estado: contar(suyas.map((o) => o.estado)),
        // La primera es la mas reciente: `ordenes` viene ordenado desc.
        ultima_ot: suyas[0]?.fecha_creacion ?? null,
        categoria_mas_frecuente: masFrecuente ? { nombre: masFrecuente[0], veces: masFrecuente[1] } : null,
        ordenes: suyas.slice(0, MAX_OT_POR_DIRECCION).map((o) => ({
          id_ot: o.id_ot,
          tipo_ot: o.tipo_ot,
          estado: o.estado,
          prioridad: o.prioridad,
          fecha_creacion: o.fecha_creacion,
          fecha_completada: o.fecha_completada,
          categoria_falla: o.categoria_falla,
        })),
      };
    });

    return {
      cliente: {
        id_cliente: cliente.id_cliente,
        rut: cliente.rut,
        nombre_completo: cliente.nombre_completo,
      },
      direcciones,
      /**
       * OT del cliente que no apuntan a ninguna direccion. `id_direccion` es
       * opcional en el modelo, asi que existen: se declaran para que la suma de
       * `total_ot` cuadre con el total y nadie salga a buscar OT perdidas.
       */
      ot_sin_direccion: sin_direccion,
      total_ot: usadas.length,
      truncado,
    };
  }
}
