import { describe, expect, it } from '@jest/globals';
import { codigoDeRol, nombresEnBase, ROL } from './roles.constants.js';

/**
 * El FSM tiene que funcionar contra dos bases que nombran los roles distinto:
 * la nuestra guarda los codigos (ADMIN, TECNICO) y la compartida guarda
 * nombres (Administrador, Terreno). Si la traduccion se rompe, el sintoma es
 * silencioso y feo: la gente entra bien y despues no puede hacer nada.
 */
describe('traduccion de roles', () => {
  describe('al leerlos de la base', () => {
    it('traduce los nombres de la base compartida', () => {
      expect(codigoDeRol('Administrador')).toBe(ROL.ADMIN);
      expect(codigoDeRol('Terreno')).toBe(ROL.TECNICO);
      expect(codigoDeRol('Comercial')).toBe(ROL.COMERCIAL);
    });

    it('deja pasar los codigos de nuestra propia base', () => {
      // Aca esta el motivo de que no haga falta una variable de entorno: el
      // mismo binario sirve contra las dos bases.
      expect(codigoDeRol('ADMIN')).toBe(ROL.ADMIN);
      expect(codigoDeRol('TECNICO')).toBe(ROL.TECNICO);
      expect(codigoDeRol('JEFE_TECNICO')).toBe(ROL.JEFE_TECNICO);
    });

    it('no inventa un rol cuando no conoce el nombre', () => {
      // Un rol ajeno tiene que quedar sin permisos, no caer en uno nuestro.
      // `Inventario` es de G1 y `SUPERUSUARIO` del administrador de la base.
      expect(codigoDeRol('Inventario')).toBe('Inventario');
      expect(codigoDeRol('SUPERUSUARIO')).toBe('SUPERUSUARIO');
      expect(Object.values(ROL)).not.toContain(codigoDeRol('Inventario'));
      expect(Object.values(ROL)).not.toContain(codigoDeRol('SUPERUSUARIO'));
    });

    it('sin rol asignado devuelve vacio y no rompe', () => {
      expect(codigoDeRol(null)).toBe('');
      expect(codigoDeRol(undefined)).toBe('');
      expect(codigoDeRol('')).toBe('');
    });

    it('NO mapea Soporte a jefe tecnico mientras el admin no conteste', () => {
      // Deliberado. Mapearlo mal le daria a soporte la facultad de aprobar
      // cierres, que es la separacion de funciones del MOD RF-04: quien
      // cierra no aprueba. Sin mapear, nadie tiene JEFE_TECNICO contra esa
      // base y ADMIN cubre el hueco.
      expect(codigoDeRol('Soporte')).not.toBe(ROL.JEFE_TECNICO);
      expect(codigoDeRol('Soporte')).toBe('Soporte');
    });
  });

  describe('al buscar por rol', () => {
    it('busca al tecnico por los dos nombres a la vez', () => {
      const nombres = nombresEnBase(ROL.TECNICO);
      expect(nombres).toContain('TECNICO');
      expect(nombres).toContain('Terreno');
    });

    it('incluye siempre el codigo, aunque no tenga equivalente', () => {
      // JEFE_TECNICO no esta mapeado todavia: la consulta tiene que seguir
      // encontrandolo en nuestra base.
      expect(nombresEnBase(ROL.JEFE_TECNICO)).toEqual(['JEFE_TECNICO']);
    });

    it('es la inversa exacta de codigoDeRol', () => {
      // Si alguien agrega una equivalencia y rompe uno de los dos sentidos,
      // esto se cae. Es el descuido mas probable en este archivo.
      for (const codigo of Object.values(ROL)) {
        for (const nombre of nombresEnBase(codigo)) {
          expect(codigoDeRol(nombre)).toBe(codigo);
        }
      }
    });
  });
});
