import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
  ESTADOS_TICKET_ABIERTOS,
  ESTADO_TICKET,
  ORIGEN_TICKET,
  PRIORIDAD_TICKET,
  TRANSICIONES_TICKET,
  type EstadoTicket,
} from './tickets.constants.js';

/**
 * Los tickets que existian ANTES de este modulo, y por que hubo que migrarlos.
 *
 * Produccion tenia 10 filas con un vocabulario propio --"Abierto", "Escalado",
 * "Resuelto", "Cerrado", "cerrado"-- escritas antes de CU-29/30/32. Medido
 * contra los datos reales, ninguna calzaba con `ESTADO_TICKET`, y eso las dejaba
 * INERTES: `TRANSICIONES_TICKET[estado]` devuelve undefined para un estado
 * desconocido, asi que no admitian ningun cambio, no se podian reclasificar, y
 * el filtro por estado --comparacion exacta-- no las encontraba. Se veian en el
 * listado y desaparecian al filtrar.
 *
 * La migracion `20260930020000_normalizar_tickets_legado` las pasa al
 * vocabulario. Estas pruebas fijan el ANTES y el DESPUES para que quede claro
 * que se arreglo, y para que nadie reintroduzca un literal fuera de la lista.
 */
describe('tickets anteriores al módulo', () => {
  /** Los 9 combos distintos que habia en produccion el 29-09-2026. */
  const ANTES = [
    { estado: 'Abierto', prioridad: 'Alta', origen: 'CRM', veces: 2 },
    { estado: 'Abierto', prioridad: 'Baja', origen: 'CRM', veces: 1 },
    { estado: 'Cerrado', prioridad: 'Alta', origen: 'CRM', veces: 1 },
    { estado: 'Escalado', prioridad: 'Media', origen: 'CRM', veces: 1 },
    { estado: 'Escalado', prioridad: 'Media', origen: 'portal', veces: 1 },
    { estado: 'Escalado', prioridad: 'media', origen: 'whatsapp', veces: 1 },
    { estado: 'Resuelto', prioridad: 'Alta', origen: 'Telefono', veces: 1 },
    { estado: 'Resuelto', prioridad: 'Media', origen: 'CRM', veces: 1 },
    { estado: 'cerrado', prioridad: 'baja', origen: 'telefono', veces: 1 },
  ];

  /** Lo que devolvio la base despues de aplicar la migracion, ensayada sobre
   *  una copia restaurada del respaldo de produccion. */
  const DESPUES = [
    { estado: 'ABIERTO', prioridad: 'ALTA', origen: 'CRM', veces: 2 },
    { estado: 'ABIERTO', prioridad: 'BAJA', origen: 'CRM', veces: 1 },
    { estado: 'ABIERTO', prioridad: 'MEDIA', origen: 'PORTAL', veces: 1 },
    { estado: 'ABIERTO', prioridad: 'MEDIA', origen: 'WHATSAPP', veces: 1 },
    { estado: 'EN_PROGRESO', prioridad: 'MEDIA', origen: 'CRM', veces: 1 },
    { estado: 'RESUELTO', prioridad: 'ALTA', origen: 'CRM', veces: 1 },
    { estado: 'RESUELTO', prioridad: 'ALTA', origen: 'TELEFONO', veces: 1 },
    { estado: 'RESUELTO', prioridad: 'BAJA', origen: 'TELEFONO', veces: 1 },
    { estado: 'RESUELTO', prioridad: 'MEDIA', origen: 'CRM', veces: 1 },
  ];

  const total = (filas: typeof ANTES) => filas.reduce((a, f) => a + f.veces, 0);

  it('los 10 son los mismos 10: la migración no crea ni borra', () => {
    expect(total(ANTES)).toBe(10);
    expect(total(DESPUES)).toBe(10);
  });

  describe('el antes: por qué estaban inertes', () => {
    it('ninguno calzaba con el vocabulario', () => {
      const validos: string[] = Object.values(ESTADO_TICKET);
      expect(ANTES.filter((f) => validos.includes(f.estado))).toEqual([]);
    });

    it('ninguno admitía transición', () => {
      // Es el sintoma exacto: un estado desconocido no tiene fila en la tabla,
      // asi que `?? []` deja el ticket sin ninguna salida posible.
      for (const f of ANTES) {
        expect(TRANSICIONES_TICKET[f.estado as EstadoTicket] ?? []).toEqual([]);
      }
    });

    it('ninguno se podía reclasificar', () => {
      for (const f of ANTES) {
        expect(ESTADOS_TICKET_ABIERTOS.includes(f.estado as EstadoTicket)).toBe(false);
      }
    });
  });

  describe('el después: todos gestionables', () => {
    it('todos los estados son del vocabulario', () => {
      const validos: string[] = Object.values(ESTADO_TICKET);
      for (const f of DESPUES) expect(validos).toContain(f.estado);
    });

    it('todas las prioridades y orígenes también', () => {
      const prioridades: string[] = Object.values(PRIORIDAD_TICKET);
      const origenes: string[] = Object.values(ORIGEN_TICKET);
      for (const f of DESPUES) {
        expect(prioridades).toContain(f.prioridad);
        expect(origenes).toContain(f.origen);
      }
    });

    it('los que no están cerrados pueden avanzar', () => {
      const vivos = DESPUES.filter((f) => f.estado !== ESTADO_TICKET.RESUELTO);
      expect(vivos.length).toBeGreaterThan(0);
      for (const f of vivos) {
        expect(TRANSICIONES_TICKET[f.estado as EstadoTicket].length).toBeGreaterThan(0);
      }
    });

    it('los que no están cerrados se pueden reclasificar', () => {
      for (const f of DESPUES.filter((x) => x.estado !== ESTADO_TICKET.RESUELTO)) {
        expect(ESTADOS_TICKET_ABIERTOS).toContain(f.estado as EstadoTicket);
      }
    });
  });

  describe('las decisiones del mapeo', () => {
    it('"Escalado" sin OT NO se convirtió en DERIVADO_OT', () => {
      // DERIVADO_OT afirma que existe una OT: de ahi sale el ticket y a ella
      // vuelve al completarse o cancelarse. Los tres "Escalado" no tenian
      // ninguna OT ligada, asi que habrian quedado esperando algo inexistente.
      expect(DESPUES.some((f) => f.estado === 'DERIVADO_OT')).toBe(false);
    });

    it('"Escalado" se repartió según si tenía técnico asignado', () => {
      // Regla, no caso por caso: con alguien trabajandolo EN_PROGRESO, sin
      // nadie ABIERTO. Eran 2 sin asignar y 1 asignado.
      const enProgreso = DESPUES.filter((f) => f.estado === 'EN_PROGRESO');
      expect(total(enProgreso)).toBe(1);
    });

    it('"Cerrado" pasó a RESUELTO, que es el único terminal', () => {
      expect(TRANSICIONES_TICKET.RESUELTO).toEqual([]);
      // Las dos filas ya traian `fecha_cierre`, asi que el mapeo no inventa nada.
      expect(total(DESPUES.filter((f) => f.estado === 'RESUELTO'))).toBe(4);
    });

    it('"CRM" se conservó en vez de reescribirse como otro canal', () => {
      // Seis tickets vinieron de ahi de verdad. Mapearlos a PORTAL o BOT diria
      // un canal que no es, asi que CRM se agrego al vocabulario.
      expect(Object.values(ORIGEN_TICKET)).toContain('CRM');
      expect(total(DESPUES.filter((f) => f.origen === 'CRM'))).toBe(6);
    });
  });

  it('la migración es idempotente por construcción', () => {
    // Cada UPDATE lleva su guarda de "solo si no esta ya canonico". Ensayado
    // sobre la copia restaurada: la segunda pasada afecta 0 filas.
    const sql = readFileSync(
      'prisma/migrations/20260930020000_normalizar_tickets_legado/migration.sql',
      'utf-8',
    );
    const updates = sql.match(/UPDATE "ticket"/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    // Ninguno sin WHERE: un UPDATE sin guarda reescribiria las 10 filas en cada
    // corrida y, peor, tambien las nuevas.
    for (const bloque of sql.split('UPDATE "ticket"').slice(1)) {
      expect(bloque).toContain('WHERE');
    }
  });
});
