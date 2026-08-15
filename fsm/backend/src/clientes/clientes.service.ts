import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { validarRut } from '../common/utils/rut.util.js';
import { RegistrarClienteDto } from './dto/registrar-cliente.dto.js';
import { EditarClienteDto } from './dto/editar-cliente.dto.js';
import { MarcarConflictivoDto } from './dto/marcar-conflictivo.dto.js';

@Injectable()
export class ClientesService {
  constructor(private prisma: PrismaService) {}

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
          where: { estado: 'ACTIVO' },
          include: { plan: true },
          take: 1,
        },
      },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const historial_ot = await this.prisma.orden_trabajo.findMany({
      where: { id_cliente: cliente.id_cliente },
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
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 30);

    const totalReparaciones30Dias = await this.prisma.orden_trabajo.count({
      where: {
        id_cliente: cliente.id_cliente,
        id_empresa,
        tipo_ot: 'REPARACION',
        estado: { not: 'CANCELADA' },
        fecha_creacion: { gte: hace30Dias },
      },
    });

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
        contrato_activo: cliente.contratos[0] ?? null,
      },
      historial_ot,
      alerta_reparaciones_30_dias: {
        activa: totalReparaciones30Dias >= 3,
        total_reparaciones_30_dias: totalReparaciones30Dias,
        desde: hace30Dias,
      },
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

  async listarClientes(id_empresa: number, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [clientes, total] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { id_empresa },
        orderBy: { fecha_creacion: 'desc' },
        skip,
        take: limit,
        include: {
          direcciones: {
            where: { es_principal: true },
          },
        },
      }),
      this.prisma.cliente.count({ where: { id_empresa } }),
    ]);

    return { data: clientes, total, page, limit };
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
