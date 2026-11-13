import { describe, expect, it, jest } from '@jest/globals';
import { BajasService, ESTADOS_CANCELABLES } from './bajas.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ApiScope } from '../common/guards/api-key.guard.js';
import type { SolicitudBajaDto } from './dto/solicitud-baja.dto.js';

/**
 * Contrato del retiro por morosidad que G8 pide por
 * `POST /integraciones/ordenes-baja` (acuerdo del 12-11-2026).
 *
 * Se prueba contra un doble de Prisma y no contra la base porque lo que importa
 * aca son las decisiones --a quien se rechaza, con que codigo y que se guarda--,
 * no el SQL.
 */

const SCOPE: ApiScope = { grupo: 'G8', empresas: [1] };

const dto = (over: Partial<SolicitudBajaDto> = {}): SolicitudBajaDto =>
  ({
    request_id: 'g8-retiro-1-123',
    trace_id: '550e8400-e29b-41d4-a716-446655440000',
    id_empresa: 1,
    id_cliente_externo: 70,
    id_contrato_externo: 80,
    id_servicio_externo: 90001,
    id_solicitud_retiro_externa: 123,
    id_ticket_externo: 44,
    rut_cliente: '11111111-1',
    direccion_retiro: 'Av. Matta 123',
    comuna_retiro: 'Ñuñoa',
    ...over,
  }) as SolicitudBajaDto;

/** Prisma de mentira: solo lo que toca el servicio. */
function prismaFalso(opciones: {
  solicitudPrevia?: unknown;
  cliente?: unknown;
  otActiva?: unknown;
  ontsCliente?: { id_caja_nap: number | null }[];
  puertoCliente?: { id_caja_nap: number | null } | null;
} = {}) {
  const creado: Record<string, unknown[]> = { ot: [], solicitud: [], historial: [], auditoria: [] };
  const tx = {
    orden_trabajo: {
      create: jest.fn(async ({ data }: any) => {
        creado.ot.push(data);
        return { id_ot: 900, tipo_ot: data.tipo_ot, estado: data.estado, fecha_creacion: new Date('2026-11-12T12:00:00Z') };
      }),
      update: jest.fn(async ({ data }: any) => data),
    },
    historial_ot: { create: jest.fn(async ({ data }: any) => void creado.historial.push(data)) },
    log_auditoria: { create: jest.fn(async ({ data }: any) => void creado.auditoria.push(data)) },
    solicitud_baja_integracion: {
      create: jest.fn(async ({ data }: any) => void creado.solicitud.push(data)),
      update: jest.fn(async ({ data }: any) => data),
    },
  };
  const prisma = {
    solicitud_baja_integracion: {
      findUnique: jest.fn(async () => opciones.solicitudPrevia ?? null),
      update: tx.solicitud_baja_integracion.update,
    },
    cliente: {
      findFirst: jest.fn(async () =>
        opciones.cliente === undefined
          ? { id_cliente: 55, direcciones: [{ id_direccion: 7, comuna: 'ÑUÑOA' }] }
          : opciones.cliente,
      ),
    },
    orden_trabajo: { findFirst: jest.fn(async () => opciones.otActiva ?? null) },
    registro_ont: { findMany: jest.fn(async () => opciones.ontsCliente ?? []) },
    puerto_nap: { findFirst: jest.fn(async () => opciones.puertoCliente ?? null) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { prisma: prisma as unknown as PrismaService, creado, tx };
}

describe('POST /integraciones/ordenes-baja', () => {
  it('crea la OT de BAJA en PENDIENTE y guarda los identificadores de G8', async () => {
    const { prisma, creado } = prismaFalso();
    const r = await new BajasService(prisma).crear(SCOPE, dto());

    expect(r.creado).toBe(true);
    expect(creado.ot[0]).toMatchObject({ tipo_ot: 'BAJA', estado: 'PENDIENTE', id_cliente: 55, id_direccion: 7 });
    // Son los que G8 necesita de vuelta para cerrar su solicitud; si no se
    // guardan, el aviso de cierre llega y G8 no sabe a que servicio corresponde.
    expect(creado.solicitud[0]).toMatchObject({
      request_id: 'g8-retiro-1-123',
      id_servicio_externo: 90001,
      id_solicitud_retiro_externa: 123,
      id_ticket_externo: 44,
      id_ot: 900,
      estado: 'OT_CREADA',
    });
  });

  it('la comuna se compara sin tildes ni mayusculas', async () => {
    // El cliente la tiene como "ÑUÑOA" y G8 la manda como "Ñuñoa". Rechazar por
    // eso seria inventar un problema: la prueba existe para que nadie "arregle"
    // la comparacion volviendola estricta.
    const { prisma } = prismaFalso();
    await expect(new BajasService(prisma).crear(SCOPE, dto({ comuna_retiro: 'nunoa' }))).resolves.toMatchObject({
      creado: true,
    });
  });

  it('rechaza una comuna distinta con DIRECCION_INVALIDA', async () => {
    const { prisma } = prismaFalso();
    await expect(new BajasService(prisma).crear(SCOPE, dto({ comuna_retiro: 'Maipú' }))).rejects.toMatchObject({
      response: { codigo: 'DIRECCION_INVALIDA' },
      status: 422,
    });
  });

  it('rechaza un cliente que no existe con CLIENTE_NO_ENCONTRADO', async () => {
    const { prisma } = prismaFalso({ cliente: null });
    await expect(new BajasService(prisma).crear(SCOPE, dto())).rejects.toMatchObject({
      response: { codigo: 'CLIENTE_NO_ENCONTRADO' },
      status: 404,
    });
  });

  it('rechaza una segunda baja del mismo cliente con OT_BAJA_ACTIVA y devuelve la vigente', async () => {
    const { prisma } = prismaFalso({ otActiva: { id_ot: 777, estado: 'EN_CURSO' } });
    await expect(new BajasService(prisma).crear(SCOPE, dto())).rejects.toMatchObject({
      response: { codigo: 'OT_BAJA_ACTIVA', id_ot: 777 },
      status: 409,
    });
  });

  it('un reintento con el mismo contenido devuelve la OT original sin crear otra', async () => {
    const { prisma, creado } = prismaFalso();
    const svc = new BajasService(prisma);
    const payload = dto();
    // Primero se calcula el hash tal como lo hace el servicio, para simular la
    // fila que dejo el primer intento.
    const { hashSolicitud } = await import('./instalaciones.service.js');
    const previa = {
      request_id: payload.request_id,
      hash_payload: hashSolicitud(payload),
      id_ot: 900,
      orden_trabajo: { estado: 'ASIGNADA' },
      id_empresa: 1,
    };
    const conPrevia = prismaFalso({ solicitudPrevia: previa });
    const r = await new BajasService(conPrevia.prisma).crear(SCOPE, payload);

    expect(r).toMatchObject({ creado: false, data: { duplicado: true, id_ot: 900, estado: 'ASIGNADA' } });
    expect(conPrevia.creado.ot).toHaveLength(0);
    // El primer servicio no se uso; la asercion evita un falso positivo si
    // alguien cambia el doble de arriba.
    expect(creado.ot).toHaveLength(0);
    expect(svc).toBeDefined();
  });

  it('el mismo request_id con otro contenido es 409', async () => {
    const payload = dto();
    const previa = {
      request_id: payload.request_id,
      hash_payload: 'otro-hash-distinto',
      id_ot: 900,
      orden_trabajo: { estado: 'PENDIENTE' },
      id_empresa: 1,
    };
    const { prisma } = prismaFalso({ solicitudPrevia: previa });
    await expect(new BajasService(prisma).crear(SCOPE, payload)).rejects.toMatchObject({
      response: { codigo: 'REQUEST_ID_CON_OTRO_CONTENIDO' },
      status: 409,
    });
  });

  it('rechaza un request_id cuya empresa no coincide con el cuerpo', async () => {
    // La clave se la queda G1 y con ella G8 busca su recepcion: si declara otra
    // empresa, el flujo se rompe tres pasos despues y nadie lo relaciona.
    const { prisma } = prismaFalso();
    await expect(
      new BajasService(prisma).crear(SCOPE, dto({ request_id: 'g8-retiro-2-123' })),
    ).rejects.toMatchObject({ response: { codigo: 'REQUEST_ID_INCONSISTENTE' }, status: 400 });
  });

  it('una API key que no es de G8 no puede pedir retiros', async () => {
    const { prisma } = prismaFalso();
    await expect(
      new BajasService(prisma).crear({ grupo: 'G1', empresas: [1] }, dto()),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('una API key de G8 sin la empresa en el scope recibe 403', async () => {
    const { prisma } = prismaFalso();
    await expect(
      new BajasService(prisma).crear({ grupo: 'G8', empresas: [2] }, dto()),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('POST /integraciones/ordenes-baja/:request_id/cancelacion', () => {
  const solicitud = (estado: string | null) => ({
    request_id: 'g8-retiro-1-123',
    hash_payload: 'x',
    id_ot: estado === null ? null : 900,
    id_empresa: 1,
    orden_trabajo: estado === null ? null : { estado },
  });

  it.each(ESTADOS_CANCELABLES)('cancela una OT en %s', async (estado) => {
    const { prisma, tx } = prismaFalso({ solicitudPrevia: solicitud(estado) });
    const r = await new BajasService(prisma).cancelar(SCOPE, 'g8-retiro-1-123', { motivo: 'El cliente pago' });

    expect(r).toMatchObject({ id_ot: 900, estado: 'CANCELADA', duplicado: false });
    expect(tx.orden_trabajo.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'CANCELADA' }) }),
    );
  });

  it.each(['PENDIENTE_APROBACION', 'COMPLETADA'])(
    'NO cancela una OT en %s: los equipos ya salieron del domicilio',
    async (estado) => {
      const { prisma } = prismaFalso({ solicitudPrevia: solicitud(estado) });
      await expect(
        new BajasService(prisma).cancelar(SCOPE, 'g8-retiro-1-123', { motivo: 'El cliente pago' }),
      ).rejects.toMatchObject({ response: { codigo: 'CANCELACION_NO_APLICABLE', estado }, status: 409 });
    },
  );

  it('cancelar dos veces es idempotente, no un error', async () => {
    const { prisma, tx } = prismaFalso({ solicitudPrevia: solicitud('CANCELADA') });
    const r = await new BajasService(prisma).cancelar(SCOPE, 'g8-retiro-1-123', { motivo: 'El cliente pago' });

    expect(r).toMatchObject({ estado: 'CANCELADA', duplicado: true });
    expect(tx.orden_trabajo.update).not.toHaveBeenCalled();
  });

  it('un request_id desconocido es 404', async () => {
    const { prisma } = prismaFalso();
    await expect(
      new BajasService(prisma).cancelar(SCOPE, 'g8-retiro-1-999', { motivo: 'x' }),
    ).rejects.toMatchObject({ response: { codigo: 'SOLICITUD_NO_ENCONTRADA' }, status: 404 });
  });

  it('no se puede cancelar una solicitud de otra empresa', async () => {
    const { prisma } = prismaFalso({ solicitudPrevia: { ...solicitud('PENDIENTE'), id_empresa: 2 } });
    await expect(
      new BajasService(prisma).cancelar(SCOPE, 'g8-retiro-1-123', { motivo: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('la OT de retiro lleva la caja del cliente', () => {
  it('toma la caja mas frecuente de sus ONT', async () => {
    const { prisma, creado } = prismaFalso({ ontsCliente: [{ id_caja_nap: 30 }, { id_caja_nap: 12 }, { id_caja_nap: 12 }] });
    await new BajasService(prisma).crear(SCOPE, dto());
    expect(creado.ot[0]).toMatchObject({ id_caja_nap: 12 });
  });

  it('a falta de ONT, la de su puerto ocupado', async () => {
    const { prisma, creado } = prismaFalso({ puertoCliente: { id_caja_nap: 44 } });
    await new BajasService(prisma).crear(SCOPE, dto());
    expect(creado.ot[0]).toMatchObject({ id_caja_nap: 44 });
  });

  it('sin ninguna de las dos, queda en null como antes', async () => {
    const { prisma, creado } = prismaFalso();
    await new BajasService(prisma).crear(SCOPE, dto());
    expect(creado.ot[0]).toMatchObject({ id_caja_nap: null });
  });
});
