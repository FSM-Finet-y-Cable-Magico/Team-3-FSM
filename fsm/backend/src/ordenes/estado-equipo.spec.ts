import { describe, expect, it } from '@jest/globals';
import {
  ACCION_A_ESTADO_G1,
  ACCION_EQUIPO,
  DIAGNOSTICO_POR_DEFECTO,
  DIAGNOSTICO_RETIRO,
  ORIGENES_VALIDOS_G1,
  TRANSICIONES_G1,
} from './estado-equipo.constants.js';

/**
 * Fija el contrato con G1 sobre estados de equipo.
 *
 * Los literales son de ELLOS y los comparan de su lado, asi que un cambio
 * accidental --una tilde perdida, un estado renombrado-- rompe la integracion
 * en silencio: nosotros seguiriamos enviando y ellos descartarian como
 * discrepancia. Estas pruebas son el seguro contra eso.
 */
describe('contrato de estados de equipo con G1', () => {
  const ESTADOS_G1 = [
    'En bodega',
    'Asignado a técnico',
    'Instalado en cliente',
    'En revisión',
    'En préstamo externo',
    'Dado de baja',
  ];

  it('todo destino de una accion es un estado que G1 reconoce', () => {
    for (const destino of Object.values(ACCION_A_ESTADO_G1)) {
      expect(ESTADOS_G1).toContain(destino);
    }
  });

  it('todo origen valido es un estado que G1 reconoce', () => {
    for (const origenes of Object.values(ORIGENES_VALIDOS_G1)) {
      for (const o of origenes) expect(ESTADOS_G1).toContain(o);
    }
  });

  it('las cuatro acciones tienen origenes declarados', () => {
    for (const accion of Object.values(ACCION_EQUIPO)) {
      expect(ORIGENES_VALIDOS_G1[accion]?.length).toBeGreaterThan(0);
    }
  });

  it('la matriz cubre los seis estados y "Dado de baja" es terminal', () => {
    expect(TRANSICIONES_G1.map((t) => t.origen).sort()).toEqual([...ESTADOS_G1].sort());
    expect(TRANSICIONES_G1.find((t) => t.origen === 'Dado de baja')?.destinos).toEqual([]);
  });

  it('cada accion es coherente con la matriz: su destino sale de sus origenes', () => {
    // Si G1 dice que la accion X va desde el estado O, la matriz tiene que
    // permitir O -> destino(X). Si no, el contrato se contradice a si mismo.
    for (const [accion, destino] of Object.entries(ACCION_A_ESTADO_G1)) {
      for (const origen of ORIGENES_VALIDOS_G1[accion as keyof typeof ORIGENES_VALIDOS_G1]) {
        const permitidos = TRANSICIONES_G1.find((t) => t.origen === origen)?.destinos ?? [];
        expect(permitidos).toContain(destino);
      }
    }
  });

  it('deja constancia de las dos acciones que hoy NO se pueden emitir en terreno', () => {
    // En una visita un equipo solo puede estar en dos estados: el que el
    // tecnico lleva ("Asignado a técnico") y el que ya esta en la casa
    // ("Instalado en cliente"). Todo lo demas es trastienda.
    const EN_TERRENO = ['Asignado a técnico', 'Instalado en cliente'];
    const emitible = (accion: keyof typeof ORIGENES_VALIDOS_G1) =>
      ORIGENES_VALIDOS_G1[accion].some((o) => EN_TERRENO.includes(o));

    expect(emitible('INSTALADO_EN_CLIENTE')).toBe(true);
    expect(emitible('RETIRADO_PARA_DIAGNOSTICO')).toBe(true);

    // BAJA_EN_TERRENO se llama "en terreno" y no admite ningun estado de
    // terreno. Esta planteado a G1 y sin responder; el dia que lo corrijan,
    // esta prueba se cae y hay que actualizarla. Es el recordatorio.
    expect(emitible('BAJA_EN_TERRENO')).toBe(false);

    // RETIRADO_A_BODEGA sirve desde "Asignado a técnico" (equipo que el tecnico
    // saco y no llego a instalar) pero NO desde "Instalado en cliente", que es
    // el caso que su nombre sugiere.
    expect(ORIGENES_VALIDOS_G1.RETIRADO_A_BODEGA).toContain('Asignado a técnico');
    expect(ORIGENES_VALIDOS_G1.RETIRADO_A_BODEGA).not.toContain('Instalado en cliente');
  });

  it('la lista de diagnosticos es la de G1, con sus tildes', () => {
    expect(Object.values(DIAGNOSTICO_RETIRO)).toEqual([
      'No enciende',
      'Se reinicia continuamente',
      'Sin señal óptica',
      'Copla o puerto dañado',
      'Falla de configuración',
      'Daño físico visible',
      'Causa desconocida',
      'Otro',
    ]);
  });

  it('el diagnostico por defecto es el que G1 asume cuando no viene', () => {
    expect(DIAGNOSTICO_POR_DEFECTO).toBe('Causa desconocida');
    expect(Object.values(DIAGNOSTICO_RETIRO)).toContain(DIAGNOSTICO_POR_DEFECTO);
  });
});
