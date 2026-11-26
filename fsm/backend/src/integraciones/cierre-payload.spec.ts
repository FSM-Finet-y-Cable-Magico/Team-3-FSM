import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { IntegracionesService } from './integraciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { MOMENTO_FAN_OUT } from '../ordenes/fan-out/momento-fan-out.js';

/**
 * El payload de cierre se arma en DOS lugares: `OrdenesService.cerrarOT` para
 * el webhook y `IntegracionesService.cierre` para la reconciliacion. El
 * acuerdo con G1 y G8 dice que el GET de reconciliacion devuelve exactamente
 * lo mismo que el webhook; si se desincronizan, el caso 5 de las pruebas de
 * aceptacion falla y nadie se entera hasta que un grupo reclama.
 *
 * Agregar un campo al contrato y tocar un solo lugar es el error facil. Estas
 * pruebas lo cazan.
 */
describe('payload de cierre para los otros grupos', () => {
  const OT = {
    id_ot: 41,
    id_empresa: 1,
    tipo_ot: 'REPARACION',
    estado: 'COMPLETADA',
    id_tecnico: 35,
    fecha_completada: new Date('2026-09-28T12:00:00.000Z'),
    fecha_creacion: new Date('2026-09-27T09:00:00.000Z'),
    potencia_optica_dbm: { toString: () => '-21.5' },
    resuelto_remotamente: false,
    categoria_falla_otro: null,
    cierre_equipos: null,
    cliente: { rut: '11111111-1', nombre_completo: 'Ana Soto' },
    direccion: { direccion_completa: 'Av. Ejemplo 123', comuna: 'La Pintana' },
    categoria_falla: { id_categoria: 3, nombre: 'Falla de planta externa' },
    materiales: [{ id_tipo_equipo: 7, cantidad: 2, tipo_equipo: { nombre: 'Cable drop 1 fibra' } }],
    tecnico: { nombre_usuario: 'jperez' },
    llamada: { resultado: 'CONFORME' },
  };

  const scope = { grupo: 'G1', empresas: [1] } as any;
  let service: IntegracionesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        IntegracionesService,
        { provide: MOMENTO_FAN_OUT, useValue: 'CIERRE' },
        {
          provide: PrismaService,
          useValue: { orden_trabajo: { findFirst: jest.fn(async () => OT) } },
        },
      ],
    }).compile();
    service = moduleRef.get(IntegracionesService);
  });

  it('incluye el id del tecnico que cerro la OT', async () => {
    // G1 lo pidio el 28-09 para atribuir el movimiento de equipos a una persona.
    const payload = await service.cierre(scope, 41, 1);

    expect(payload.id_tecnico).toBe(35);
  });

  it('identifica al tecnico por clave natural, no solo por id', async () => {
    // G8 reporto el 8-11 que la OT 56 traia el tecnico 4 y que ese usuario no
    // existia en su base: `id_tecnico` es NUESTRO y no se puede resolver desde
    // afuera. Va tambien `usuario_tecnico`, que si pueden cruzar.
    const payload = await service.cierre(scope, 41, 1);

    expect(payload.id_tecnico).toBe(35);
    expect(payload.usuario_tecnico).toBe('jperez');
  });

  it('no expone el nombre completo del tecnico', async () => {
    // Sigue valiendo la minima exposicion: lo que faltaba era un identificador
    // resoluble, no la identidad del trabajador. El nombre legal no viaja --y
    // menos en un payload que tambien recibe G8--.
    const payload = (await service.cierre(scope, 41, 1)) as unknown as Record<string, unknown>;

    expect(JSON.stringify(payload)).not.toContain('nombre_completo');
    expect(Object.keys(payload).filter((k) => k.includes('tecnico')).sort()).toEqual([
      'id_tecnico',
      'usuario_tecnico',
    ]);
  });

  it('manda el nombre del material, porque el id no sirve fuera del FSM', async () => {
    // Mismo defecto que el del tecnico: los catalogos de G1 y G3 se cargaron
    // por separado, asi que `id_tipo_equipo` no cruza. El nombre si.
    const payload = await service.cierre(scope, 41, 1);

    expect(payload.materiales).toEqual([
      { id_tipo_equipo: 7, nombre: 'Cable drop 1 fibra', cantidad: 2 },
    ]);
  });

  it('devuelve exactamente los campos que declara el contrato', async () => {
    // Se leen los nombres desde `PayloadCierre` en vez de repetirlos aca: si
    // alguien agrega un campo al contrato y solo toca el webhook, esta prueba
    // se cae sola, que es justo el descuido que hay que evitar.
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync('src/ordenes/fan-out/fan-out-cierre.ts', 'utf-8');
    const bloque = fuente.slice(
      fuente.indexOf('export interface PayloadCierre'),
      fuente.indexOf('export interface FanOutCierre'),
    );
    const declarados = [...bloque.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);

    const payload = await service.cierre(scope, 41, 1);

    expect(declarados.length).toBeGreaterThan(10);
    expect(Object.keys(payload).sort()).toEqual(declarados.sort());
  });
});
