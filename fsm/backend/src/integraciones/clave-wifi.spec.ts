// En ESM, Jest no inyecta los globals: hay que importarlos.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { generateKeyPairSync, publicEncrypt, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ClaveWifiService,
  MENSAJE_SIN_TICKET,
  MENSAJE_TOMAR_TICKET,
  MENSAJE_YA_LEIDA,
} from './clave-wifi.service.js';
import { RELLENO_OAEP } from './clave-wifi.crypto.js';
import type { SolicitudClaveWifiDto } from './dto/solicitud-clave-wifi.dto.js';

/**
 * El canal de clave WiFi del portal de G2 (acuerdo §6.4).
 *
 * Se cifra con un par de llaves de verdad, generado aca: un doble del
 * descifrado no probaria lo unico que importa de este flujo, que es que lo que
 * G2 cifra con nuestra publica lo podamos abrir con nuestra privada.
 */
describe('ClaveWifiService', () => {
  // 2048 y no 3072 como en produccion: generar el par es lo mas lento de esta
  // prueba y el tamaño no cambia lo que se verifica.
  const par = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publica = par.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const privada = par.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();

  const cifrar = (clave: string, pem = publica) =>
    publicEncrypt(
      { key: pem, ...RELLENO_OAEP },
      Buffer.from(clave, 'utf8'),
    ).toString('base64');

  const scope = { grupo: 'G2', empresas: [1, 2] };

  type Fila = {
    id_solicitud: number;
    request_id: string;
    huella: string;
    id_empresa: number;
    id_contrato: number;
    id_ticket: string;
    trace_id: string;
    clave_cifrada: string;
    leida_en: Date | null;
    estado: string;
    fecha_creacion: Date;
  };

  type TicketDoble = {
    id_ticket: number;
    id_empresa: number;
    codigo_seguimiento: string;
    estado: string;
    id_usuario_asignado: number | null;
  };

  /** Quien pide la clave: el usuario 10 de la empresa 1, que tomo el ticket 7. */
  const actor = { userId: 10, id_empresa: 1 };

  let filas: Fila[];
  let tickets: TicketDoble[];
  let auditoria: Record<string, unknown>[];
  let findUnique: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
  let create: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
  let update: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
  let service: ClaveWifiService;

  const dto = (
    over: Partial<SolicitudClaveWifiDto> = {},
  ): SolicitudClaveWifiDto => ({
    ciphertext: cifrar('clave-del-cliente-123'),
    id_ticket: 'TK-ABCDEFG',
    id_contrato: 55,
    id_empresa: 1,
    request_id: randomUUID(),
    trace_id: randomUUID(),
    ...over,
  });

  const montar = async (pem: string | null = privada) => {
    filas = [];
    let siguienteId = 1;

    type DondeUnico = { where: { request_id?: string; id_solicitud?: number } };
    type DatosCreate = Omit<
      Fila,
      'id_solicitud' | 'leida_en' | 'estado' | 'fecha_creacion'
    >;

    findUnique = jest.fn((args: unknown) => {
      const { where } = args as DondeUnico;
      return Promise.resolve(
        filas.find(
          (f) =>
            (where.request_id !== undefined &&
              f.request_id === where.request_id) ||
            (where.id_solicitud !== undefined &&
              f.id_solicitud === where.id_solicitud),
        ) ?? null,
      );
    });
    create = jest.fn((args: unknown) => {
      const { data } = args as { data: DatosCreate };
      const fila: Fila = {
        id_solicitud: siguienteId++,
        ...data,
        leida_en: null,
        estado: 'PENDIENTE',
        fecha_creacion: new Date('2026-09-30T12:00:00.000Z'),
      };
      filas.push(fila);
      return Promise.resolve(fila);
    });
    update = jest.fn((args: unknown) => {
      const { where, data } = args as {
        where: { id_solicitud: number };
        data: Partial<Fila>;
      };
      const fila = filas.find((f) => f.id_solicitud === where.id_solicitud);
      if (!fila) throw new Error('el doble no tiene esa fila');
      Object.assign(fila, data);
      return Promise.resolve(fila);
    });

    type DondeMuchos = {
      where: { id_empresa: number; id_ticket: { in: string[] } };
    };
    const findMany = jest.fn((args: unknown) => {
      const { where } = args as DondeMuchos;
      return Promise.resolve(
        filas.filter(
          (f) =>
            f.id_empresa === where.id_empresa &&
            where.id_ticket.in.includes(f.id_ticket),
        ),
      );
    });

    // Dos tickets nuestros, uno por empresa. G2 manda como `id_ticket` el id
    // numerico, pero se acepta tambien el codigo de seguimiento. El 7 esta
    // tomado por el usuario 10, que es el `actor` de las pruebas.
    tickets = [
      {
        id_ticket: 7,
        id_empresa: 1,
        codigo_seguimiento: 'TK-ABCDEFG',
        estado: 'EN_PROGRESO',
        id_usuario_asignado: 10,
      },
      {
        id_ticket: 8,
        id_empresa: 2,
        codigo_seguimiento: 'TK-OTRAEMP',
        estado: 'EN_PROGRESO',
        id_usuario_asignado: 10,
      },
    ];
    type Criterio = { id_ticket?: number; codigo_seguimiento?: string };
    const cumple = (t: TicketDoble, c: Criterio) =>
      (c.id_ticket === undefined || t.id_ticket === c.id_ticket) &&
      (c.codigo_seguimiento === undefined ||
        t.codigo_seguimiento === c.codigo_seguimiento);
    const ticketFindFirst = jest.fn((args: unknown) => {
      const { where } = args as {
        where: Criterio & { id_empresa: number; OR?: Criterio[] };
      };
      return Promise.resolve(
        tickets.find(
          (t) =>
            t.id_empresa === where.id_empresa &&
            cumple(t, where) &&
            (!where.OR || where.OR.some((c) => cumple(t, c))),
        ) ?? null,
      );
    });

    auditoria = [];
    const auditoriaCreate = jest.fn((args: unknown) => {
      auditoria.push((args as { data: Record<string, unknown> }).data);
      return Promise.resolve({});
    });
    const tx = {
      solicitud_clave_wifi: { update },
      log_auditoria: { create: auditoriaCreate },
    };

    const mod = await Test.createTestingModule({
      providers: [
        ClaveWifiService,
        {
          provide: PrismaService,
          useValue: {
            solicitud_clave_wifi: { findUnique, findMany, create, update },
            ticket: { findFirst: ticketFindFirst },
            $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
          },
        },
        { provide: ConfigService, useValue: { get: () => pem ?? undefined } },
      ],
    }).compile();
    service = mod.get(ClaveWifiService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await montar();
  });

  it('acepta la solicitud y guarda el ciphertext sin descifrarlo', async () => {
    const d = dto();
    const r = await service.recibir(d, scope);

    expect(r.duplicado).toBe(false);
    expect(r.estado).toBe('PENDIENTE');

    // Lo guardado es el ciphertext tal como llego. Si alguna vez se guardara el
    // claro, G8 podria leer la clave del cliente y se rompe el §6.5.
    const guardado = (create.mock.calls[0][0] as { data: Fila }).data
      .clave_cifrada;
    expect(guardado).toBe(d.ciphertext);
    expect(guardado).not.toContain('clave-del-cliente-123');
  });

  it('el reintento con el mismo request_id no vuelve a crear nada', async () => {
    const d = dto();
    const primera = await service.recibir(d, scope);
    create.mockClear();

    const segunda = await service.recibir(d, scope);

    expect(segunda.duplicado).toBe(true);
    expect(segunda.id_solicitud).toBe(primera.id_solicitud);
    expect(create).not.toHaveBeenCalled();
  });

  it('el mismo request_id con otro contenido es 409', async () => {
    const d = dto();
    await service.recibir(d, scope);

    // Mismo id, otra clave: ese request_id ya no identifica el mismo hecho.
    const otro = { ...d, ciphertext: cifrar('otra-clave-456') };
    await expect(service.recibir(otro, scope)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rechaza un ciphertext que no abre con nuestra llave', async () => {
    // Cifrado con la llave publica de otro: el padding calza pero el descifrado
    // falla. Hay que detectarlo al recibir, no cuando el tecnico la abra.
    const ajeno = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const conAjena = cifrar(
      'clave',
      ajeno.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    );

    await expect(
      service.recibir(dto({ ciphertext: conAjena }), scope),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('niega una empresa fuera del alcance de la clave de API', async () => {
    await expect(
      service.recibir(dto({ id_empresa: 9 }), scope),
    ).rejects.toThrow(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('sin llave privada responde 503 y no guarda', async () => {
    await montar(null);
    await expect(service.recibir(dto(), scope)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('entrega la clave en claro al tecnico', async () => {
    const r = await service.recibir(dto(), scope);
    const entregada = await service.entregar(r.id_solicitud, actor);
    expect(entregada.clave).toBe('clave-del-cliente-123');
  });

  it('la segunda lectura se niega', async () => {
    const r = await service.recibir(dto(), scope);
    await service.entregar(r.id_solicitud, actor);

    // El mensaje y no solo el 409: hay otros 409 (ticket sin tomar) que no son
    // este caso.
    await expect(service.entregar(r.id_solicitud, actor)).rejects.toThrow(
      MENSAJE_YA_LEIDA,
    );
  });

  describe('exige el ticket tomado', () => {
    it('niega la clave si el ticket sigue ABIERTO, y no gasta la lectura', async () => {
      tickets[0].estado = 'ABIERTO';
      tickets[0].id_usuario_asignado = null;
      const r = await service.recibir(dto(), scope);

      await expect(service.entregar(r.id_solicitud, actor)).rejects.toThrow(
        MENSAJE_TOMAR_TICKET,
      );
      expect(filas[0].leida_en).toBeNull();
      expect(auditoria).toEqual([]);
    });

    it('niega la clave si el ticket lo tomo otra persona', async () => {
      tickets[0].id_usuario_asignado = 99;
      const r = await service.recibir(dto(), scope);

      await expect(service.entregar(r.id_solicitud, actor)).rejects.toThrow(
        MENSAJE_TOMAR_TICKET,
      );
      expect(filas[0].leida_en).toBeNull();
    });

    it('niega la clave de una solicitud que no corresponde a ningun ticket', async () => {
      const r = await service.recibir(dto({ id_ticket: 'NO-EXISTE' }), scope);

      await expect(service.entregar(r.id_solicitud, actor)).rejects.toThrow(
        MENSAJE_SIN_TICKET,
      );
      expect(filas[0].leida_en).toBeNull();
    });

    it('encuentra el ticket por el id numerico, que es lo que manda G2', async () => {
      const r = await service.recibir(dto({ id_ticket: '7' }), scope);
      const entregada = await service.entregar(r.id_solicitud, actor);
      expect(entregada.clave).toBe('clave-del-cliente-123');
    });

    it('deja la entrega en el historial del ticket, con quien la vio', async () => {
      const r = await service.recibir(dto(), scope);
      await service.entregar(r.id_solicitud, actor);

      expect(auditoria).toEqual([
        {
          id_usuario: 10,
          accion: 'ENTREGAR_CLAVE_WIFI',
          entidad_afectada: 'ticket',
          id_entidad_afectada: 7,
          valor_nuevo: { id_solicitud: r.id_solicitud },
        },
      ]);
      // Nunca la clave: el historial lo ve cualquiera que abra el ticket.
      expect(JSON.stringify(auditoria)).not.toContain('clave-del-cliente');
    });
  });

  it('no entrega una solicitud de otra empresa', async () => {
    const r = await service.recibir(dto({ id_empresa: 2 }), scope);
    // Empresa 1 pidiendo una de la 2: mismo 404 que si no existiera, para no
    // revelar que solicitudes tiene la otra empresa.
    await expect(service.entregar(r.id_solicitud, actor)).rejects.toThrow(
      'Solicitud no encontrada',
    );
  });
  it('lee la llave con los saltos como \\n, que es como vive en el .env', async () => {
    // El .env no admite saltos de linea, asi que la llave se guarda en una sola
    // linea con los saltos como la secuencia de dos caracteres \\n. Si el
    // servicio no los devuelve a saltos reales, openssl no parsea el PEM y toda
    // solicitud termina en 503 -- con la llave bien configurada.
    //
    // Las demas pruebas inyectan el PEM con saltos reales, asi que esta rama no
    // se ejercitaba y el defecto pasaba entero.
    const comoEnEnv = privada.replace(/\n/g, '\\n');
    expect(comoEnEnv).not.toContain('\n');

    await montar(comoEnEnv);
    const r = await service.recibir(dto(), scope);
    const entregada = await service.entregar(r.id_solicitud, actor);

    expect(entregada.clave).toBe('clave-del-cliente-123');
  });

  describe('porTicket', () => {
    it('lista las solicitudes del ticket por codigo o por id, sin la clave', async () => {
      await service.recibir(dto({ id_ticket: 'TK-ABCDEFG' }), scope);
      await service.recibir(dto({ id_ticket: '7' }), scope);
      await service.recibir(dto({ id_ticket: 'TK-DE-OTRO' }), scope);

      const lista = await service.porTicket(7, 1);

      expect(lista).toHaveLength(2);
      for (const s of lista) {
        expect(s).not.toHaveProperty('clave_cifrada');
        expect(s).not.toHaveProperty('huella');
        expect(s.estado).toBe('PENDIENTE');
      }
    });

    it('muestra como entregada la que ya se leyo', async () => {
      const r = await service.recibir(dto(), scope);
      await service.entregar(r.id_solicitud, actor);

      const [s] = await service.porTicket(7, 1);

      expect(s.estado).toBe('ENTREGADA');
      expect(s.leida_en).toBeInstanceOf(Date);
    });

    it('no mezcla solicitudes de otra empresa con el mismo codigo', async () => {
      await service.recibir(dto({ id_empresa: 2 }), scope);
      expect(await service.porTicket(7, 1)).toEqual([]);
    });

    it('un ticket de otra empresa es 404, igual que uno que no existe', async () => {
      await expect(service.porTicket(8, 1)).rejects.toThrow(
        'Ticket no encontrado',
      );
      await expect(service.porTicket(999, 1)).rejects.toThrow(
        'Ticket no encontrado',
      );
    });
  });
});
