import { normalizarPaginacion } from '../common/utils/paginacion.util.js';
import { FILTRO_ESTADO_ACTIVO } from '../common/utils/estado-activo.util.js';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReparacionesRecurrentesService } from '../ordenes/reparaciones-recurrentes.service.js';
import {
  filtroRut,
  validarRut,
  variantesRut,
} from '../common/utils/rut.util.js';
import {
  ADVERTENCIA_DIRECCION,
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

/**
 * El listado de clientes muestra la cartera vigente del CRM: activos y
 * suspendidos por deuda. Las bajas quedan fuera, pero su ficha se sigue
 * abriendo y la busqueda por direccion (CU-07) las muestra como anteriores.
 *
 * Insensible a mayusculas porque el CRM de G8 guarda 'Baja' y el FSM viejo
 * guardaba 'BAJA'. `estado` es NOT NULL en el esquema, asi que el NOT no deja
 * fuera a nadie por no tener estado.
 */
export const CLIENTE_SIN_BAJA = {
  NOT: { estado: { equals: 'baja', mode: 'insensitive' } },
} satisfies Prisma.clienteWhereInput;

/** Texto de la excepcion 2 de CU-07. */
export const MENSAJE_SIN_CLIENTES_EN_DIRECCION =
  'No se encontraron clientes en esa dirección. Verifique la información ingresada.';

@Injectable()
export class ClientesService {
  constructor(private reparaciones: ReparacionesRecurrentesService,
    private prisma: PrismaService) {}

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
          // "Activo" en la base global, "ACTIVO" en la nuestra: ver estado-activo.util.ts.
          where: { estado: FILTRO_ESTADO_ACTIVO, id_empresa },
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
      // En AND y no como OR suelto: el filtro de zona ya usa la clave OR.
      AND: [CLIENTE_SIN_BAJA],
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
   *
   * El catalogo no es nuestro: contra la base compartida lo carga el CRM de G8
   * (ver estado-activo.util.ts), igual que los contratos. `contratos_activos`
   * no es un campo del catalogo sino un conteo que hace el FSM sobre esos
   * contratos: le dice al jefe tecnico cuanta gente hay en cada plan, no solo
   * que el plan existe.
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
        _count: {
          select: {
            // "Activo" en la base global, "ACTIVO" en la nuestra: ver
            // estado-activo.util.ts. El contrato lleva su propia empresa, asi
            // que se acota igual que el plan y no se cuentan cruzados.
            contratos: { where: { estado: FILTRO_ESTADO_ACTIVO, id_empresa } },
          },
        },
      },
    });
    return planes.map(({ _count, ...p }) => ({
      ...p,
      precio_mensual: Number(p.precio_mensual),
      contratos_activos: _count?.contratos ?? 0,
    }));
  }
}
