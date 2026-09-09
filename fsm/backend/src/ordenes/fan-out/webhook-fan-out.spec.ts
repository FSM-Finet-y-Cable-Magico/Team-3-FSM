import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { WebhookFanOut } from './webhook-fan-out.js';
import type { PayloadCierre } from './fan-out-cierre.js';

/**
 * Lectura de la respuesta de G1 al avisarle un cierre.
 *
 * Los cuerpos de estas pruebas son los que Javier mando el 8-sept-2026, tal
 * cual. Importan porque un 200 NO significa que todo salio bien: G1 puede
 * responder `PROCESADO_CON_DISCREPANCIAS` --una serie que su inventario no
 * reconoce, por ejemplo-- y antes eso se registraba como "OK" y no lo veia
 * nadie.
 */
describe('fan-out del cierre · respuesta de G1', () => {
  let fanOut: WebhookFanOut;
  let log: string[];
  let warn: string[];

  const payload = { id_ot: 1042, clave_idempotencia: '1042:x' } as unknown as PayloadCierre;

  const responder = (body: unknown, status = 200) => {
    global.fetch = jest.fn(async () => ({
      ok: status < 400,
      status,
      json: async () => body,
    })) as unknown as typeof fetch;
  };

  beforeEach(() => {
    log = [];
    warn = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { log.push(String(m)); });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => { warn.push(String(m)); });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    fanOut = new WebhookFanOut([{ nombre: 'G1', url: 'http://g1/cierre', apiKey: 'k' }]);
  });

  it('un cierre sin discrepancias se registra como procesado', async () => {
    responder({
      success: true,
      data: {
        duplicado: false,
        id_ot: 1042,
        clave_idempotencia: '1042:2026-09-04T18:22:41.113Z',
        estado_proceso: 'PROCESADO',
        acciones_aplicadas: {
          numero_serie: 'ONT-A1B2C3',
          accion: 'RETIRADO_PARA_DIAGNOSTICO',
          estado_anterior: 'Asignado a técnico',
          estado_nuevo: 'En revisión',
        },
        discrepancias: [],
        materiales_pendientes_descuento: true,
      },
    });

    await fanOut.notificar(payload);

    expect(warn).toEqual([]);
    expect(log.join(' ')).toContain('PROCESADO');
  });

  it('una discrepancia se registra como advertencia, no como exito', async () => {
    // Es lo unico de todo el fan-out que pide que alguien mire: una serie que
    // el inventario de G1 no reconoce hay que corregirla a mano.
    responder({
      success: true,
      data: {
        duplicado: false,
        id_ot: 1042,
        estado_proceso: 'PROCESADO_CON_DISCREPANCIAS',
        acciones_aplicadas: { numero_serie: 'ONT-A1B2C3', accion: 'RETIRADO_PARA_DIAGNOSTICO' },
        discrepancias: {
          numero_serie: 'NO-EXISTE-X9',
          accion: 'INSTALADO_EN_CLIENTE',
          codigo: 'SERIE_NO_EXISTE',
          detalle: 'La serie no existe en la empresa 1. Revisar manualmente.',
        },
        materiales_pendientes_descuento: true,
      },
    });

    await fanOut.notificar(payload);

    expect(warn).toHaveLength(1);
    expect(warn[0]).toContain('PROCESADO_CON_DISCREPANCIAS');
    expect(warn[0]).toContain('SERIE_NO_EXISTE');
    expect(warn[0]).toContain('NO-EXISTE-X9');
  });

  it('acepta que `discrepancias` venga como objeto o como arreglo', async () => {
    // G1 manda un objeto cuando hay una y un arreglo vacio cuando no hay
    // ninguna. Tratar el objeto como arreglo daria longitud undefined y la
    // discrepancia pasaria inadvertida.
    responder({ success: true, data: { estado_proceso: 'PROCESADO', discrepancias: [] } });
    await fanOut.notificar(payload);
    expect(warn).toEqual([]);

    warn.length = 0;
    responder({ success: true, data: { estado_proceso: 'X', discrepancias: { codigo: 'A' } } });
    await fanOut.notificar(payload);
    expect(warn).toHaveLength(1);
  });

  it('registra el SRV cuando G1 empiece a devolverlo', async () => {
    // Todavia no viene: se genera con su CU-64. Cuando aparezca, queda en el
    // log sin que haya que tocar nada.
    responder({ success: true, data: { estado_proceso: 'PROCESADO', discrepancias: [], srv: 'SRV-2026-00042' } });

    await fanOut.notificar(payload);

    expect(log.join(' ')).toContain('SRV-2026-00042');
  });

  it('un cuerpo que no se entiende no convierte el cierre en un error', async () => {
    // El cierre ya esta guardado; el fan-out es best-effort. Fallar por el
    // formato de una respuesta seria peor que no leerla.
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error('no es JSON'); },
    })) as unknown as typeof fetch;

    await expect(fanOut.notificar(payload)).resolves.toBeUndefined();
    expect(warn).toEqual([]);
  });
});

/**
 * G1 recibe el cierre en `POST /api/integraciones/ordenes/{id_ot}/cierre`
 * (confirmado por Javier el 9-sept-2026): el numero de la OT va en la RUTA, no
 * solo en el cuerpo.
 *
 * Antes se hacia `fetch(destino.url)` con la URL tal cual salia de la variable
 * de entorno, asi que la configuracion que nos paso G1 se habria mandado
 * literal y todos los cierres habrian ido a una ruta con llaves.
 */
describe('fan-out del cierre · la URL del destino', () => {
  let fetchDoble: jest.Mock<(...a: any[]) => Promise<Response>>;

  const payload = (id_ot: number) =>
    ({ id_ot, clave_idempotencia: `${id_ot}:x` }) as unknown as PayloadCierre;

  const urlLlamada = (i = 0) => String(fetchDoble.mock.calls[i][0]);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    fetchDoble = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { estado_proceso: 'PROCESADO' } }),
    }) as unknown as Response);
    global.fetch = fetchDoble as unknown as typeof fetch;
  });

  it('reemplaza {id_ot} por la OT de este cierre', async () => {
    const fanOut = new WebhookFanOut([
      { nombre: 'G1', url: 'https://g1.example/api/integraciones/ordenes/{id_ot}/cierre' },
    ]);

    await fanOut.notificar(payload(19));

    expect(urlLlamada()).toBe('https://g1.example/api/integraciones/ordenes/19/cierre');
  });

  it('cada cierre va a su propia ruta, no todos a la misma', async () => {
    const fanOut = new WebhookFanOut([
      { nombre: 'G1', url: 'https://g1.example/ordenes/{id_ot}/cierre' },
    ]);

    await fanOut.notificar(payload(7));
    await fanOut.notificar(payload(8));

    expect([urlLlamada(0), urlLlamada(1)]).toEqual([
      'https://g1.example/ordenes/7/cierre',
      'https://g1.example/ordenes/8/cierre',
    ]);
  });

  it('una URL sin el marcador se usa tal cual', async () => {
    // Es como quedo G8: recibe el cierre en una ruta fija.
    const fanOut = new WebhookFanOut([{ nombre: 'G8', url: 'https://g8.example/cierres' }]);

    await fanOut.notificar(payload(19));

    expect(urlLlamada()).toBe('https://g8.example/cierres');
  });

  it('cada destino resuelve su propia URL', async () => {
    const fanOut = new WebhookFanOut([
      { nombre: 'G1', url: 'https://g1.example/ordenes/{id_ot}/cierre' },
      { nombre: 'G8', url: 'https://g8.example/cierres' },
    ]);

    await fanOut.notificar(payload(19));

    expect([urlLlamada(0), urlLlamada(1)].sort()).toEqual([
      'https://g1.example/ordenes/19/cierre',
      'https://g8.example/cierres',
    ]);
  });

  it('manda la API key en X-API-KEY', async () => {
    const fanOut = new WebhookFanOut([
      { nombre: 'G1', url: 'https://g1.example/ordenes/{id_ot}/cierre', apiKey: 'clave-secreta' },
    ]);

    await fanOut.notificar(payload(19));

    const init = fetchDoble.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('clave-secreta');
    expect(init.method).toBe('POST');
  });
});
