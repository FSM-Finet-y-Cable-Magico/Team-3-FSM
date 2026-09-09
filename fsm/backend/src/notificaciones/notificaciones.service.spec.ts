import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertasService } from '../monitoreo/alertas.service.js';

/**
 * RF-42, RF-43 y RF-45.
 *
 * Lo que se fija aca es lo irreversible: a quien le llega el aviso. Un SMS mal
 * mandado no se puede desdecir, asi que las pruebas apuntan sobre todo a que la
 * lista de destinatarios sea la correcta y no una mas ancha.
 */
describe('Notificaciones', () => {
  let service: NotificacionesService;
  let detalle: any;
  let plantilla: any;
  let logs: any[];
  let ots: any[];
  const otFindMany = jest.fn(async (_a: unknown) => ots);
  const otFindFirst = jest.fn(async (_a: unknown) => null as any);
  const otUpdate = jest.fn(async (_a: unknown) => ({}) as any);

  const createMany = jest.fn(async (args: any) => ({ count: args.data.length }));
  const plantillaFindUnique = jest.fn(async () => plantilla);
  const plantillaFindMany = jest.fn(async () => [plantilla]);
  const plantillaUpdate = jest.fn(async (a: any) => ({ ...plantilla, ...a.data }));
  const plantillaCreate = jest.fn(async (a: any) => ({ id_plantilla: 9, ...a.data }));

  // Un afectado tal como lo devuelve `AlertasService.detalle`.
  const af = (over: Record<string, unknown> = {}) => ({
    numero_serie: 'SN-1',
    id_cliente: 1,
    cliente: 'Juan Perez',
    telefono: '+56900000000',
    email: null,
    zona: 'ZONA 3',
    caja: 'NAP 6',
    estado: 'LOS',
    potencia_fuera_de_rango: false,
    degradandose: false,
    inactiva: false,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    logs = [];
    ots = [];
    plantilla = {
      id_plantilla: 1,
      id_empresa: 1,
      canal: 'SMS',
      activa: true,
      contenido_texto: 'Hola {{cliente}}, falla en {{zona}}. Estimamos {{tiempo_estimado}}.',
      tiempo_estimado_reparacion: '4 a 6 horas',
    };
    detalle = { alerta: { id_alerta: 7, tipo: 'FALLA_CAJA_NAP', clave_caja: '2/1/7|NAP 6' }, afectados: [] };

    const prisma = {
      plantilla_notificacion: {
        findMany: plantillaFindMany,
        findUnique: plantillaFindUnique,
        update: plantillaUpdate,
        create: plantillaCreate,
      },
      log_notificacion: { findMany: jest.fn(async () => logs), createMany, },
      empresa: { findUnique: jest.fn(async () => ({ nombre: 'FiNet' })) },
      cliente: { findFirst: jest.fn(async () => ({ id_cliente: 1 })) },
      registro_ont: { findUnique: jest.fn(async () => null) },
      orden_trabajo: {
        findMany: otFindMany,
        findFirst: otFindFirst,
        update: otUpdate,
      },
    };

    const mod = await Test.createTestingModule({
      providers: [
        NotificacionesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AlertasService, useValue: { detalle: jest.fn(async () => detalle) } },
      ],
    }).compile();
    service = mod.get(NotificacionesService);
  });

  // --- RF-43 ------------------------------------------------------------------

  it('no deja editar una plantilla base del sistema', async () => {
    // Son compartidas por las dos empresas: si FiNet la editara, cambiaria
    // tambien la de Cable Magico.
    plantilla = { ...plantilla, id_empresa: null };
    await expect(service.editarPlantilla(1, 1, { activa: false })).rejects.toThrow(BadRequestException);
  });

  it('no deja tocar la plantilla de otra empresa, y no revela que existe', async () => {
    plantilla = { ...plantilla, id_empresa: 2 };
    // NotFound, no Forbidden: responder "existe pero no es tuya" ya es contar
    // algo de la otra empresa.
    await expect(service.editarPlantilla(1, 1, { activa: false })).rejects.toThrow(NotFoundException);
  });

  it('rechaza variables que no existen en vez de mandarlas literales', async () => {
    // Un `{{direccion}}` mal puesto llegaria tal cual al cliente.
    await expect(
      service.crearPlantilla(1, { canal: 'SMS', contenido_texto: 'Hola {{direccion}}' }),
    ).rejects.toThrow(/direccion/);
  });

  it('la empresa sale del token y no del cuerpo', async () => {
    await service.crearPlantilla(1, { canal: 'SMS', contenido_texto: 'Hola {{cliente}}' } as any);
    expect(plantillaCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ id_empresa: 1 }),
    });
  });

  // --- RF-42 ------------------------------------------------------------------

  it('avisa SOLO a los caidos, no a todo el padron del grupo', async () => {
    // El caso real de FiNet: la falla de placa devuelve 428 ONT de padron y
    // solo 74 estan caidas. Avisarle "tu servicio esta caido" a alguien que
    // esta navegando bien es peor que no avisar.
    detalle.afectados = [
      af({ id_cliente: 1, estado: 'LOS' }),
      af({ id_cliente: 2, estado: 'ONLINE', potencia_fuera_de_rango: true }),
      af({ id_cliente: 3, estado: 'ONLINE' }),
    ];

    const r = await service.destinatariosDeAlerta(7, 1);

    expect(r.destinatarios.map((d) => d.id_cliente)).toEqual([1]);
  });

  it('en una alerta de degradacion avisa a los que se estan degradando', async () => {
    // Ahi el afectado no es el caido: es el que todavia tiene servicio pero
    // viene cayendo. Es lo que cuenta la propia alerta.
    detalle.alerta.tipo = 'POTENCIA_DEGRADANDOSE';
    detalle.afectados = [
      af({ id_cliente: 1, estado: 'ONLINE', degradandose: true }),
      af({ id_cliente: 2, estado: 'LOS' }),
    ];

    const r = await service.destinatariosDeAlerta(7, 1);

    expect(r.destinatarios.map((d) => d.id_cliente)).toEqual([1]);
  });

  it('deja fuera los equipos de clientes dados de baja', async () => {
    detalle.afectados = [af({ id_cliente: 1 }), af({ id_cliente: 2, inactiva: true })];

    const r = await service.destinatariosDeAlerta(7, 1);

    expect(r.destinatarios.map((d) => d.id_cliente)).toEqual([1]);
  });

  it('no es contactable quien no esta ligado a un cliente nuestro', async () => {
    // 943 de 943 ONT de FiNet estan asi hoy: el nombre viene de la ficha de
    // SmartOLT y no hay a quien registrarle el aviso.
    detalle.afectados = [af({ id_cliente: null, cliente: 'JUAN DESDE SMARTOLT', telefono: '+56911111111' })];

    const r = await service.destinatariosDeAlerta(7, 1);

    expect(r.destinatarios[0]).toMatchObject({ contactable: false });
  });

  it('registra el mensaje ya armado, no solo la plantilla', async () => {
    // Si despues se edita la plantilla, hay que poder mostrar que decia el
    // mensaje que recibio el cliente.
    detalle.afectados = [af()];

    const r = await service.notificarAlerta(7, 1, { id_plantilla: 1 });

    expect(r.enviadas).toBe(1);
    const fila = (createMany.mock.calls[0][0] as any).data[0];
    expect(fila.mensaje_enviado).toBe('Hola Juan Perez, falla en ZONA 3. Estimamos 4 a 6 horas.');
    expect(fila.id_alerta).toBe(7);
  });

  it('no marca ENVIADO lo que nunca salio del sistema', async () => {
    // No hay proveedor conectado. Decir "ENVIADO" haria creer al jefe tecnico
    // que el cliente ya sabe.
    detalle.afectados = [af()];

    const r = await service.notificarAlerta(7, 1, { id_plantilla: 1 });

    expect(r.simulado).toBe(true);
    expect((createMany.mock.calls[0][0] as any).data[0].estado_envio).toBe('SIMULADO');
  });

  it('no le vuelve a avisar a quien ya fue avisado por esa alerta', async () => {
    // Durante una falla el jefe tecnico entra al panel varias veces.
    detalle.afectados = [af({ id_cliente: 1 }), af({ id_cliente: 2 })];
    logs = [{ id_cliente: 1 }];

    const r = await service.notificarAlerta(7, 1, { id_plantilla: 1 });

    expect(r.enviadas).toBe(1);
    expect(r.ya_avisados).toBe(1);
    expect((createMany.mock.calls[0][0] as any).data[0].id_cliente).toBe(2);
  });

  it('no envia con una plantilla desactivada', async () => {
    detalle.afectados = [af()];
    plantilla = { ...plantilla, activa: false };
    await expect(service.notificarAlerta(7, 1, { id_plantilla: 1 })).rejects.toThrow(BadRequestException);
  });

  it('no envia con la plantilla de otra empresa', async () => {
    detalle.afectados = [af()];
    plantilla = { ...plantilla, id_empresa: 2 };
    await expect(service.notificarAlerta(7, 1, { id_plantilla: 1 })).rejects.toThrow(NotFoundException);
  });


  it('el tiempo estimado del incidente reemplaza al de la plantilla', async () => {
    // RF-42 lo pide en el mensaje, y RF-43 lo guarda en la plantilla. Pero dos
    // cortes de la misma caja no duran lo mismo: el que informa el jefe tecnico
    // al despachar manda sobre el valor por defecto.
    detalle.afectados = [af()];

    const r = await service.notificarAlerta(7, 1, { id_plantilla: 1, tiempo_estimado: '30 minutos' });

    expect((createMany.mock.calls[0][0] as any).data[0].mensaje_enviado).toContain('Estimamos 30 minutos.');
    expect(r.tiempo_estimado).toBe('30 minutos');
  });

  it('sin tiempo del incidente usa el de la plantilla', async () => {
    detalle.afectados = [af()];

    const r = await service.notificarAlerta(7, 1, { id_plantilla: 1 });

    expect(r.tiempo_estimado).toBe('4 a 6 horas');
  });

  it('una plantilla sin tiempo estimado no escribe "undefined" en el mensaje', async () => {
    // El render deja vacio lo que no tiene valor. Mandarle "undefined" a un
    // cliente por SMS es de las cosas que no se pueden deshacer.
    plantilla = { ...plantilla, tiempo_estimado_reparacion: null };
    detalle.afectados = [af()];

    await service.notificarAlerta(7, 1, { id_plantilla: 1 });

    const enviado = (createMany.mock.calls[0][0] as any).data[0].mensaje_enviado;
    expect(enviado).not.toContain('undefined');
    expect(enviado).toBe('Hola Juan Perez, falla en ZONA 3. Estimamos .');
  });

  // --- RF-45 ------------------------------------------------------------------

  const hace = (h: number) => new Date(Date.now() - h * 3600_000);

  it('mide desde el ultimo movimiento, no desde la creacion', async () => {
    // Una OT creada hace tres dias pero movida hace una hora esta avanzando.
    ots = [
      { id_ot: 1, tipo_ot: 'REPARACION', estado: 'EN_CURSO', prioridad: 'ALTA',
        fecha_creacion: hace(72), cliente: null, tecnico: { id_usuario: 1, nombre_completo: 'Ana' },
        historial: [{ fecha_hora: hace(1), estado_nuevo: 'EN_CURSO' }] },
    ];

    expect(await service.otDetenidas(1)).toHaveLength(0);
  });

  it('cae a la fecha de creacion cuando la OT nunca se movio', async () => {
    ots = [
      { id_ot: 2, tipo_ot: 'INSTALACION', estado: 'ASIGNADA', prioridad: 'ALTA',
        fecha_creacion: hace(50), cliente: null, tecnico: null, historial: [] },
    ];

    const r = await service.otDetenidas(1);

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id_ot: 2, sin_tecnico: true });
    expect(r[0].horas_detenida).toBeGreaterThanOrEqual(50);
  });

  it('ordena por la que lleva mas tiempo parada', async () => {
    ots = [
      { id_ot: 1, tipo_ot: 'REPARACION', estado: 'ASIGNADA', prioridad: 'ALTA',
        fecha_creacion: hace(30), cliente: null, tecnico: null, historial: [] },
      { id_ot: 2, tipo_ot: 'REPARACION', estado: 'ASIGNADA', prioridad: 'BAJA',
        fecha_creacion: hace(96), cliente: null, tecnico: null, historial: [] },
    ];

    expect((await service.otDetenidas(1)).map((o) => o.id_ot)).toEqual([2, 1]);
  });
  it('solo mira los dos estados que nombra el RF, no todo lo no terminal', async () => {
    // Antes filtraba `notIn: ['COMPLETADA','CANCELADA']`, con lo que entraban
    // PENDIENTE y PENDIENTE_CLIENTE_AUSENTE. Esta ultima tiene su propia regla
    // en RF-09 --treinta dias-- y aparecer tambien aca la duplicaba.
    ots = [];
    await service.otDetenidas(1);

    const where = (otFindMany.mock.calls.at(-1)![0] as any).where;
    expect(where.estado).toEqual({ in: ['ASIGNADA', 'EN_CURSO'] });
    expect(where.id_empresa).toBe(1);
  });

  it('omite las alertas descartadas hace menos de 48 horas', async () => {
    ots = [];
    await service.otDetenidas(1);

    const where = (otFindMany.mock.calls.at(-1)![0] as any).where;
    const [sinDescartar, yaVencido] = where.OR;
    expect(sinDescartar).toEqual({ alerta_detenida_descartada_en: null });

    // El corte tiene que caer 48 h atras, ni 24 ni 72.
    const corte: Date = yaVencido.alerta_detenida_descartada_en.lt;
    const horas = (Date.now() - corte.getTime()) / 3600_000;
    expect(Math.round(horas)).toBe(48);
  });

  it('descartar deja la marca y dice cuando vuelve', async () => {
    otFindFirst.mockResolvedValue({ id_ot: 5, estado: 'ASIGNADA' });

    const r = await service.descartarAlertaDetenida(5, 1, 9);

    const data = (otUpdate.mock.calls.at(-1)![0] as any).data;
    expect(data.alerta_detenida_descartada_por).toBe(9);
    expect(data.alerta_detenida_descartada_en).toBeInstanceOf(Date);
    // Descartar no toca la OT: ni su estado ni su prioridad.
    expect(Object.keys(data).sort()).toEqual([
      'alerta_detenida_descartada_en',
      'alerta_detenida_descartada_por',
    ]);

    const horas = (r.reaparece_en.getTime() - r.descartada_en.getTime()) / 3600_000;
    expect(horas).toBe(48);
  });

  it('no deja descartar la alerta de una OT que no esta detenida', async () => {
    otFindFirst.mockResolvedValue({ id_ot: 6, estado: 'COMPLETADA' });

    await expect(service.descartarAlertaDetenida(6, 1, 9)).rejects.toThrow(
      /ASIGNADA o EN_CURSO/,
    );
    expect(otUpdate).not.toHaveBeenCalled();
  });

  it('no deja descartar una OT de otra empresa', async () => {
    otFindFirst.mockResolvedValue(null);

    await expect(service.descartarAlertaDetenida(6, 99, 9)).rejects.toThrow(/no encontrada/i);
    expect((otFindFirst.mock.calls.at(-1)![0] as any).where.id_empresa).toBe(99);
  });
});
