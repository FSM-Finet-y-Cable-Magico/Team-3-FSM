import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
  ESTADOS_ABIERTOS,
  ESTADO_TICKET,
  LARGO_COLUMNA,
  ORIGEN_TICKET,
  PRIORIDAD_TICKET,
  TRANSICIONES_TICKET,
  generarCodigoSeguimiento,
  normalizarEstado,
  normalizarOrigen,
  normalizarPrioridad,
} from './tickets.constants.js';

/**
 * D6 del plan: congelar los vocabularios de tickets.
 *
 * La prueba que importa es la primera. `EN_MANTENCION` tiene 13 caracteres y
 * `puerto_nap.estado` era VARCHAR(10), asi que uno de los tres estados que
 * pedia RF-17 no se podia guardar: el error aparecio en tiempo de ejecucion,
 * contra la base, y costo una migracion. Acá se caza al compilar.
 */
describe('D6 · vocabularios de tickets', () => {
  describe('cada literal entra en su columna', () => {
    it.each(Object.values(ESTADO_TICKET))('estado %s entra en VARCHAR(20)', (valor) => {
      expect(valor.length).toBeLessThanOrEqual(LARGO_COLUMNA.estado);
    });

    it.each(Object.values(PRIORIDAD_TICKET))('prioridad %s entra en VARCHAR(10)', (valor) => {
      expect(valor.length).toBeLessThanOrEqual(LARGO_COLUMNA.prioridad);
    });

    it.each(Object.values(ORIGEN_TICKET))('origen %s entra en VARCHAR(20)', (valor) => {
      expect(valor.length).toBeLessThanOrEqual(LARGO_COLUMNA.origen);
    });

    it('los largos declarados coinciden con el esquema', () => {
      // Se leen del schema en vez de repetirlos: si alguien ensancha o angosta
      // una columna y no toca estas constantes, la comparación de arriba
      // estaría midiendo contra un largo que ya no existe.
      const schema = readFileSync('prisma/schema.prisma', 'utf-8');
      const modelo = schema.slice(
        schema.indexOf('model ticket {'),
        schema.indexOf('model ticket {') + 1600,
      );
      const largoDe = (campo: string) =>
        Number(new RegExp(`${campo}\\s+String\\??\\s+.*VarChar\\((\\d+)\\)`).exec(modelo)?.[1]);

      expect(largoDe('estado')).toBe(LARGO_COLUMNA.estado);
      expect(largoDe('prioridad')).toBe(LARGO_COLUMNA.prioridad);
      expect(largoDe('origen')).toBe(LARGO_COLUMNA.origen);
      expect(largoDe('codigo_seguimiento')).toBe(LARGO_COLUMNA.codigo_seguimiento);
    });
  });

  describe('transiciones', () => {
    it('todo estado tiene su fila', () => {
      expect(Object.keys(TRANSICIONES_TICKET).sort()).toEqual(Object.values(ESTADO_TICKET).sort());
    });

    it('ningun destino es un estado inventado', () => {
      const validos = Object.values(ESTADO_TICKET);
      for (const destinos of Object.values(TRANSICIONES_TICKET)) {
        for (const d of destinos) expect(validos).toContain(d);
      }
    });

    it('ningun estado se transiciona a si mismo', () => {
      for (const [origen, destinos] of Object.entries(TRANSICIONES_TICKET)) {
        expect(destinos).not.toContain(origen);
      }
    });

    it('CERRADO es terminal', () => {
      // Un ticket cerrado tiene `fecha_cierre`. Reabrirlo dejaria esa fecha
      // mintiendo, asi que el camino es abrir uno nuevo.
      expect(TRANSICIONES_TICKET.CERRADO).toEqual([]);
    });

    it('desde cualquier estado vivo se puede llegar a CERRADO', () => {
      // Si algun estado no tuviera salida, los tickets que cayeran ahi
      // quedarian abiertos para siempre y nadie lo notaria hasta el reporte.
      for (const estado of ESTADOS_ABIERTOS) {
        expect(TRANSICIONES_TICKET[estado]).toContain('CERRADO');
      }
    });

    it('ESTADOS_ABIERTOS es todo menos los terminales', () => {
      const terminales = Object.values(ESTADO_TICKET).filter(
        (e) => TRANSICIONES_TICKET[e].length === 0,
      );
      expect(ESTADOS_ABIERTOS.sort()).toEqual(
        Object.values(ESTADO_TICKET).filter((e) => !terminales.includes(e)).sort(),
      );
    });
  });

  describe('normalizacion de los datos que ya existen', () => {
    // Estos son los 9 combos reales que hay hoy en produccion, escritos antes
    // de que existiera este modulo. Si alguno dejara de normalizar, esas filas
    // se volverian invisibles para los filtros del listado.
    it.each([
      ['cerrado', 'CERRADO'],
      ['Cerrado', 'CERRADO'],
      ['Resuelto', 'RESUELTO'],
      ['Escalado', 'ESCALADO'],
      ['Abierto', 'ABIERTO'],
    ])('estado %s -> %s', (crudo, esperado) => {
      expect(normalizarEstado(crudo)).toBe(esperado);
    });

    it.each([
      ['baja', 'BAJA'],
      ['Baja', 'BAJA'],
      ['media', 'MEDIA'],
      ['Media', 'MEDIA'],
      ['Alta', 'ALTA'],
    ])('prioridad %s -> %s', (crudo, esperado) => {
      expect(normalizarPrioridad(crudo)).toBe(esperado);
    });

    it.each([
      ['telefono', 'TELEFONO'],
      ['Telefono', 'TELEFONO'],
      ['whatsapp', 'WHATSAPP'],
      ['portal', 'PORTAL'],
      ['CRM', 'CRM'],
    ])('origen %s -> %s', (crudo, esperado) => {
      expect(normalizarOrigen(crudo)).toBe(esperado);
    });

    it('tolera espacios y guiones', () => {
      expect(normalizarEstado('  en atencion ')).toBe('EN_ATENCION');
      expect(normalizarEstado('en-atencion')).toBe('EN_ATENCION');
    });

    it('devuelve null ante algo que no es del vocabulario', () => {
      // `null` y no una excepcion: quien llama decide si rechazar --si viene
      // del usuario-- o mostrar el crudo --si es una fila antigua--.
      expect(normalizarEstado('PENDIENTE')).toBeNull();
      expect(normalizarEstado(42)).toBeNull();
      expect(normalizarEstado(undefined)).toBeNull();
    });
  });

  describe('codigo de seguimiento', () => {
    it('tiene la forma TK-AAAAMM-XXXXX y entra en VARCHAR(20)', () => {
      const codigo = generarCodigoSeguimiento(new Date('2026-09-29T12:00:00Z'));

      expect(codigo).toMatch(/^TK-202609-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
      expect(codigo.length).toBeLessThanOrEqual(LARGO_COLUMNA.codigo_seguimiento);
    });

    it('no usa caracteres que se confunden al dictarlo', () => {
      // La mayoria de los tickets entran por telefono y el codigo se dicta.
      const muchos = Array.from({ length: 300 }, () => generarCodigoSeguimiento()).join('');
      const sufijos = muchos.replace(/TK-\d{6}-/g, '');

      for (const confuso of ['I', 'O', '0', '1']) {
        expect(sufijos).not.toContain(confuso);
      }
    });

    it('no repite en 2000 generaciones seguidas', () => {
      const generados = new Set(Array.from({ length: 2000 }, () => generarCodigoSeguimiento()));

      expect(generados.size).toBe(2000);
    });
  });
});
