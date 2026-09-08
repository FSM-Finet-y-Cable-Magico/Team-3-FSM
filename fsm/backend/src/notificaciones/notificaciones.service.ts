import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from '../monitoreo/alertas.service.js';
import {
  CANAL_NOTIFICACION,
  ESTADO_ENVIO,
  HORAS_OT_INACTIVA,
  VARIABLES_PLANTILLA,
  type CanalNotificacion,
} from './notificaciones.constants.js';

/**
 * A quien alcanza DE VERDAD una alerta, segun su tipo.
 *
 * Tiene que coincidir con lo que la propia alerta declara en `afectados`, o el
 * panel y el aviso dirian cosas distintas de un mismo incidente. El motor lo
 * cuenta asi:
 *   - las fallas agregadas y SIN_SENAL cuentan ONT CAIDAS;
 *   - POTENCIA_DEGRADANDOSE cuenta las que se estan degradando.
 *
 * La diferencia no es cosmetica: usar un criterio mas ancho para las fallas
 * sumaba las de potencia fuera de rango, gente que esta navegando bien y que
 * recibiria un "tu servicio esta caido". Un SMS no se puede desdecir.
 */
type Alcanzado = { estado: string | null; potencia_fuera_de_rango: boolean; degradandose: boolean };

const alcanzadoPor = (tipo: string) => {
  if (tipo === 'POTENCIA_DEGRADANDOSE') return (a: Alcanzado) => a.degradandose;
  if (tipo === 'POTENCIA_BAJA' || tipo === 'POTENCIA_ALTA') {
    return (a: Alcanzado) => a.potencia_fuera_de_rango;
  }
  return (a: Alcanzado) => a.estado != null && a.estado !== 'ONLINE';
};

/** Estados en los que una OT ya no se mueve mas: no tiene sentido reclamarlas. */
const ESTADOS_TERMINALES = ['COMPLETADA', 'CANCELADA'];

export interface ResumenEnvio {
  id_alerta: number;
  destinatarios: number;
  enviadas: number;
  /** Clientes de la alerta que no tienen a donde recibir el aviso. */
  sin_contacto: number;
  /** Ya avisados antes por esta misma alerta: no se les repite. */
  ya_avisados: number;
  canal: CanalNotificacion;
  simulado: boolean;
  /** Lo que se le informo al cliente como tiempo estimado, si lo hubo. */
  tiempo_estimado: string | null;
}

/**
 * Notificaciones a clientes y avisos internos (RF-42, RF-43, RF-45).
 *
 * IMPORTANTE sobre el envio: hoy NADA sale del sistema. No hay proveedor de
 * correo/SMS contratado ni credenciales, y FiNet todavia no definio cual usara.
 * Lo que si queda construido es la parte que no cambia con el proveedor: a
 * quien hay que avisarle, con que texto, y el registro de lo que se hizo.
 *
 * Por eso cada envio se guarda como `SIMULADO` y no como `ENVIADO`. Marcar
 * "ENVIADO" algo que nunca salio haria creer al jefe tecnico que el cliente ya
 * sabe, y es la clase de mentira que se descubre tarde y mal --cuando el
 * cliente llama enojado porque nadie le aviso.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    private prisma: PrismaService,
    private alertas: AlertasService,
  ) {}

  // ---------------------------------------------------------------------------
  // RF-43 — Plantillas
  // ---------------------------------------------------------------------------

  /**
   * Plantillas visibles para una empresa: las suyas y las base compartidas.
   *
   * Las de `id_empresa = null` son las que vienen con el sistema. Se muestran
   * pero no se pueden editar ni borrar: si una empresa las tocara, cambiaria
   * tambien las de la otra.
   */
  async listarPlantillas(id_empresa: number) {
    const filas = await this.prisma.plantilla_notificacion.findMany({
      where: { OR: [{ id_empresa }, { id_empresa: null }] },
      orderBy: [{ id_empresa: 'asc' }, { id_plantilla: 'asc' }],
    });
    return filas.map((p) => ({
      ...p,
      es_base: p.id_empresa == null,
      editable: p.id_empresa != null,
      variables_usadas: this.variablesDe(p.contenido_texto ?? ''),
    }));
  }

  async crearPlantilla(
    id_empresa: number,
    datos: {
      tipo_evento?: string;
      canal: string;
      contenido_texto: string;
      tiempo_estimado_reparacion?: string;
      activa?: boolean;
    },
  ) {
    this.exigirVariablesConocidas(datos.contenido_texto);
    return this.prisma.plantilla_notificacion.create({
      // `id_empresa` sale del token, nunca del cuerpo: si viniera del cliente,
      // cualquiera podria crear plantillas dentro de la otra empresa.
      data: { ...datos, id_empresa },
    });
  }

  async editarPlantilla(
    id_plantilla: number,
    id_empresa: number,
    datos: {
      tipo_evento?: string;
      canal?: string;
      contenido_texto?: string;
      tiempo_estimado_reparacion?: string;
      activa?: boolean;
    },
  ) {
    const actual = await this.plantillaPropia(id_plantilla, id_empresa);
    if (datos.contenido_texto !== undefined) this.exigirVariablesConocidas(datos.contenido_texto);
    return this.prisma.plantilla_notificacion.update({
      where: { id_plantilla: actual.id_plantilla },
      data: datos,
    });
  }

  /**
   * Desactiva en vez de borrar.
   *
   * `log_notificacion.id_plantilla` apunta aca, y borrarla dejaria los envios
   * viejos sin saber con que texto se hicieron. El mensaje concreto igual queda
   * en `mensaje_enviado`, pero perder el vinculo rompe "que plantilla se uso".
   */
  async desactivarPlantilla(id_plantilla: number, id_empresa: number) {
    const actual = await this.plantillaPropia(id_plantilla, id_empresa);
    return this.prisma.plantilla_notificacion.update({
      where: { id_plantilla: actual.id_plantilla },
      data: { activa: false },
    });
  }

  private async plantillaPropia(id_plantilla: number, id_empresa: number) {
    const p = await this.prisma.plantilla_notificacion.findUnique({ where: { id_plantilla } });
    // Mismo 404 si no existe y si es de otra empresa: no hay que decirle a
    // quien pregunta cual de los dos casos es.
    if (!p || p.id_empresa !== id_empresa) {
      if (p && p.id_empresa == null) {
        throw new BadRequestException(
          'Es una plantilla base del sistema. Duplicala para tener una propia.',
        );
      }
      throw new NotFoundException(`Plantilla ${id_plantilla} no encontrada`);
    }
    return p;
  }

  // ---------------------------------------------------------------------------
  // Armado del mensaje
  // ---------------------------------------------------------------------------

  private variablesDe(texto: string): string[] {
    return [...new Set([...texto.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))];
  }

  /**
   * Rechaza variables que no existen.
   *
   * Sin esto, un `{{direccion}}` mal puesto se enviaria literal al cliente, o
   * peor, si se interpolara cualquier campo, una plantilla podria sacar datos
   * que no corresponde mandar.
   */
  private exigirVariablesConocidas(texto: string) {
    const desconocidas = this.variablesDe(texto).filter(
      (v) => !(VARIABLES_PLANTILLA as readonly string[]).includes(v),
    );
    if (desconocidas.length) {
      throw new BadRequestException(
        `Variables desconocidas: ${desconocidas.join(', ')}. ` +
          `Disponibles: ${VARIABLES_PLANTILLA.join(', ')}`,
      );
    }
  }

  /** Reemplaza las variables. Lo que no tiene valor queda vacio, no "undefined". */
  private render(plantilla: string, datos: Record<string, string | null | undefined>) {
    return plantilla.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, clave: string) => datos[clave] ?? '');
  }

  // ---------------------------------------------------------------------------
  // RF-42 / CU-48 — Aviso masivo a los clientes de una falla
  // ---------------------------------------------------------------------------

  /**
   * A quienes alcanza una alerta, con su contacto.
   *
   * Se expone aparte del envio para que el jefe tecnico pueda ver la lista
   * ANTES de mandar nada. Avisar a 71 personas es irreversible: no hay como
   * "des-enviar" un SMS, asi que conviene mirar a quien le va a llegar.
   */
  async destinatariosDeAlerta(id_alerta: number, id_empresa: number) {
    // Se reusa el detalle del motor de alertas en vez de volver a resolver
    // quien cuelga de la caja. Si se calculara aparte, la lista de "a quien le
    // avisamos" podria terminar diciendo algo distinto de la que el jefe
    // tecnico ve en el panel de la misma alerta -- y no habria forma de saber
    // cual de las dos es la correcta.
    const { alerta, afectados } = await this.alertas.detalle(id_alerta, id_empresa);

    // `detalle` devuelve la lista vacia para las alertas individuales: no hay
    // grupo que desplegar, el cliente es uno solo y ya esta en la alerta. Si se
    // dejara asi, avisar sobre una alerta individual no haria nada y no diria
    // por que -- el peor resultado posible: el jefe tecnico cree que aviso.
    const uno = afectados.length === 0 ? await this.clienteDeAlertaIndividual(alerta, id_empresa) : [];
    const alcanzados = afectados.length ? afectados : uno;

    const avisados = await this.prisma.log_notificacion.findMany({
      where: { id_alerta },
      select: { id_cliente: true },
    });
    const yaAvisados = new Set(avisados.map((a) => a.id_cliente));

    return {
      alerta,
      destinatarios: alcanzados
        // Los equipos de clientes dados de baja no son parte del incidente: el
        // motor ya los marca, y avisarle a alguien que no tiene servicio hace
        // meses es ruido.
        .filter((a) => !a.inactiva)
        // Y sobre todo: solo los que REALMENTE estan afectados.
        //
        // `detalle` devuelve el padron completo del agregado, que es lo que el
        // panel necesita para despachar --la cuadrilla va a la placa entera--
        // pero no es a quien hay que avisarle. Sobre la falla de placa real de
        // FiNet eso da 302 ONT cuando las caidas son 71: mandarle "tu servicio
        // esta caido" a 231 personas que estan navegando sin problema es peor
        // que no avisar, y no hay como desdecirlo.
        //
        // La definicion de afectado es la MISMA que usa CU-15: sin servicio o
        // con potencia fuera del rango operativo. La franja preventiva queda
        // afuera porque esos clientes todavia tienen servicio.
        .filter(alcanzadoPor(alerta.tipo))
        .map((a) => ({
          numero_serie: a.numero_serie,
          zona: a.zona,
          caja: a.caja,
          id_cliente: a.id_cliente,
          nombre: a.cliente,
          telefono: a.telefono,
          email: a.email,
          // Contactable exige cliente NUESTRO: a uno que solo existe en la
          // ficha de SmartOLT no se le puede registrar el aviso, aunque la
          // ficha traiga un telefono suelto.
          contactable: a.id_cliente != null && Boolean(a.telefono || a.email),
          ya_avisado: a.id_cliente != null && yaAvisados.has(a.id_cliente),
        })),
    };
  }

  /** El unico cliente de una alerta individual, en la misma forma que `afectados`. */
  private async clienteDeAlertaIndividual(
    alerta: { id_registro_ont: number | null },
    id_empresa: number,
  ) {
    if (alerta.id_registro_ont == null) return [];
    const r = await this.prisma.registro_ont.findUnique({
      where: { id_registro_ont: alerta.id_registro_ont },
      select: { numero_serie: true, zona: true, odb: true, id_cliente: true, nombre_cliente_ext: true },
    });
    if (!r?.id_cliente) return [];
    // Acotado por empresa: es lo que impide leer un cliente ajeno si el
    // registro quedara mal ligado.
    const c = await this.prisma.cliente.findFirst({
      where: { id_cliente: r.id_cliente, id_empresa },
      select: { id_cliente: true, nombre_completo: true, telefono: true, email: true },
    });
    if (!c) return [];
    return [{
      numero_serie: r.numero_serie,
      zona: r.zona,
      caja: r.odb,
      id_cliente: c.id_cliente,
      cliente: c.nombre_completo,
      telefono: c.telefono,
      email: c.email,
      inactiva: false,
        // La alerta individual existe porque ESA ONT esta mal, sea cual sea el
      // tipo: se marca en las tres condiciones para que el predicado del tipo
      // que sea la deje pasar.
      estado: 'OFFLINE' as string | null,
      potencia_fuera_de_rango: true,
      degradandose: true,
    }];
  }

  /**
   * Registra el aviso a todos los clientes de una alerta.
   *
   * No reenvia a quien ya fue avisado por ESTA alerta: durante una falla el
   * jefe tecnico entra varias veces al panel, y sin este freno el cliente
   * recibiria el mismo mensaje cada vez.
   */
  async notificarAlerta(
    id_alerta: number,
    id_empresa: number,
    opciones: { id_plantilla: number; canal?: string; tiempo_estimado?: string },
  ): Promise<ResumenEnvio> {
    const { alerta, destinatarios } = await this.destinatariosDeAlerta(id_alerta, id_empresa);

    const plantilla = await this.prisma.plantilla_notificacion.findUnique({
      where: { id_plantilla: opciones.id_plantilla },
    });
    if (!plantilla || (plantilla.id_empresa != null && plantilla.id_empresa !== id_empresa)) {
      throw new NotFoundException(`Plantilla ${opciones.id_plantilla} no encontrada`);
    }
    if (!plantilla.activa) {
      throw new BadRequestException('La plantilla está desactivada');
    }

    const canal = (opciones.canal ?? plantilla.canal ?? CANAL_NOTIFICACION.INTERNO) as CanalNotificacion;
    const empresa = await this.prisma.empresa.findUnique({
      where: { id_empresa },
      select: { nombre: true },
    });
    const ahora = new Date();

    const aAvisar = destinatarios.filter((d) => d.id_cliente && d.contactable && !d.ya_avisado);
    const filas = aAvisar.map((d) => ({
      id_cliente: d.id_cliente!,
      id_plantilla: plantilla.id_plantilla,
      id_alerta: alerta.id_alerta,
      canal,
      fecha_envio: ahora,
      // SIMULADO, no ENVIADO: ver el comentario de la clase.
      estado_envio: ESTADO_ENVIO.SIMULADO,
      mensaje_enviado: this.render(plantilla.contenido_texto ?? '', {
        cliente: d.nombre,
        zona: d.zona,
        caja: alerta.clave_caja?.split('|')[1] ?? null,
        fecha: ahora.toLocaleDateString('es-CL'),
        hora: ahora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
        empresa: empresa?.nombre,
        // Lo que se informe en ESTE incidente manda sobre el valor por defecto
        // de la plantilla: dos cortes de la misma caja no duran lo mismo.
        tiempo_estimado: opciones.tiempo_estimado?.trim() || plantilla.tiempo_estimado_reparacion,
      }),
    }));

    if (filas.length) await this.prisma.log_notificacion.createMany({ data: filas });

    const resumen: ResumenEnvio = {
      id_alerta: alerta.id_alerta,
      destinatarios: destinatarios.length,
      enviadas: filas.length,
      sin_contacto: destinatarios.filter((d) => !d.contactable && !d.ya_avisado).length,
      ya_avisados: destinatarios.filter((d) => d.ya_avisado).length,
      canal,
      simulado: true,
      tiempo_estimado:
        opciones.tiempo_estimado?.trim() || plantilla.tiempo_estimado_reparacion || null,
    };
    this.logger.log(
      `Alerta ${id_alerta}: ${resumen.enviadas} avisos registrados (${canal}), ` +
        `${resumen.sin_contacto} sin contacto, ${resumen.ya_avisados} ya avisados`,
    );
    return resumen;
  }

  /** Lo que se le mando a un cliente. Para responder "¿me avisaron?". */
  async historialCliente(id_cliente: number, id_empresa: number) {
    const cliente = await this.prisma.cliente.findFirst({
      where: { id_cliente, id_empresa },
      select: { id_cliente: true },
    });
    if (!cliente) throw new NotFoundException(`Cliente ${id_cliente} no encontrado`);

    return this.prisma.log_notificacion.findMany({
      where: { id_cliente },
      orderBy: { fecha_envio: 'desc' },
      take: 100,
      select: {
        id_notificacion: true,
        canal: true,
        fecha_envio: true,
        estado_envio: true,
        mensaje_enviado: true,
        id_alerta: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // RF-45 / CU-51 — OT detenidas
  // ---------------------------------------------------------------------------

  /**
   * OT que llevan mas de `HORAS_OT_INACTIVA` sin moverse.
   *
   * "Sin moverse" es sin cambio de estado, no sin haberse creado: una OT recien
   * creada y asignada esta avanzando aunque siga PENDIENTE. Por eso el reloj
   * corre desde el ultimo `historial_ot`, y solo cae a `fecha_creacion` cuando
   * todavia no tuvo ningun movimiento.
   *
   * Las terminales quedan fuera: una OT completada hace un mes no esta detenida,
   * esta lista.
   */
  async otDetenidas(id_empresa: number, horas = HORAS_OT_INACTIVA) {
    const corte = new Date(Date.now() - horas * 3600_000);

    const ots = await this.prisma.orden_trabajo.findMany({
      where: { id_empresa, estado: { notIn: ESTADOS_TERMINALES } },
      select: {
        id_ot: true,
        tipo_ot: true,
        estado: true,
        prioridad: true,
        fecha_creacion: true,
        fecha_programada: true,
        cliente: { select: { id_cliente: true, nombre_completo: true } },
        tecnico: { select: { id_usuario: true, nombre_completo: true } },
        historial: { orderBy: { fecha_hora: 'desc' }, take: 1, select: { fecha_hora: true, estado_nuevo: true } },
      },
    });

    return ots
      .map((o) => {
        const ultimo = o.historial[0]?.fecha_hora ?? o.fecha_creacion;
        return {
          id_ot: o.id_ot,
          tipo_ot: o.tipo_ot,
          estado: o.estado,
          prioridad: o.prioridad,
          cliente: o.cliente?.nombre_completo ?? null,
          tecnico: o.tecnico?.nombre_completo ?? null,
          sin_movimiento_desde: ultimo,
          horas_detenida: Math.floor((Date.now() - ultimo.getTime()) / 3600_000),
          /** Una OT sin tecnico detenida es peor: nadie la va a mover sola. */
          sin_tecnico: o.tecnico == null,
        };
      })
      .filter((o) => o.sin_movimiento_desde < corte)
      // La que lleva mas tiempo parada primero: es la que peor esta.
      .sort((a, b) => b.horas_detenida - a.horas_detenida);
  }
}
