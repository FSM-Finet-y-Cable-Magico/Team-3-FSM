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
import { ClaveWifiService } from './clave-wifi.service.js';
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

  let filas: Fila[];
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

    const mod = await Test.createTestingModule({
      providers: [
        ClaveWifiService,
        {
          provide: PrismaService,
          useValue: { solicitud_clave_wifi: { findUnique, create, update } },
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
    const entregada = await service.entregar(r.id_solicitud, 1);
    expect(entregada.clave).toBe('clave-del-cliente-123');
  });

  it('la segunda lectura se niega', async () => {
    const r = await service.recibir(dto(), scope);
    await service.entregar(r.id_solicitud, 1);

    await expect(service.entregar(r.id_solicitud, 1)).rejects.toThrow(
      ConflictException,
    );
  });

  it('no entrega una solicitud de otra empresa', async () => {
    const r = await service.recibir(dto({ id_empresa: 2 }), scope);
    // Empresa 1 pidiendo una de la 2: mismo 404 que si no existiera, para no
    // revelar que solicitudes tiene la otra empresa.
    await expect(service.entregar(r.id_solicitud, 1)).rejects.toThrow(
      'Solicitud no encontrada',
    );
  });
});
