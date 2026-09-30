import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
  ESTADO_TICKET,
  ORIGEN_TICKET,
  PRIORIDAD_TICKET,
  TRANSICIONES_TICKET,
  generarCodigoSeguimiento,
  prioridadPorSla,
} from './tickets.constants.js';

/**
 * D6 del plan: vocabularios congelados antes de programar tickets. Cada literal
 * tiene que entrar en su columna: `EN_MANTENCION` no entraba en el VARCHAR(10)
 * de `puerto_nap.estado` y costo una migracion. Los largos se leen del esquema,
 * no se copian aca.
 */
const largo = (columna: string) => {
  const esquema = readFileSync('prisma/schema.prisma', 'utf-8');
  const modelo = esquema.slice(esquema.indexOf('model ticket {'));
  const m = modelo.match(new RegExp(String.raw`\n\s*${columna}\s+String\??\s+.*@db\.VarChar\((\d+)\)`));
  if (!m) throw new Error(`ticket.${columna} no es VarChar en el esquema`);
  return Number(m[1]);
};

describe('vocabularios de tickets', () => {
  it.each([
    ['estado', Object.values(ESTADO_TICKET)],
    ['prioridad', Object.values(PRIORIDAD_TICKET)],
    ['origen', Object.values(ORIGEN_TICKET)],
  ])('cada valor de %s entra en su columna', (columna, valores) => {
    const max = largo(columna);
    expect(valores.filter((v) => v.length > max)).toEqual([]);
  });

  it('el codigo de seguimiento entra en su columna y tiene la forma TK-XXXXXXX', () => {
    const codigo = generarCodigoSeguimiento();
    expect(codigo).toMatch(/^TK-[A-HJ-NP-Z2-9]{7}$/);
    expect(codigo.length).toBeLessThanOrEqual(largo('codigo_seguimiento'));
  });

  it('el codigo no es correlativo: dos seguidos no se parecen', () => {
    const codigos = new Set(Array.from({ length: 200 }, () => generarCodigoSeguimiento()));
    expect(codigos.size).toBe(200);
  });

  it('RESUELTO es final y toda transicion lleva a un estado conocido', () => {
    const conocidos = Object.values(ESTADO_TICKET) as string[];
    expect(TRANSICIONES_TICKET[ESTADO_TICKET.RESUELTO]).toEqual([]);
    for (const destinos of Object.values(TRANSICIONES_TICKET)) {
      expect(destinos.every((d) => conocidos.includes(d))).toBe(true);
    }
  });

  it.each([
    [2, 'CRITICA'],
    [4, 'CRITICA'],
    [8, 'ALTA'],
    [24, 'MEDIA'],
    [72, 'BAJA'],
    [null, 'MEDIA'],
  ])('un SLA de %p horas es prioridad %s', (sla, prioridad) => {
    expect(prioridadPorSla(sla)).toBe(prioridad);
  });
});
