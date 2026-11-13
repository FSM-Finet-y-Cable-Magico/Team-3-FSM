import { describe, expect, it } from '@jest/globals';
import type { EstadoOnt } from './reglas-alerta.js';
import { armarGrilla, cabeceraDeCaja, capacidadEstimada, masFrecuente } from './cajas-smartolt.js';

const AHORA = new Date('2026-11-13T12:00:00Z');
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

const ont = (sn: string, odb: string, odb_puerto: number | null, extra: Partial<EstadoOnt> = {}): EstadoOnt => ({
  id_registro_ont: 1,
  numero_serie: sn,
  id_cliente: null,
  id_caja_nap: null,
  olt_externo: '2',
  board: 1,
  puerto_pon: 7,
  caja_normalizada: 'NAP 53',
  estado_conexion: 'ONLINE',
  potencia_dbm: -21,
  sin_senal_desde: null,
  odb,
  odb_puerto,
  zona: 'ZONA 6',
  nombre_cliente: `Cliente ${sn}`,
  ...extra,
});

describe('grilla de puertos de una caja SmartOLT', () => {
  it('usa la capacidad del catalogo y pone cada ONT en su puerto', () => {
    const g = armarGrilla(
      [ont('A', 'NAP53', 1), ont('B', 'NAP53', 3)],
      [{ nombre: 'NAP53', capacidad: 16 }],
      AHORA,
    );

    expect(g).toMatchObject({ capacidad: 16, capacidad_estimada: false, ocupados: 2 });
    expect(g.puertos).toHaveLength(16);
    expect(g.puertos[2]).toMatchObject({ numero: 3, estado: 'OCUPADO', conflicto: false });
    expect(g.puertos[2].onts[0]).toEqual({
      numero_serie: 'B', nombre_cliente: 'Cliente B', estado_conexion: 'ONLINE', potencia_dbm: -21, posible_baja: false,
    });
    expect(g.puertos[1]).toMatchObject({ numero: 2, estado: 'SIN_REGISTRO', onts: [] });
  });

  it('busca en el catalogo primero la grafia mas usada', () => {
    const g = armarGrilla(
      [ont('A', 'NAP 53', 1), ont('B', 'NAP 53', 2), ont('C', 'NAP53', 3)],
      [{ nombre: 'NAP 53', capacidad: 8 }, { nombre: 'NAP53', capacidad: 16 }],
      AHORA,
    );

    expect(g.capacidad).toBe(8);
  });

  it('si la grafia mas usada no esta en el catalogo, prueba las demas', () => {
    const g = armarGrilla(
      [ont('A', 'NAP 53', 1), ont('B', 'NAP 53', 2), ont('C', 'NAP53', 3)],
      [{ nombre: 'nap53 ', capacidad: 16 }],
      AHORA,
    );

    expect(g).toMatchObject({ capacidad: 16, capacidad_estimada: false });
  });

  it('sin catalogo estima 8 o 16 segun el puerto mas alto ocupado', () => {
    expect(armarGrilla([ont('A', 'NAP53', 5)], [], AHORA)).toMatchObject({ capacidad: 8, capacidad_estimada: true });
    expect(armarGrilla([ont('A', 'NAP53', 11)], [], AHORA)).toMatchObject({ capacidad: 16, capacidad_estimada: true });
    expect(armarGrilla([ont('A', 'NAP53', null)], [], AHORA)).toMatchObject({ capacidad: 8, capacidad_estimada: true });
    expect(capacidadEstimada(20)).toBe(20);
  });

  it('homonimas del catalogo con capacidades distintas: no adivina, estima', () => {
    const g = armarGrilla(
      [ont('A', 'NAP53', 2)],
      [{ nombre: 'NAP53', capacidad: 8 }, { nombre: 'NAP53', capacidad: 16 }],
      AHORA,
    );

    expect(g).toMatchObject({ capacidad: 8, capacidad_estimada: true });
  });

  it('dos ONT en el mismo puerto: ocupado, con conflicto, y cuenta una vez', () => {
    const g = armarGrilla([ont('A', 'NAP53', 2), ont('B', 'NAP53', 2)], [{ nombre: 'NAP53', capacidad: 8 }], AHORA);

    expect(g.puertos[1]).toMatchObject({ estado: 'OCUPADO', conflicto: true });
    expect(g.puertos[1].onts.map((o) => o.numero_serie)).toEqual(['A', 'B']);
    expect(g.ocupados).toBe(1);
  });

  it('una ONT en un puerto mayor a la capacidad va a fuera de rango', () => {
    const g = armarGrilla([ont('A', 'NAP53', 12)], [{ nombre: 'NAP53', capacidad: 8 }], AHORA);

    expect(g.puertos).toHaveLength(8);
    expect(g.ocupados).toBe(0);
    expect(g.fuera_de_rango).toEqual([expect.objectContaining({ numero_serie: 'A', odb_puerto: 12 })]);
  });

  it('las ONT sin puerto (null o 0) se listan aparte', () => {
    const g = armarGrilla([ont('A', 'NAP53', null), ont('B', 'NAP53', 0), ont('C', 'NAP53', 1)], [], AHORA);

    expect(g.sin_puerto.map((o) => o.numero_serie)).toEqual(['A', 'B']);
    expect(g.ocupados).toBe(1);
  });

  it('un equipo dado de baja sigue ocupando su puerto, marcado como posible baja', () => {
    const g = armarGrilla(
      [ont('A', 'NAP53', 4, { estado_conexion: 'OFFLINE', sin_senal_desde: hace(200), potencia_dbm: null })],
      [],
      AHORA,
    );

    expect(g.puertos[3]).toMatchObject({ estado: 'OCUPADO' });
    expect(g.puertos[3].onts[0].posible_baja).toBe(true);
  });
});

describe('cabecera de una caja SmartOLT', () => {
  it('muestra la grafia y la zona mas usadas, y el puerto PON', () => {
    const c = cabeceraDeCaja('2/1/7|NAP 53', [
      ont('A', 'NAP53', 1, { zona: 'ZONA 6' }),
      ont('B', 'NAP53', 2, { zona: 'ZONA  6' }),
      ont('C', 'NAP 53', 3, { zona: 'ZONA 5' }),
    ]);

    expect(c).toEqual({
      clave: '2/1/7|NAP 53', nombre: 'NAP53', olt_externo: '2', board: 1, puerto_pon: 7, zona: 'ZONA 6',
    });
  });

  it('a igual cantidad gana la que aparecio primero', () => {
    expect(masFrecuente(['B', 'A', 'A', 'B', null])).toBe('B');
    expect(masFrecuente([null, null])).toBeNull();
  });
});
