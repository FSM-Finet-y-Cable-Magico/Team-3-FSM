import { filtroRut, limpiarRut, validarRut, variantesRut } from './rut.util.js';

describe('limpiarRut', () => {
  it('quita puntos, guion y espacios, y sube la K', () => {
    expect(limpiarRut(' 12.345.678-5 ')).toBe('123456785');
    expect(limpiarRut('21116770-k')).toBe('21116770K');
  });
});

describe('variantesRut', () => {
  // Las dos grafias que hay de verdad en produccion, mitad y mitad.
  it('cubre las dos grafias guardadas, venga como venga la entrada', () => {
    for (const entrada of ['123456785', '12345678-5', '12.345.678-5']) {
      const v = variantesRut(entrada);
      expect(v).toContain('123456785');
      expect(v).toContain('12345678-5');
      expect(v).toContain('12.345.678-5');
    }
  });

  it('enumera la K en minuscula y en mayuscula', () => {
    // `in` de Prisma no admite mode: 'insensitive', de ahi que se enumeren.
    const v = variantesRut('21116770K');
    expect(v).toContain('21116770K');
    expect(v).toContain('21116770k');
    expect(v).toContain('21116770-K');
    expect(v).toContain('21116770-k');
  });

  it('pone los puntos donde van en un cuerpo de 7 digitos', () => {
    expect(variantesRut('1234567-4')).toContain('1.234.567-4');
  });

  it('no inventa variantes con una entrada vacia', () => {
    expect(variantesRut('')).toEqual([]);
    expect(variantesRut('   ')).toEqual([]);
  });
});

describe('filtroRut', () => {
  it('con un RUT completo compara contra todas las grafias', () => {
    expect(filtroRut('12.345.678-5')).toEqual({ in: variantesRut('123456785') });
  });

  it('con un RUT parcial busca el fragmento sin puntuacion', () => {
    // El cuerpo va sin puntuacion en las dos grafias guardadas, asi que el
    // fragmento encuentra a los dos.
    expect(filtroRut('1234567')).toEqual({ contains: '1234567', mode: 'insensitive' });
    expect(filtroRut('12.345')).toEqual({ contains: '12345', mode: 'insensitive' });
  });

  it('con un digito verificador que no cuadra no finge un RUT completo', () => {
    expect(validarRut('12345678-9')).toBe(false);
    expect(filtroRut('12345678-9')).toEqual({ contains: '123456789', mode: 'insensitive' });
  });
});

describe('filtroRut con terminos que no son RUT', () => {
  // Estas busquedas comparten el termino con el nombre del cliente. Sin la
  // salida en `undefined`, la rama del RUT contaminaria el resultado.
  it('no filtra por RUT cuando la entrada no trae ningun digito', () => {
    expect(filtroRut('Ana')).toBeUndefined();
    expect(filtroRut('')).toBeUndefined();
    expect(filtroRut('   ')).toBeUndefined();
  });

  it('no confunde la K de un nombre con un digito verificador', () => {
    expect(filtroRut('Karla')).toBeUndefined();
  });
});
