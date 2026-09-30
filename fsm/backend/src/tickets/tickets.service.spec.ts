import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * CU-29, CU-30 y CU-32.
 *
 * El aislamiento por empresa, las transiciones invalidas y la auditoria de la
 * reclasificacion son el minimo que pide el paso 7 del track. Lo demas cubre
 * las decisiones que se tomaron al escribir el modulo y que no se ven en la
 * firma de los metodos.
 */
describe('tickets', () => {
  const EMPRESA = 1;
  const USUARIO = 3;

  const CATEGORIAS = [
    { id_categoria: 4, nombre: 'Falla de planta externa', sla_horas: 2 },
    { id_categoria: 8, nombre: 'Falla de internet', sla_horas: 24 },
  ];

  const base = {
    id_empresa: EMPRESA,
    id_cliente: 5,
    id_usuario_asignado: null as number | null,
    id_categoria: 8,
    codigo_seguimiento: 'TK-202609-AAAAA',
    prioridad: 'MEDIA',
    estado: 'ABIERTO',
    descripcion: 'Sin internet desde ayer',
    origen: 'TELEFONO',
    resuelto_remotamente: false,
    fecha_creacion: new Date('2026-09-29T10:00:00.000Z'),
    fecha_cierre: null as Date | null,
    cliente: { id_cliente: 5, rut: '11111111-1', nombre_completo: 'Ana Soto', telefono: null },
    usuario_asignado: null,
    categoria: CATEGORIAS[1],
    orden_trabajo: null,
  };

  let tabla: any[];
  let create: any;
  let update: any;
  let auditoria: any;
  let usuariosActivos: number[];
  let service: TicketsService;

  beforeEach(async () => {
    jest.restoreAllMocks();
    usuariosActivos = [3, 9];
    tabla = [
      { ...base, id_ticket: 1 },
      { ...base, id_ticket: 2, estado: 'EN_ATENCION', id_usuario_asignado: 9 },
      { ...base, id_ticket: 3, estado: 'CERRADO', fecha_cierre: new Date('2026-09-29T12:00:00.000Z') },
      // Fila antigua, escrita antes del modulo, con la caja inconsistente.
      { ...base, id_ticket: 4, estado: 'Abierto', prioridad: 'media', origen: 'telefono' },
      { ...base, id_ticket: 90, id_empresa: 2 },
    ];
    create = jest.fn(async ({ data }: any) => ({ ...base, ...data, id_ticket: 77, categoria: CATEGORIAS[1] }));
    update = jest.fn(async ({ where, data }: any) => {
      const fila = tabla.find((t) => t.id_ticket === where.id_ticket)!;
      Object.assign(fila, data);
      if (data.id_categoria) fila.categoria = CATEGORIAS.find((c) => c.id_categoria === data.id_categoria);
      return fila;
    });
    auditoria = jest.fn(async () => ({}));

    const prisma: any = {
      ticket: {
        findFirst: jest.fn(async ({ where }: any) =>
          tabla.find((t) => t.id_ticket === where.id_ticket && t.id_empresa === where.id_empresa) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          tabla.filter((t) => t.id_empresa === where.id_empresa),
        ),
        count: jest.fn(async ({ where }: any) => tabla.filter((t) => t.id_empresa === where.id_empresa).length),
        create,
        update,
      },
      categoria_falla: {
        findUnique: jest.fn(async ({ where }: any) =>
          CATEGORIAS.find((c) => c.id_categoria === where.id_categoria) ?? null,
        ),
      },
      cliente: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id_cliente === 5 && where.id_empresa === EMPRESA ? { id_cliente: 5 } : null,
        ),
      },
      usuario: {
        findFirst: jest.fn(async ({ where }: any) =>
          usuariosActivos.includes(where.id_usuario) && where.id_empresa === EMPRESA
            ? { id_usuario: where.id_usuario }
            : null,
        ),
      },
      log_auditoria: { create: auditoria },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TicketsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TicketsService);
  });

  // ------------------------------------------------------------ aislamiento
  describe('aislamiento por empresa', () => {
    it('un ticket de otra empresa responde 404, no 403', async () => {
      // 403 le confirmaria al que pregunta que el ticket existe en otra parte.
      await expect(service.obtenerTicket(90, EMPRESA)).rejects.toThrow(NotFoundException);
    });

    it('gestionar un ticket ajeno tampoco lo alcanza', async () => {
      await expect(service.gestionar(90, { estado: 'CERRADO' }, USUARIO, EMPRESA)).rejects.toThrow(
        NotFoundException,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('reclasificar un ticket ajeno tampoco', async () => {
      await expect(
        service.reclasificar(90, { id_categoria: 4, motivo: 'motivo suficiente' }, USUARIO, EMPRESA),
      ).rejects.toThrow(NotFoundException);
    });

    it('el listado filtra por empresa', async () => {
      const r = await service.listarTickets(EMPRESA);

      expect(r.data.map((t) => t.id_ticket)).not.toContain(90);
    });
  });

  // -------------------------------------------------------------- CU-29
  describe('CU-29 · creación', () => {
    const dto = { id_categoria: 8, id_cliente: 5, descripcion: 'No tengo señal hace dos días' };

    it('nace ABIERTO y con codigo de seguimiento', async () => {
      const r = await service.crearTicket(dto, USUARIO, EMPRESA);

      expect(r.estado).toBe('ABIERTO');
      expect(r.codigo_seguimiento).toMatch(/^TK-\d{6}-[A-Z2-9]{5}$/);
    });

    it('asignar al crear NO lo pone en atencion', async () => {
      // Asignado y en curso son cosas distintas: quien lo recibe tiene que
      // tomarlo. Si no, el tablero no distingue lo repartido de lo trabajado.
      const r = await service.crearTicket({ ...dto, id_usuario_asignado: 9 }, USUARIO, EMPRESA);

      expect(r.estado).toBe('ABIERTO');
      expect(create.mock.calls[0][0].data.id_usuario_asignado).toBe(9);
    });

    it('usa MEDIA y TELEFONO cuando no se especifican', async () => {
      await service.crearTicket(dto, USUARIO, EMPRESA);

      expect(create.mock.calls[0][0].data).toMatchObject({ prioridad: 'MEDIA', origen: 'TELEFONO' });
    });

    it('acepta un ticket sin cliente', async () => {
      // Entra por telefono antes de saber quien llama. Exigir el cliente
      // obligaria al operador a identificarlo antes de poder anotar el caso.
      await expect(
        service.crearTicket({ id_categoria: 8, descripcion: 'Llamada anonima por corte' }, USUARIO, EMPRESA),
      ).resolves.toBeDefined();
    });

    it('rechaza una categoria que no existe', async () => {
      await expect(
        service.crearTicket({ ...dto, id_categoria: 999 }, USUARIO, EMPRESA),
      ).rejects.toThrow(NotFoundException);
      expect(create).not.toHaveBeenCalled();
    });

    it('rechaza un cliente de otra empresa', async () => {
      await expect(
        service.crearTicket({ ...dto, id_cliente: 777 }, USUARIO, EMPRESA),
      ).rejects.toThrow(NotFoundException);
    });

    it('no asigna a una cuenta desactivada', async () => {
      // Asignarle un ticket a una cuenta que CU-43 desactivó es mandarlo a un
      // buzón que nadie mira.
      usuariosActivos = [3];

      await expect(
        service.crearTicket({ ...dto, id_usuario_asignado: 9 }, USUARIO, EMPRESA),
      ).rejects.toThrow(NotFoundException);
    });

    it('reintenta con otro codigo si el primero ya existia', async () => {
      // `codigo_seguimiento` es @unique. Un choque es improbable, no imposible,
      // y sin esto seria un 500 imposible de reproducir.
      const choque = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['codigo_seguimiento'] },
      });
      create.mockRejectedValueOnce(choque);

      const r = await service.crearTicket(dto, USUARIO, EMPRESA);

      expect(create).toHaveBeenCalledTimes(2);
      const primero = create.mock.calls[0][0].data.codigo_seguimiento;
      const segundo = create.mock.calls[1][0].data.codigo_seguimiento;
      expect(segundo).not.toBe(primero);
      expect(r.codigo_seguimiento).toBe(segundo);
    });

    it('un error que NO es choque de codigo se propaga tal cual', async () => {
      // Si se tragara cualquier P2002, un choque de otra columna se veria como
      // "no se pudo generar el codigo" y mandaria a depurar al lugar equivocado.
      const otro = new Prisma.PrismaClientKnownRequestError('otra', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['id_conversacion_bot'] },
      });
      create.mockRejectedValueOnce(otro);

      await expect(service.crearTicket(dto, USUARIO, EMPRESA)).rejects.toThrow(otro);
    });

    it('se rinde tras varios choques seguidos en vez de girar para siempre', async () => {
      const choque = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'x',
        meta: { target: ['codigo_seguimiento'] },
      });
      create.mockRejectedValue(choque);

      await expect(service.crearTicket(dto, USUARIO, EMPRESA)).rejects.toThrow(ConflictException);
      expect(create).toHaveBeenCalledTimes(5);
    });

    it('deja rastro en auditoria', async () => {
      await service.crearTicket(dto, USUARIO, EMPRESA);

      expect(auditoria.mock.calls[0][0].data).toMatchObject({
        id_usuario: USUARIO,
        accion: 'CREAR_TICKET',
        entidad_afectada: 'ticket',
      });
    });
  });

  // -------------------------------------------------------------- CU-30
  describe('CU-30 · gestión', () => {
    it('ABIERTO -> EN_ATENCION es valido', async () => {
      const r = await service.gestionar(1, { estado: 'EN_ATENCION' }, USUARIO, EMPRESA);

      expect(r.estado).toBe('EN_ATENCION');
    });

    it('ABIERTO -> RESUELTO no lo es', async () => {
      // Saltarse la atencion dejaria tickets resueltos que nadie tomo nunca.
      await expect(service.gestionar(1, { estado: 'RESUELTO' }, USUARIO, EMPRESA)).rejects.toThrow(
        ConflictException,
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('el mensaje dice a donde SI se puede ir', async () => {
      await expect(service.gestionar(1, { estado: 'RESUELTO' }, USUARIO, EMPRESA)).rejects.toThrow(
        /EN_ATENCION/,
      );
    });

    it('cerrar sella fecha_cierre', async () => {
      const r = await service.gestionar(2, { estado: 'CERRADO' }, USUARIO, EMPRESA);

      expect(r.estado).toBe('CERRADO');
      expect(update.mock.calls[0][0].data.fecha_cierre).toBeInstanceOf(Date);
    });

    it('un ticket cerrado no admite ningun cambio', async () => {
      await expect(service.gestionar(3, { prioridad: 'ALTA' }, USUARIO, EMPRESA)).rejects.toThrow(
        ConflictException,
      );
    });

    it('desasignar con null explicito', async () => {
      await service.gestionar(2, { id_usuario_asignado: null }, USUARIO, EMPRESA);

      expect(update.mock.calls[0][0].data.id_usuario_asignado).toBeNull();
    });

    it('no asigna a una cuenta desactivada', async () => {
      usuariosActivos = [3];

      await expect(
        service.gestionar(1, { id_usuario_asignado: 9 }, USUARIO, EMPRESA),
      ).rejects.toThrow(NotFoundException);
    });

    it('la nota se agrega a la descripcion, no la reemplaza', async () => {
      await service.gestionar(1, { nota: 'El cliente confirma que volvió' }, USUARIO, EMPRESA);

      const nueva = update.mock.calls[0][0].data.descripcion as string;
      expect(nueva).toContain('Sin internet desde ayer');
      expect(nueva).toContain('El cliente confirma que volvió');
    });

    it('un cuerpo vacio responde 400 y no escribe', async () => {
      await expect(service.gestionar(1, {}, USUARIO, EMPRESA)).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('mandar el mismo estado que ya tiene no cuenta como cambio', async () => {
      await expect(service.gestionar(1, { estado: 'ABIERTO' }, USUARIO, EMPRESA)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('CU-56: marca la resolucion remota', async () => {
      await service.gestionar(2, { resuelto_remotamente: true }, USUARIO, EMPRESA);

      expect(update.mock.calls[0][0].data.resuelto_remotamente).toBe(true);
    });

    it('una fila antigua con la caja rara se gestiona igual', async () => {
      // El ticket 4 dice "Abierto". Si el estado actual no se normalizara, la
      // tabla de transiciones no lo encontraria y todo cambio daria conflicto.
      const r = await service.gestionar(4, { estado: 'EN_ATENCION' }, USUARIO, EMPRESA);

      expect(r.estado).toBe('EN_ATENCION');
    });

    it('audita el antes y el despues', async () => {
      await service.gestionar(1, { estado: 'EN_ATENCION' }, USUARIO, EMPRESA);

      expect(auditoria.mock.calls[0][0].data).toMatchObject({
        accion: 'GESTIONAR_TICKET',
        valor_anterior: expect.objectContaining({ estado: 'ABIERTO' }),
      });
    });
  });

  // -------------------------------------------------------------- CU-32
  describe('CU-32 · reclasificación', () => {
    const dto = { id_categoria: 4, motivo: 'Es un corte de fibra en la calle' };

    it('cambia la categoria', async () => {
      const r = await service.reclasificar(1, dto, USUARIO, EMPRESA);

      expect(r.categoria).toMatchObject({ id_categoria: 4 });
    });

    it('recalcula el SLA, que es derivado y no una columna', async () => {
      // De "Falla de internet" (24h) a "Falla de planta externa" (2h): el plazo
      // se mueve solo, sin reescribir nada.
      const antes = await service.obtenerTicket(1, EMPRESA);
      expect(antes.sla.horas).toBe(24);

      const despues = await service.reclasificar(1, dto, USUARIO, EMPRESA);
      expect(despues.sla.horas).toBe(2);
      expect(despues.sla.vence_en).toEqual(new Date('2026-09-29T12:00:00.000Z'));
    });

    it('audita la categoria anterior y la nueva CON su SLA', async () => {
      // El SLA se guarda ademas del id porque `categoria_falla.sla_horas` puede
      // editarse despues, y ahi el registro dejaria de poder reconstruirse.
      await service.reclasificar(1, dto, USUARIO, EMPRESA);

      expect(auditoria.mock.calls[0][0].data).toMatchObject({
        accion: 'RECLASIFICAR_TICKET',
        entidad_afectada: 'ticket',
        id_entidad_afectada: 1,
        valor_anterior: { id_categoria: 8, nombre: 'Falla de internet', sla_horas: 24 },
        valor_nuevo: {
          id_categoria: 4,
          nombre: 'Falla de planta externa',
          sla_horas: 2,
          motivo: dto.motivo,
        },
      });
    });

    it('un ticket cerrado no se reclasifica', async () => {
      // Cambiaria hacia atras si se cumplio o no el plazo comprometido.
      await expect(service.reclasificar(3, dto, USUARIO, EMPRESA)).rejects.toThrow(ConflictException);
      expect(update).not.toHaveBeenCalled();
    });

    it('reclasificar a la misma categoria responde conflicto', async () => {
      await expect(
        service.reclasificar(1, { id_categoria: 8, motivo: 'motivo suficiente' }, USUARIO, EMPRESA),
      ).rejects.toThrow(ConflictException);
      expect(auditoria).not.toHaveBeenCalled();
    });

    it('rechaza una categoria inexistente', async () => {
      await expect(
        service.reclasificar(1, { id_categoria: 999, motivo: 'motivo suficiente' }, USUARIO, EMPRESA),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- SLA
  describe('SLA derivado', () => {
    it('un ticket abierto dentro del plazo no está vencido', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-29T11:00:00.000Z').getTime());
      jest.useFakeTimers().setSystemTime(new Date('2026-09-29T11:00:00.000Z'));

      const r = await service.obtenerTicket(1, EMPRESA);
      expect(r.sla.vencido).toBe(false);

      jest.useRealTimers();
    });

    it('un ticket cerrado se mide contra su fecha_cierre, no contra el reloj', async () => {
      // Si se midiera contra ahora, todo ticket viejo apareceria vencido para
      // siempre y el indicador dejaria de significar algo.
      const r = await service.obtenerTicket(3, EMPRESA);

      // Cerrado a las 12:00, creado a las 10:00, SLA de 24h: cumplio.
      expect(r.sla.vencido).toBe(false);
      expect(r.fecha_cierre).toEqual(new Date('2026-09-29T12:00:00.000Z'));
    });
  });

  // ------------------------------------------------------------- listado
  describe('listado', () => {
    it('normaliza los vocabularios de las filas antiguas', async () => {
      const r = await service.listarTickets(EMPRESA);
      const antiguo = r.data.find((t) => t.id_ticket === 4)!;

      expect(antiguo).toMatchObject({ estado: 'ABIERTO', prioridad: 'MEDIA', origen: 'TELEFONO' });
    });

    it('rechaza un filtro de estado que no es del vocabulario', async () => {
      await expect(service.listarTickets(EMPRESA, 1, 20, { estado: 'PENDIENTE' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('el filtro de estado busca sin distinguir mayusculas', async () => {
      // Las filas antiguas dicen "Abierto"; sin esto no saldrian nunca.
      const prisma = (service as any).prisma;
      await service.listarTickets(EMPRESA, 1, 20, { estado: 'abierto' });

      expect(prisma.ticket.findMany.mock.calls[0][0].where.estado).toEqual({
        equals: 'ABIERTO',
        mode: 'insensitive',
      });
    });

    it('devuelve total, page y limit', async () => {
      const r = await service.listarTickets(EMPRESA, 1, 20);

      expect(r).toMatchObject({ page: 1, limit: 20 });
      expect(typeof r.total).toBe('number');
    });

    it('recorta un limite desmedido', async () => {
      const r = await service.listarTickets(EMPRESA, 1, 5000);

      expect(r.limit).toBe(100);
    });
  });
});
