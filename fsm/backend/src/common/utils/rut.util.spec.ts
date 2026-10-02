import { filtroRut, limpiarRut, rutParaApi, validarRut, variantesRut } from './rut.util.js';

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

describe('rutParaApi', () => {
  // El §3 del acuerdo con G8 fija `12345678-5` para lo que viaja por API, y el
  // §11 del Documento 0 fija el guardado sin guion. Desde que el alta guarda
  // canonico, mandar el valor crudo de la columna produciria dos formatos
  // distintos segun cuando se creo el cliente.
  it('devuelve la grafia del contrato venga como venga de la base', () => {
    for (const entrada of ['123456785', '12345678-5', '12.345.678-5']) {
      expect(rutParaApi(entrada)).toBe('12345678-5');
    }
  });

  it('deja la K en mayuscula, que es lo que exige el contrato', () => {
    expect(rutParaApi('21116770k')).toBe('21116770-K');
    expect(rutParaApi('21116770K')).toBe('21116770-K');
  });

  it('calza con el formato que valida nuestro propio DTO de entrada', () => {
    // Si estas dos reglas se separan, mandamos algo que nosotros mismos
    // rechazariamos al recibirlo.
    const delDto = /^\d{7,8}-[\dK]$/;
    expect(rutParaApi('123456785')).toMatch(delDto);
    expect(rutParaApi('21116770k')).toMatch(delDto);
  });

  it('no inventa formato para lo que no es un RUT', () => {
    expect(rutParaApi(null)).toBeNull();
    expect(rutParaApi('')).toBeNull();
    expect(rutParaApi('abc')).toBe('abc');
  });
});
